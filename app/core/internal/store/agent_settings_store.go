package store

import (
	"context"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

func (s *Store) GetAgentSettings(ctx context.Context) (model.AgentSettings, error) {
	var settings model.AgentSettings
	err := s.DB.QueryRowContext(ctx, `
		SELECT provider, model, max_tool_rounds, history_limit, max_output_tokens,
		       openai_base_url, openai_api_key, updated_at
		FROM agent_settings WHERE id = 'agent_1'
	`).Scan(&settings.Provider, &settings.Model, &settings.MaxToolRounds, &settings.HistoryLimit, &settings.MaxOutputTokens, &settings.OpenAIBaseURL, &settings.OpenAIAPIKey, &settings.UpdatedAt)
	return settings, err
}

func (s *Store) UpdateAgentSettings(ctx context.Context, settings model.AgentSettings) error {
	_, err := s.DB.ExecContext(ctx, `
		UPDATE agent_settings
		SET provider = ?, model = ?, max_tool_rounds = ?, history_limit = ?,
		    max_output_tokens = ?, openai_base_url = ?, openai_api_key = ?, updated_at = ?
		WHERE id = 'agent_1'
	`, settings.Provider, settings.Model, settings.MaxToolRounds, settings.HistoryLimit, settings.MaxOutputTokens, settings.OpenAIBaseURL, settings.OpenAIAPIKey, nowRFC3339())
	return err
}
