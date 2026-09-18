ALTER TABLE agent_settings ADD COLUMN compaction_recent_turns INTEGER NOT NULL DEFAULT 8;
ALTER TABLE agent_settings ADD COLUMN compaction_max_output_tokens INTEGER NOT NULL DEFAULT 1024;

UPDATE agent_settings
SET compaction_recent_turns = CASE
    WHEN history_limit < 4 THEN 1
    WHEN history_limit < 18 THEN (history_limit - 2) / 2
    ELSE 8
END;
