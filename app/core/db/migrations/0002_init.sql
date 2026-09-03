-- Admin security: DB-backed credentials (env seeds once) and revocable
-- sessions keyed by the JWT jti. A session is active when revoked_at IS NULL
-- and expires_at is still in the future.
CREATE TABLE IF NOT EXISTS admin_credentials (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_sessions (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_subject ON admin_sessions(subject);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_revoked ON admin_sessions(revoked_at);
