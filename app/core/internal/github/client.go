package github

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/manifold-space/manifold/app/core/internal/config"
)

var (
	errAuthorizationFailed = errors.New("github authorization failed")
	errProfileUnavailable  = errors.New("github profile is unavailable")
)

type Client struct {
	clientID     string
	clientSecret string
	redirectURI  string
	tokenURL     string
	apiURL       string
	http         *http.Client
}

func NewClient(cfg config.Config, client *http.Client) *Client {
	return &Client{
		clientID:     cfg.GitHubClientID,
		clientSecret: cfg.GitHubClientSecret,
		redirectURI:  cfg.GitHubRedirectURI,
		tokenURL:     "https://github.com/login/oauth/access_token",
		apiURL:       "https://api.github.com",
		http:         client,
	}
}

type Profile struct {
	ID        int64  `json:"id"`
	Login     string `json:"login"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
	Email     string `json:"email"`
}

func (g *Client) Exchange(code string) (string, error) {
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
		return "", errAuthorizationFailed
	}
	return body.AccessToken, nil
}

func (g *Client) Profile(accessToken string) (Profile, error) {
	request, err := http.NewRequest(http.MethodGet, g.apiURL+"/user", nil)
	if err != nil {
		return Profile{}, err
	}
	request.Header.Set("Authorization", "Bearer "+accessToken)
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	response, err := g.http.Do(request)
	if err != nil {
		return Profile{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return Profile{}, errProfileUnavailable
	}
	var profile Profile
	if err := json.NewDecoder(response.Body).Decode(&profile); err != nil {
		return Profile{}, err
	}
	if profile.ID == 0 || profile.Login == "" {
		return Profile{}, errProfileUnavailable
	}
	return profile, nil
}
