package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/manifold-space/manifold/app/core/internal/apierror"
	"github.com/manifold-space/manifold/app/core/internal/auth"
	"github.com/manifold-space/manifold/app/core/internal/config"
)

// githubOAuthClient talks to GitHub on behalf of the public comment identity
// flow. The client id/secret/redirect come from config; an unset secret makes
// the provider disabled (auth/me reports it absent and the web gate hides the
// button), so the endpoints return a clear error instead of panicking.
type githubOAuthClient struct {
	clientID     string
	clientSecret string
	redirectURI  string
	tokenURL     string
	apiURL       string
	http         *http.Client
}

func newGitHubOAuthClient(cfg config.Config, client *http.Client) *githubOAuthClient {
	return &githubOAuthClient{
		clientID:     cfg.GitHubClientID,
		clientSecret: cfg.GitHubClientSecret,
		redirectURI:  cfg.GitHubRedirectURI,
		tokenURL:     "https://github.com/login/oauth/access_token",
		apiURL:       "https://api.github.com",
		http:         client,
	}
}

type githubProfile struct {
	ID        int64  `json:"id"`
	Login     string `json:"login"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
	Email     string `json:"email"`
}

var (
	errGitHubAuthFailed  = errors.New("github authorization failed")
	errGitHubProfileMiss = errors.New("github profile is unavailable")
)

func (g *githubOAuthClient) exchange(code string) (string, error) {
	form := url.Values{}
	form.Set("client_id", g.clientID)
	form.Set("client_secret", g.clientSecret)
	form.Set("code", code)
	form.Set("redirect_uri", g.redirectURI)
	request, err := http.NewRequest(http.MethodPost, g.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := g.http.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	var body struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		return "", err
	}
	if body.Error != "" || body.AccessToken == "" {
		return "", errGitHubAuthFailed
	}
	return body.AccessToken, nil
}

func (g *githubOAuthClient) profile(accessToken string) (githubProfile, error) {
	request, err := http.NewRequest(http.MethodGet, g.apiURL+"/user", nil)
	if err != nil {
		return githubProfile{}, err
	}
	request.Header.Set("Authorization", "Bearer "+accessToken)
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	response, err := g.http.Do(request)
	if err != nil {
		return githubProfile{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return githubProfile{}, errGitHubProfileMiss
	}
	var profile githubProfile
	if err := json.NewDecoder(response.Body).Decode(&profile); err != nil {
		return githubProfile{}, err
	}
	if profile.ID == 0 || profile.Login == "" {
		return githubProfile{}, errGitHubProfileMiss
	}
	return profile, nil
}

func (h *apiHandler) githubEnabled() bool {
	return h.cfg.GitHubClientID != "" && h.cfg.GitHubClientSecret != "" && h.cfg.GitHubRedirectURI != ""
}

type githubExchangeInput struct {
	Code string `json:"code" validate:"required,max=4096"`
}

// githubExchange completes the OAuth authorization-code leg: swap the code for
// an access token, fetch the GitHub profile, upsert the identity row and mint
// a visitor session token for the web app to store in its cookie. The token is
// scoped to comment identity only — it grants no admin access and never
// carries the GitHub access token.
func (h *apiHandler) githubExchange(w http.ResponseWriter, r *http.Request) {
	if !h.githubEnabled() {
		WriteError(w, http.StatusNotImplemented, apierror.GitHubAuthDisabled, "GitHub sign-in is not configured on this server.")
		return
	}
	var input githubExchangeInput
	if err := decodeJSON(w, r, &input); err != nil || h.validate.Struct(input) != nil {
		if !errors.Is(err, errBodyTooLarge) {
			WriteError(w, http.StatusUnprocessableEntity, apierror.ValidationError, "A GitHub authorization code is required.")
		}
		return
	}
	client := newGitHubOAuthClient(h.cfg, h.githubClient)
	accessToken, err := client.exchange(input.Code)
	if err != nil {
		WriteError(w, http.StatusBadGateway, apierror.GitHubAuthFailed, "GitHub could not authorize this sign-in.")
		return
	}
	profile, err := client.profile(accessToken)
	if err != nil {
		WriteError(w, http.StatusBadGateway, apierror.GitHubProfileFailed, "GitHub profile could not be loaded.")
		return
	}
	displayName := strings.TrimSpace(profile.Name)
	if displayName == "" {
		displayName = profile.Login
	}
	identity, err := h.store.UpsertIdentity("github", strconv.FormatInt(profile.ID, 10), displayName, profile.AvatarURL, profile.Email)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.IdentityUnavailable, "Sign-in could not be recorded.")
		return
	}
	token, err := h.auth.SignVisitor(identity.ID, identity.Provider, identity.DisplayName, identity.AvatarURL, time.Now())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.SessionUnavailable, "A session could not be issued.")
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{
		"token": token, "provider": identity.Provider, "displayName": identity.DisplayName, "avatarUrl": identity.AvatarURL,
	})
}

// authMe reports the visitor session state and which comment providers are
// configured. Unauthenticated and invalid sessions both return
// authenticated:false so the client can safely clear its stale cookie.
func (h *apiHandler) authMe(w http.ResponseWriter, r *http.Request) {
	providers := []string{}
	if h.githubEnabled() {
		providers = append(providers, "github")
	}
	claims, err := auth.VisitorFromRequest(h.auth, r.Header.Get("Authorization"))
	if err != nil || claims == nil {
		WriteJSON(w, http.StatusOK, map[string]any{"authenticated": false, "providers": providers})
		return
	}
	identity, err := h.store.GetIdentity(claims.Subject)
	if err != nil || identity.Provider == "" {
		WriteJSON(w, http.StatusOK, map[string]any{"authenticated": false, "providers": providers})
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{
		"authenticated": true, "provider": identity.Provider, "displayName": identity.DisplayName, "avatarUrl": identity.AvatarURL, "providers": providers,
	})
}

// visitorIdentity resolves an optional Bearer visitor session into a durable
// identity row. A present-but-invalid token is an error (the client should
// clear its cookie); an absent token means anonymous with no error.
func (h *apiHandler) visitorIdentity(r *http.Request) (*storeIdentity, error) {
	claims, err := auth.VisitorFromRequest(h.auth, r.Header.Get("Authorization"))
	if err != nil || claims == nil {
		if err != nil {
			return nil, errors.New("invalid visitor session")
		}
		return nil, nil
	}
	identity, err := h.store.GetIdentity(claims.Subject)
	if err != nil || identity.Provider == "" {
		return nil, errors.New("invalid visitor session")
	}
	return &storeIdentity{Provider: identity.Provider, DisplayName: identity.DisplayName, AvatarURL: identity.AvatarURL}, nil
}

type storeIdentity struct {
	Provider    string
	DisplayName string
	AvatarURL   string
}
