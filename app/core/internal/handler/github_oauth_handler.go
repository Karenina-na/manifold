package handler

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/manifold-space/manifold/app/core/internal/apierror"
	"github.com/manifold-space/manifold/app/core/internal/auth"
	"github.com/manifold-space/manifold/app/core/internal/github"
)

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
	client := github.NewClient(h.cfg, h.githubClient)
	accessToken, err := client.Exchange(input.Code)
	if err != nil {
		WriteError(w, http.StatusBadGateway, apierror.GitHubAuthFailed, "GitHub could not authorize this sign-in.")
		return
	}
	profile, err := client.Profile(accessToken)
	if err != nil {
		WriteError(w, http.StatusBadGateway, apierror.GitHubProfileFailed, "GitHub profile could not be loaded.")
		return
	}
	displayName := strings.TrimSpace(profile.Name)
	if displayName == "" {
		displayName = profile.Login
	}
	identity, err := h.store.UpsertIdentity(r.Context(), "github", strconv.FormatInt(profile.ID, 10), displayName, profile.AvatarURL, profile.Email)
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
	identity, err := h.store.GetIdentity(r.Context(), claims.Subject)
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
	identity, err := h.store.GetIdentity(r.Context(), claims.Subject)
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
