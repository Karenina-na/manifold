-- Provider-backed comment identities (GitHub sign-in, docs/core.md §auth).
-- Comments snapshot the author provider and avatar URL at publish time so an
-- account rename never rewrites past comments; the identities table tracks the
-- current account row for session resolution and /auth/me.

ALTER TABLE comments ADD COLUMN author_provider TEXT NOT NULL DEFAULT 'visitor';
ALTER TABLE comments ADD COLUMN author_avatar_url TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS identities (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_url TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (provider, provider_id)
);
