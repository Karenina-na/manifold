package model

type ContentKind string

const (
	ContentKindThought ContentKind = "THOUGHT"
	ContentKindArticle ContentKind = "ARTICLE"
)

type Profile struct {
	ID           string              `json:"id"`
	DisplayName  string              `json:"displayName"`
	Handle       string              `json:"handle"`
	Headline     string              `json:"headline"`
	Bio          string              `json:"bio"`
	AvatarURL    string              `json:"avatarUrl"`
	Location     string              `json:"location"`
	Organization string              `json:"organization"`
	WebsiteURL   string              `json:"websiteUrl"`
	ResumeURL    string              `json:"resumeUrl,omitempty"`
	Interests    []string            `json:"interests,omitempty"`
	Education    []map[string]string `json:"education,omitempty"`
	Experience   []map[string]string `json:"experience,omitempty"`
	Series       []map[string]string `json:"series,omitempty"`
	Contacts     []map[string]string `json:"contacts,omitempty"`
	UpdatedAt    string              `json:"updatedAt"`
}

type Content struct {
	ID           string         `json:"id"`
	Kind         ContentKind    `json:"kind"`
	Status       string         `json:"status"`
	Slug         string         `json:"slug,omitempty"`
	Title        string         `json:"title,omitempty"`
	Summary      string         `json:"summary"`
	Excerpt      string         `json:"excerpt,omitempty"`
	Body         string         `json:"body,omitempty"`
	Tags         []string       `json:"tags"`
	PublishedAt  *string        `json:"publishedAt"`
	CreatedAt    string         `json:"createdAt"`
	UpdatedAt    string         `json:"updatedAt"`
	Version      int            `json:"version"`
	Href         string         `json:"href,omitempty"`
	ViewCount    int            `json:"viewCount"`
	LikeCount    int            `json:"likeCount"`
	CommentCount int            `json:"commentCount"`
	Metadata     map[string]any `json:"metadata"`
}

type SiteConfig struct {
	FeaturedContent []SiteContentRef     `json:"featuredContent" validate:"max=10,dive"`
	Navigation      []SiteNavigationItem `json:"navigation" validate:"min=1,max=10,dive"`
	Sections        []string             `json:"sections" validate:"min=1,max=10,dive,required,max=40"`
}

type SiteContentRef struct {
	ID   string      `json:"id" validate:"required,max=160"`
	Kind ContentKind `json:"kind" validate:"required,oneof=THOUGHT ARTICLE"`
}

type SiteNavigationItem struct {
	Label    string `json:"label" validate:"required,max=80"`
	Href     string `json:"href" validate:"required,max=200"`
	External bool   `json:"external"`
}

type ThoughtConfig struct {
	FeaturedThoughtID *string `json:"featuredThoughtId"`
	UpdatedAt         string  `json:"updatedAt"`
}

type PagePagination struct {
	Page       int `json:"page"`
	PageSize   int `json:"pageSize"`
	TotalItems int `json:"totalItems"`
	TotalPages int `json:"totalPages"`
}

type TagSummary struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type ThoughtArchive struct {
	Featured   *Content       `json:"featured"`
	Data       []Content      `json:"data"`
	Pagination PagePagination `json:"pagination"`
}

type NowStatus struct {
	Title     string `json:"title"`
	Detail    string `json:"detail"`
	Mood      string `json:"mood"`
	UpdatedAt string `json:"updatedAt"`
	ExpiresAt string `json:"expiresAt,omitempty"`
}

type Comment struct {
	ID         string  `json:"id"`
	ContentID  string  `json:"contentId"`
	AuthorName string  `json:"authorName"`
	AuthorURL  string  `json:"authorUrl,omitempty"`
	Body       string  `json:"body"`
	CreatedAt  string  `json:"createdAt"`
	ReplyToID  *string `json:"replyToId,omitempty"`
	AvatarSeed string  `json:"avatarSeed,omitempty"`
	DeletedAt  string  `json:"deletedAt,omitempty"`
}

type LikeSummary struct {
	LikeCount   int  `json:"likeCount"`
	ViewerLiked bool `json:"viewerLiked"`
}

type Stats struct {
	ContentCount int    `json:"contentCount"`
	ArticleCount int    `json:"articleCount"`
	ThoughtCount int    `json:"thoughtCount"`
	WordCount    int    `json:"wordCount"`
	UpdatedAt    string `json:"updatedAt"`
}

type PresenceStatus struct {
	ActiveVisitors int    `json:"activeVisitors"`
	ObservedAt     string `json:"observedAt"`
}
