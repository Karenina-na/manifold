package model

import "encoding/json"

// Content is the store's full row projection. It carries every persisted
// field plus the typed metadata; handlers project it into PublicContent or
// AdminContent on the way out, which is where body/status/version visibility
// is decided.
type Content struct {
	ID           string
	Kind         ContentKind
	Status       ContentStatus
	Slug         string
	Title        *string
	Summary      string
	Body         string
	Excerpt      string
	Tags         []string
	Metadata     ContentMetadata
	PublishedAt  *string
	CreatedAt    string
	UpdatedAt    string
	Version      int
	ViewCount    int
	LikeCount    int
	CommentCount int
}

// ContentInput carries the handler-validated create payload into the store;
// EditorialMetadata holds the raw JSON the client sent (without derived
// fields, which the store derives from Body).
type ContentInput struct {
	Kind              ContentKind
	Slug              string
	Title             *string
	Summary           string
	Body              string
	Tags              []string
	EditorialMetadata json.RawMessage
}

func (c *Content) ThoughtMetadata() *ThoughtMetadata {
	if thought, ok := c.Metadata.(ThoughtMetadata); ok {
		return &thought
	}
	return nil
}

func (c *Content) ArticleMetadata() *ArticleMetadata {
	if article, ok := c.Metadata.(ArticleMetadata); ok {
		return &article
	}
	return nil
}

// PublicContent is the wire shape served to anonymous readers. Only published
// content ever reaches this projection, so publishedAt is non-null and
// status/version/body are absent by design.
type PublicContent struct {
	ID           string          `json:"id"`
	Kind         ContentKind     `json:"kind"`
	Slug         string          `json:"slug"`
	Title        *string         `json:"title"`
	Summary      string          `json:"summary"`
	Excerpt      string          `json:"excerpt"`
	Tags         []string        `json:"tags"`
	Metadata     ContentMetadata `json:"metadata"`
	PublishedAt  string          `json:"publishedAt"`
	CreatedAt    string          `json:"createdAt"`
	UpdatedAt    string          `json:"updatedAt"`
	ViewCount    int             `json:"viewCount"`
	LikeCount    int             `json:"likeCount"`
	CommentCount int             `json:"commentCount"`
}

// PublicContentDetail adds the markdown body for detail views. LatestAnchor is
// the anchoring-chain summary (docs/chain.md §11): the newest content-source
// certificate for the row, nil when nothing has been anchored yet.
type PublicContentDetail struct {
	PublicContent
	Body         string          `json:"body"`
	LatestAnchor *AnchorSummary  `json:"latestAnchor"`
}

// AnchorSummary is the wire shape of ContentDetail.latestAnchor.
type AnchorSummary struct {
	AnchorID    string  `json:"anchorId"`
	SubjectHash string  `json:"subjectHash"`
	Status      string  `json:"status"`
	BlockID     *string `json:"blockId"`
}

// AdminContent is the wire shape served to the admin surface: all statuses,
// the optimistic-lock version, and the body.
type AdminContent struct {
	ID           string          `json:"id"`
	Kind         ContentKind     `json:"kind"`
	Status       ContentStatus   `json:"status"`
	Slug         string          `json:"slug"`
	Title        *string         `json:"title"`
	Summary      string          `json:"summary"`
	Excerpt      string          `json:"excerpt"`
	Tags         []string        `json:"tags"`
	Metadata     ContentMetadata `json:"metadata"`
	PublishedAt  *string         `json:"publishedAt"`
	CreatedAt    string          `json:"createdAt"`
	UpdatedAt    string          `json:"updatedAt"`
	Version      int             `json:"version"`
	ViewCount    int             `json:"viewCount"`
	LikeCount    int             `json:"likeCount"`
	CommentCount int             `json:"commentCount"`
	Body         string          `json:"body"`
}

func ToPublicContent(c Content) PublicContent {
	published := ""
	if c.PublishedAt != nil {
		published = *c.PublishedAt
	}
	return PublicContent{
		ID: c.ID, Kind: c.Kind, Slug: c.Slug, Title: c.Title, Summary: c.Summary,
		Excerpt: c.Excerpt, Tags: nonNilTags(c.Tags), Metadata: c.Metadata,
		PublishedAt: published, CreatedAt: c.CreatedAt, UpdatedAt: c.UpdatedAt,
		ViewCount: c.ViewCount, LikeCount: c.LikeCount, CommentCount: c.CommentCount,
	}
}

func ToPublicDetail(c Content) PublicContentDetail {
	return PublicContentDetail{PublicContent: ToPublicContent(c), Body: c.Body}
}

func ToAdminContent(c Content) AdminContent {
	return AdminContent{
		ID: c.ID, Kind: c.Kind, Status: c.Status, Slug: c.Slug, Title: c.Title,
		Summary: c.Summary, Excerpt: c.Excerpt, Tags: nonNilTags(c.Tags), Metadata: c.Metadata,
		PublishedAt: c.PublishedAt, CreatedAt: c.CreatedAt, UpdatedAt: c.UpdatedAt,
		Version: c.Version, ViewCount: c.ViewCount, LikeCount: c.LikeCount, CommentCount: c.CommentCount,
		Body: c.Body,
	}
}

func nonNilTags(tags []string) []string {
	if tags == nil {
		return []string{}
	}
	return tags
}
