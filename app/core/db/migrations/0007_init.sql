CREATE TABLE IF NOT EXISTS agent_settings (
    id TEXT PRIMARY KEY CHECK (id = 'agent_1'),
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    max_tool_rounds INTEGER NOT NULL,
    history_limit INTEGER NOT NULL,
    max_output_tokens INTEGER NOT NULL,
    openai_base_url TEXT NOT NULL,
    openai_api_key TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO agent_settings (
    id, provider, model, max_tool_rounds, history_limit,
    max_output_tokens, openai_base_url, openai_api_key
) VALUES (
    'agent_1', 'openai', 'gpt-5-mini', 6, 40,
    2048, 'https://api.openai.com/v1', ''
);
