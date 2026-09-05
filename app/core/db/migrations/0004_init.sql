-- Multiple pinned items per kind. The pins table is the single store for
-- featured content: each kind's pin order is the insertion order (position
-- appended). Existing single-featured rows from thoughts_config and
-- writings_config are migrated in, then the featured columns are dropped so
-- the config singletons only track their own updated_at.
CREATE TABLE IF NOT EXISTS pins (
    content_id TEXT PRIMARY KEY REFERENCES content(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('THOUGHT', 'ARTICLE')),
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pins_kind_position ON pins(kind, position);

INSERT INTO pins (content_id, kind, position, created_at)
    SELECT featured_thought_id, 'THOUGHT', 0, updated_at
    FROM thoughts_config WHERE featured_thought_id IS NOT NULL;

INSERT INTO pins (content_id, kind, position, created_at)
    SELECT featured_writing_id, 'ARTICLE', 0, updated_at
    FROM writings_config WHERE featured_writing_id IS NOT NULL;

ALTER TABLE thoughts_config DROP COLUMN featured_thought_id;
ALTER TABLE writings_config DROP COLUMN featured_writing_id;
