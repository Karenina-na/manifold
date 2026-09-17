package model

type AgentSettings struct {
	Provider        string `json:"provider"`
	Model           string `json:"model"`
	MaxToolRounds   int    `json:"maxToolRounds"`
	HistoryLimit    int    `json:"historyLimit"`
	MaxOutputTokens int    `json:"maxOutputTokens"`
	OpenAIBaseURL   string `json:"openAIBaseURL"`
	OpenAIAPIKey    string `json:"-"`
	UpdatedAt       string `json:"updatedAt"`
}

type AgentSettingsView struct {
	Provider         string `json:"provider"`
	Model            string `json:"model"`
	MaxToolRounds    int    `json:"maxToolRounds"`
	HistoryLimit     int    `json:"historyLimit"`
	MaxOutputTokens  int    `json:"maxOutputTokens"`
	OpenAIBaseURL    string `json:"openAIBaseURL"`
	APIKeyConfigured bool   `json:"apiKeyConfigured"`
	UpdatedAt        string `json:"updatedAt"`
}

func (s AgentSettings) View() AgentSettingsView {
	return AgentSettingsView{
		Provider: s.Provider, Model: s.Model, MaxToolRounds: s.MaxToolRounds,
		HistoryLimit: s.HistoryLimit, MaxOutputTokens: s.MaxOutputTokens,
		OpenAIBaseURL: s.OpenAIBaseURL, APIKeyConfigured: s.OpenAIAPIKey != "", UpdatedAt: s.UpdatedAt,
	}
}
