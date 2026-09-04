-- Comment moderation: hide is independent from soft deletion.
ALTER TABLE comments ADD COLUMN hidden_at TEXT;
