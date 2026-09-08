package store

import (
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

type CommentListOptions struct {
	Page     int
	PageSize int
	Query    string
}

type CommentListResult struct {
	Comments   []model.Comment
	Page       int
	PageSize   int
	TotalItems int
	TotalPages int
}

const commentColumns = `id, content_id, author_name, author_url, body, created_at, reply_to_id, avatar_seed, author_provider, author_avatar_url, deleted_at, hidden_at`

// matchedCommentThreads returns a CTE of top-level comments whose own
// author/body matches the needle or that own any matching reply, so a hit
// always exposes the whole thread. An empty needle matches every root. The CTE
// carries created_at so nested LIMIT/OFFSET subqueries can order without
// binding to the outer query's columns.
func matchedCommentThreads() string {
	return `WITH matched AS (
		SELECT id, created_at FROM comments
		WHERE content_id = ? AND deleted_at IS NULL AND reply_to_id IS NULL
		AND (? = '' OR (hidden_at IS NULL AND (INSTR(LOWER(author_name), ?) > 0 OR INSTR(LOWER(body), ?) > 0))
			OR EXISTS (SELECT 1 FROM comments reply WHERE reply.reply_to_id = comments.id AND reply.deleted_at IS NULL AND reply.hidden_at IS NULL AND (INSTR(LOWER(reply.author_name), ?) > 0 OR INSTR(LOWER(reply.body), ?) > 0)))
	)`
}

func scanComment(scanner interface{ Scan(dest ...any) error }) (model.Comment, error) {
	var c model.Comment
	var authorURL, replyToID, deletedAt, hiddenAt sql.NullString
	if err := scanner.Scan(&c.ID, &c.ContentID, &c.AuthorName, &authorURL, &c.Body, &c.CreatedAt, &replyToID, &c.AvatarSeed, &c.AuthorProvider, &c.AuthorAvatarURL, &deletedAt, &hiddenAt); err != nil {
		return model.Comment{}, err
	}
	if authorURL.Valid {
		c.AuthorURL = &authorURL.String
	}
	if replyToID.Valid {
		c.ReplyToID = &replyToID.String
	}
	c.Hidden = hiddenAt.Valid
	return c, nil
}

func (s *Store) scanComments(query string, args ...any) ([]model.Comment, error) {
	rows, err := s.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []model.Comment{}
	for rows.Next() {
		item, err := scanComment(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// redactHiddenComment keeps a hidden row in the public thread so its replies
// retain their position, while ensuring moderation never exposes its visitor
// details or body through the public API.
func redactHiddenComment(comment *model.Comment) {
	if !comment.Hidden {
		return
	}
	comment.AuthorName = ""
	comment.AuthorURL = nil
	comment.Body = ""
	comment.AvatarSeed = ""
	comment.AuthorProvider = "visitor"
	comment.AuthorAvatarURL = ""
}

// ListComments paginates roots of undeleted threads and attaches every
// matching reply to its root's page.
func (s *Store) ListComments(contentID string, options CommentListOptions) (CommentListResult, error) {
	pageSize := options.PageSize
	if pageSize <= 0 {
		pageSize = 10
	}
	if pageSize > 100 {
		pageSize = 100
	}
	page := options.Page
	if page < 1 {
		page = 1
	}
	needle := strings.ToLower(strings.TrimSpace(options.Query))
	matched := matchedCommentThreads()
	matchArgs := []any{contentID, needle, needle, needle, needle, needle}

	var totalItems, totalRoots int
	if err := s.DB.QueryRow(matched+`SELECT COUNT(*), COALESCE(SUM(CASE WHEN reply_to_id IS NULL THEN 1 ELSE 0 END), 0) FROM comments WHERE deleted_at IS NULL AND content_id = ? AND (id IN (SELECT id FROM matched) OR reply_to_id IN (SELECT id FROM matched))`, append(matchArgs, contentID)...).Scan(&totalItems, &totalRoots); err != nil {
		return CommentListResult{}, err
	}
	page, totalPages := clampPagination(page, pageSize, totalRoots)
	result := CommentListResult{Page: page, PageSize: pageSize, TotalItems: totalItems, TotalPages: totalPages}

	offset := (page - 1) * pageSize
	roots, err := s.scanComments(matched+`SELECT `+commentColumns+` FROM comments WHERE id IN (SELECT id FROM matched) ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?`, append(matchArgs, pageSize, offset)...)
	if err != nil {
		return CommentListResult{}, err
	}
	result.Comments = roots
	if len(roots) == 0 {
		return result, nil
	}
	replies, err := s.scanComments(matched+`SELECT `+commentColumns+` FROM comments WHERE deleted_at IS NULL AND content_id = ? AND reply_to_id IS NOT NULL AND reply_to_id IN (SELECT id FROM matched ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?) ORDER BY created_at ASC, id ASC`, append(matchArgs, contentID, pageSize, offset)...)
	if err != nil {
		return CommentListResult{}, err
	}
	result.Comments = append(roots, replies...)
	for index := range result.Comments {
		redactHiddenComment(&result.Comments[index])
	}
	return result, nil
}

type AdminCommentListOptions struct {
	ContentID string
	Page      int
	PageSize  int
	Query     string
	Focus     string
}

type AdminCommentListResult struct {
	Comments   []model.AdminComment
	Page       int
	PageSize   int
	TotalItems int
	TotalPages int
}

// matchedAdminCommentThreads is the thread-matching CTE without the visibility
// filter so deleted replies still pull their root into the result set.
func matchedAdminCommentThreads() string {
	return `WITH matched AS (
		SELECT id, created_at FROM comments
		WHERE (? = '' OR content_id = ?) AND reply_to_id IS NULL
		AND (? = '' OR INSTR(LOWER(author_name), ?) > 0 OR INSTR(LOWER(body), ?) > 0
			OR EXISTS (SELECT 1 FROM comments reply WHERE reply.reply_to_id = comments.id AND (INSTR(LOWER(reply.author_name), ?) > 0 OR INSTR(LOWER(reply.body), ?) > 0)))
	)`
}

const adminCommentColumns = `comments.id, comments.content_id, comments.author_name, comments.author_url, comments.body, comments.created_at, comments.reply_to_id, comments.avatar_seed, comments.author_provider, comments.author_avatar_url, comments.deleted_at, comments.hidden_at, COALESCE(content.title, ''), content.slug, COALESCE(content.kind, '')`

func (s *Store) scanAdminComments(query string, args ...any) ([]model.AdminComment, error) {
	rows, err := s.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []model.AdminComment{}
	for rows.Next() {
		var c model.AdminComment
		var authorURL, replyToID, deletedAt, hiddenAt sql.NullString
		if err := rows.Scan(&c.ID, &c.ContentID, &c.AuthorName, &authorURL, &c.Body, &c.CreatedAt, &replyToID, &c.AvatarSeed, &c.AuthorProvider, &c.AuthorAvatarURL, &deletedAt, &hiddenAt, &c.ContentTitle, &c.ContentSlug, &c.ContentKind); err != nil {
			return nil, err
		}
		if authorURL.Valid {
			c.AuthorURL = &authorURL.String
		}
		if replyToID.Valid {
			c.ReplyToID = &replyToID.String
		}
		if deletedAt.Valid {
			c.DeletedAt = &deletedAt.String
		}
		if hiddenAt.Valid {
			c.HiddenAt = &hiddenAt.String
		}
		c.Hidden = hiddenAt.Valid
		items = append(items, c)
	}
	return items, rows.Err()
}

// ListAdminComments paginates threads newest-root-first, includes soft-deleted
// rows, and spans every content item when ContentID is empty. When Focus is a
// comment id (root or reply), the page holding its thread is returned.
func (s *Store) ListAdminComments(options AdminCommentListOptions) (AdminCommentListResult, error) {
	pageSize := options.PageSize
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	page := options.Page
	if page < 1 {
		page = 1
	}
	needle := strings.ToLower(strings.TrimSpace(options.Query))
	matched := matchedAdminCommentThreads()
	matchArgs := []any{options.ContentID, options.ContentID, needle, needle, needle, needle, needle}

	var totalItems, totalRoots int
	if err := s.DB.QueryRow(matched+`SELECT COUNT(*), COALESCE(SUM(CASE WHEN comments.reply_to_id IS NULL THEN 1 ELSE 0 END), 0) FROM comments WHERE (? = '' OR content_id = ?) AND (id IN (SELECT id FROM matched) OR reply_to_id IN (SELECT id FROM matched))`, append(matchArgs, options.ContentID, options.ContentID)...).Scan(&totalItems, &totalRoots); err != nil {
		return AdminCommentListResult{}, err
	}
	if options.Focus != "" && totalRoots > 0 {
		page = s.adminFocusPage(matched, matchArgs, options.Focus, pageSize)
	}
	page, totalPages := clampPagination(page, pageSize, totalRoots)
	result := AdminCommentListResult{Page: page, PageSize: pageSize, TotalItems: totalItems, TotalPages: totalPages}

	offset := (page - 1) * pageSize
	roots, err := s.scanAdminComments(matched+`SELECT `+adminCommentColumns+` FROM comments JOIN content ON content.id = comments.content_id WHERE comments.id IN (SELECT id FROM matched) ORDER BY comments.created_at DESC, comments.id DESC LIMIT ? OFFSET ?`, append(matchArgs, pageSize, offset)...)
	if err != nil {
		return AdminCommentListResult{}, err
	}
	if len(roots) == 0 {
		result.Comments = []model.AdminComment{}
		return result, nil
	}
	replies, err := s.scanAdminComments(matched+`SELECT `+adminCommentColumns+` FROM comments JOIN content ON content.id = comments.content_id WHERE (? = '' OR comments.content_id = ?) AND comments.reply_to_id IS NOT NULL AND comments.reply_to_id IN (SELECT id FROM matched ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?) ORDER BY comments.created_at ASC, comments.id ASC`, append(matchArgs, options.ContentID, options.ContentID, pageSize, offset)...)
	if err != nil {
		return AdminCommentListResult{}, err
	}
	result.Comments = append(roots, replies...)
	return result, nil
}

// adminFocusPage resolves the 1-based page holding the focused thread by
// counting matching roots created after it (newest-first ordering).
func (s *Store) adminFocusPage(matched string, matchArgs []any, focus string, pageSize int) int {
	focusRoot := focus
	var replyTo sql.NullString
	if err := s.DB.QueryRow(`SELECT reply_to_id FROM comments WHERE id = ?`, focus).Scan(&replyTo); err != nil {
		return 1
	}
	if replyTo.Valid {
		focusRoot = replyTo.String
	}
	var earlier int
	if err := s.DB.QueryRow(matched+`SELECT COUNT(*) FROM comments WHERE id IN (SELECT id FROM matched) AND (created_at > (SELECT created_at FROM comments WHERE id = ?) OR (created_at = (SELECT created_at FROM comments WHERE id = ?) AND id > (SELECT id FROM comments WHERE id = ?)))`, append(matchArgs, focusRoot, focusRoot, focusRoot)...).Scan(&earlier); err != nil {
		return 1
	}
	return earlier/pageSize + 1
}

// CreateComment appends a comment and keeps the content row's comment_count in
// sync inside one transaction. authorProvider is "visitor" (avatar comes from
// avatarSeed) or an OAuth provider with authorAvatarURL carrying the snapshot.
func (s *Store) CreateComment(contentID, authorName string, authorURL *string, body string, replyToID *string, avatarSeed, authorProvider, authorAvatarURL string) (model.Comment, error) {
	tx, err := s.DB.Begin()
	if err != nil {
		return model.Comment{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if replyToID != nil && *replyToID != "" {
		var replyContentID string
		var deletedAt sql.NullString
		err := tx.QueryRow(`SELECT content_id, deleted_at FROM comments WHERE id = ?`, *replyToID).Scan(&replyContentID, &deletedAt)
		if errors.Is(err, sql.ErrNoRows) {
			return model.Comment{}, ErrCommentReplyInvalid
		}
		if err != nil {
			return model.Comment{}, err
		}
		if replyContentID != contentID || deletedAt.Valid {
			return model.Comment{}, ErrCommentReplyInvalid
		}
	}
	id := newID("comment")
	created := nowRFC3339()
	if _, err := tx.Exec(`INSERT INTO comments (id, content_id, author_name, author_url, body, reply_to_id, avatar_seed, author_provider, author_avatar_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, contentID, authorName, authorURL, body, replyToID, avatarSeed, authorProvider, authorAvatarURL, created); err != nil {
		return model.Comment{}, err
	}
	if err := refreshCommentCountTx(tx, contentID); err != nil {
		return model.Comment{}, err
	}
	if err := tx.Commit(); err != nil {
		return model.Comment{}, err
	}
	return model.Comment{ID: id, ContentID: contentID, AuthorName: authorName, AuthorURL: authorURL, Body: body, CreatedAt: created, ReplyToID: replyToID, AvatarSeed: avatarSeed, AuthorProvider: authorProvider, AuthorAvatarURL: authorAvatarURL}, nil
}

func (s *Store) SoftDeleteComment(id string) (string, error) {
	tx, err := s.DB.Begin()
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback() }()
	var contentID string
	err = tx.QueryRow(`UPDATE comments SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL RETURNING content_id`, nowRFC3339(), id).Scan(&contentID)
	if err != nil {
		return "", err
	}
	if err := refreshCommentCountTx(tx, contentID); err != nil {
		return "", err
	}
	return contentID, tx.Commit()
}

func (s *Store) RestoreComment(id string) (string, error) {
	tx, err := s.DB.Begin()
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback() }()
	var contentID string
	err = tx.QueryRow(`UPDATE comments SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL RETURNING content_id`, id).Scan(&contentID)
	if err != nil {
		return "", err
	}
	if err := refreshCommentCountTx(tx, contentID); err != nil {
		return "", err
	}
	return contentID, tx.Commit()
}

type CommentAuthorUpdate struct {
	AuthorName   *string
	AuthorURL    *string
	HasAuthorURL bool
	AvatarSeed   *string
}

func (s *Store) HideComment(id string) (string, error) {
	return s.setCommentHidden(id, true)
}

func (s *Store) UnhideComment(id string) (string, error) {
	return s.setCommentHidden(id, false)
}

func (s *Store) setCommentHidden(id string, hidden bool) (string, error) {
	tx, err := s.DB.Begin()
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback() }()
	var deletedAt sql.NullString
	if err := tx.QueryRow(`SELECT deleted_at FROM comments WHERE id = ?`, id).Scan(&deletedAt); err != nil {
		return "", err
	}
	if deletedAt.Valid {
		return "", ErrCommentDeleted
	}
	var contentID string
	value := any(nil)
	if hidden {
		value = nowRFC3339()
	}
	if err := tx.QueryRow(`UPDATE comments SET hidden_at = ? WHERE id = ? AND deleted_at IS NULL RETURNING content_id`, value, id).Scan(&contentID); err != nil {
		return "", err
	}
	if err := refreshCommentCountTx(tx, contentID); err != nil {
		return "", err
	}
	return contentID, tx.Commit()
}

func (s *Store) UpdateCommentAuthor(id string, update CommentAuthorUpdate) (string, error) {
	tx, err := s.DB.Begin()
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback() }()
	var deletedAt sql.NullString
	if err := tx.QueryRow(`SELECT deleted_at FROM comments WHERE id = ?`, id).Scan(&deletedAt); err != nil {
		return "", err
	}
	if deletedAt.Valid {
		return "", ErrCommentDeleted
	}
	assignments := []string{}
	args := []any{}
	if update.AuthorName != nil {
		assignments = append(assignments, "author_name = ?")
		args = append(args, *update.AuthorName)
	}
	if update.HasAuthorURL {
		assignments = append(assignments, "author_url = ?")
		if update.AuthorURL == nil {
			args = append(args, nil)
		} else {
			args = append(args, *update.AuthorURL)
		}
	}
	if update.AvatarSeed != nil {
		assignments = append(assignments, "avatar_seed = ?")
		args = append(args, *update.AvatarSeed)
	}
	var contentID string
	if len(assignments) == 0 {
		if err := tx.QueryRow(`SELECT content_id FROM comments WHERE id = ? AND deleted_at IS NULL`, id).Scan(&contentID); err != nil {
			return "", err
		}
	} else {
		args = append(args, id)
		query := `UPDATE comments SET ` + strings.Join(assignments, ", ") + ` WHERE id = ? AND deleted_at IS NULL RETURNING content_id`
		if err := tx.QueryRow(query, args...).Scan(&contentID); err != nil {
			return "", err
		}
	}
	return contentID, tx.Commit()
}

func refreshCommentCountTx(tx *sql.Tx, contentID string) error {
	var count int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM comments WHERE content_id = ? AND deleted_at IS NULL AND hidden_at IS NULL AND (reply_to_id IS NULL OR reply_to_id IN (SELECT id FROM comments WHERE content_id = ? AND reply_to_id IS NULL AND deleted_at IS NULL))`, contentID, contentID).Scan(&count); err != nil {
		return err
	}
	_, err := tx.Exec(`UPDATE content SET comment_count = ? WHERE id = ?`, count, contentID)
	return err
}

func (s *Store) GetLikeSummary(contentID, visitorID string) (model.LikeSummary, error) {
	var summary model.LikeSummary
	var viewerLiked int
	err := s.DB.QueryRow(`
		SELECT (SELECT like_count FROM content WHERE id = ?),
		EXISTS(SELECT 1 FROM likes WHERE content_id = ? AND visitor_id = ?)`, contentID, contentID, visitorID).Scan(&summary.LikeCount, &viewerLiked)
	if err != nil {
		return summary, err
	}
	summary.ViewerLiked = viewerLiked == 1
	return summary, nil
}

// SetLike/DeleteLike keep the content row's like_count in sync in the same
// transaction as the like row change.
func (s *Store) SetLike(contentID, visitorID string) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.Exec(`INSERT OR IGNORE INTO likes (id, content_id, visitor_id, created_at) VALUES (?, ?, ?, ?)`, "like_"+contentID+"_"+visitorID, contentID, visitorID, nowRFC3339())
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err == nil && affected > 0 {
		if _, err := tx.Exec(`UPDATE content SET like_count = like_count + 1 WHERE id = ?`, contentID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) DeleteLike(contentID, visitorID string) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.Exec(`DELETE FROM likes WHERE content_id = ? AND visitor_id = ?`, contentID, visitorID)
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err == nil && affected > 0 {
		if _, err := tx.Exec(`UPDATE content SET like_count = like_count - 1 WHERE id = ?`, contentID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// RecordContentView increments the cumulative public view counter and appends
// a per-day analytics event. Identified visitors dedupe to one event per
// content per UTC day via the partial unique index.
func (s *Store) RecordContentView(contentID, visitorID, referrer string) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`UPDATE content SET view_count = view_count + 1 WHERE id = ?`, contentID); err != nil {
		return err
	}
	now := timeNowUTC()
	day := now.Format("2006-01-02")
	if visitorID == "" {
		if _, err := tx.Exec(`INSERT INTO content_view_events (content_id, visitor_id, referrer, day, created_at) VALUES (?, '', ?, ?, ?)`, contentID, referrer, day, now.Format(time.RFC3339)); err != nil {
			return err
		}
	} else {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO content_view_events (content_id, visitor_id, referrer, day, created_at) VALUES (?, ?, ?, ?, ?)`, contentID, visitorID, referrer, day, now.Format(time.RFC3339)); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// GetCommentByID loads one comment with its moderation state and content
// join for the anchoring verify endpoint; ErrNoRows for unknown ids.
func (s *Store) GetCommentByID(id string) (model.AdminComment, error) {
	comments, err := s.scanAdminComments(`SELECT `+adminCommentColumns+` FROM comments JOIN content ON content.id = comments.content_id WHERE comments.id = ?`, id)
	if err != nil {
		return model.AdminComment{}, err
	}
	if len(comments) == 0 {
		return model.AdminComment{}, sql.ErrNoRows
	}
	return comments[0], nil
}
