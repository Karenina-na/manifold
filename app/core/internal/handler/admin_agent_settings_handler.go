package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/manifold-space/manifold/app/core/internal/agent/provider/openai"
	"github.com/manifold-space/manifold/app/core/internal/apierror"
	"github.com/manifold-space/manifold/app/core/internal/model"
)

func (h *apiHandler) adminAgentSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := h.store.GetAgentSettings(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.AgentSettingsUnavailable, "Agent settings are unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, settings.View())
}

func (h *apiHandler) adminUpdateAgentSettings(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Provider        *string         `json:"provider"`
		Model           *string         `json:"model"`
		MaxToolRounds   *int            `json:"maxToolRounds"`
		HistoryLimit    *int            `json:"historyLimit"`
		MaxOutputTokens *int            `json:"maxOutputTokens"`
		OpenAIBaseURL   *string         `json:"openAIBaseURL"`
		APIKey          json.RawMessage `json:"apiKey"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		return
	}
	if input.Provider == nil || input.Model == nil || input.MaxToolRounds == nil || input.HistoryLimit == nil || input.MaxOutputTokens == nil || input.OpenAIBaseURL == nil {
		WriteError(w, http.StatusUnprocessableEntity, apierror.ValidationError, "All non-secret Agent settings are required.")
		return
	}
	settings, err := h.store.GetAgentSettings(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.AgentSettingsUnavailable, "Agent settings are unavailable.")
		return
	}
	settings.Provider = strings.TrimSpace(*input.Provider)
	settings.Model = strings.TrimSpace(*input.Model)
	settings.MaxToolRounds = *input.MaxToolRounds
	settings.HistoryLimit = *input.HistoryLimit
	settings.MaxOutputTokens = *input.MaxOutputTokens
	settings.OpenAIBaseURL = openai.NormalizeBaseURL(*input.OpenAIBaseURL)
	if input.APIKey != nil {
		if bytes.Equal(bytes.TrimSpace(input.APIKey), []byte("null")) {
			settings.OpenAIAPIKey = ""
		} else {
			var apiKey string
			if json.Unmarshal(input.APIKey, &apiKey) != nil {
				WriteError(w, http.StatusUnprocessableEntity, apierror.ValidationError, "apiKey must be a string or null.")
				return
			}
			settings.OpenAIAPIKey = strings.TrimSpace(apiKey)
		}
	}
	if err := validateAgentSettings(settings); err != nil {
		WriteError(w, http.StatusUnprocessableEntity, apierror.ValidationError, err.Error())
		return
	}
	if err := h.store.UpdateAgentSettings(r.Context(), settings); err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.AgentSettingsUpdateFailed, "Agent settings could not be updated.")
		return
	}
	h.audit(r, "agent.settings.updated", "agent_settings", "agent_1", map[string]string{
		"provider": settings.Provider, "model": settings.Model,
		"maxToolRounds": strconv.Itoa(settings.MaxToolRounds), "historyLimit": strconv.Itoa(settings.HistoryLimit),
		"maxOutputTokens": strconv.Itoa(settings.MaxOutputTokens), "apiKeyConfigured": strconv.FormatBool(settings.OpenAIAPIKey != ""),
	})
	h.adminAgentSettings(w, r)
}

func validateAgentSettings(settings model.AgentSettings) error {
	if settings.Provider != "openai" {
		return errors.New("provider must be openai")
	}
	if settings.Model == "" || len(settings.Model) > 200 {
		return errors.New("model is required and must not exceed 200 characters")
	}
	if settings.MaxToolRounds < 1 || settings.MaxToolRounds > 12 {
		return errors.New("maxToolRounds must be between 1 and 12")
	}
	if settings.HistoryLimit < 1 || settings.HistoryLimit > 200 {
		return errors.New("historyLimit must be between 1 and 200")
	}
	if settings.MaxOutputTokens < 1 || settings.MaxOutputTokens > 128000 {
		return errors.New("maxOutputTokens must be between 1 and 128000")
	}
	if len(settings.OpenAIBaseURL) > 2048 {
		return errors.New("openAIBaseURL must not exceed 2048 characters")
	}
	parsed, err := url.Parse(settings.OpenAIBaseURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return errors.New("openAIBaseURL must be an absolute HTTP(S) URL without credentials, query, or fragment")
	}
	if len(settings.OpenAIAPIKey) > 8192 {
		return errors.New("apiKey must not exceed 8192 characters")
	}
	return nil
}
