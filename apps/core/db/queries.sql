-- name: GetProfile :one
SELECT id, name, bio, location, avatar_url, updated_at FROM profile WHERE id = 1;

-- name: ListPublishedEntries :many
SELECT id, kind, slug, title, excerpt, content, published_at, updated_at
FROM entries WHERE published_at IS NOT NULL ORDER BY published_at DESC LIMIT ?;

-- name: GetNowStatus :one
SELECT id, title, detail, updated_at FROM now_status WHERE id = 1;

