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
	Title           string               `json:"title" validate:"required,max=80"`
	Description     string               `json:"description" validate:"max=200"`
	Footer          string               `json:"footer" validate:"max=200"`
	Social          []SiteNavigationItem `json:"social" validate:"max=6,dive"`
	CommentsEnabled bool                 `json:"commentsEnabled"`
	Navigation      []SiteNavigationItem `json:"navigation" validate:"min=1,max=10,dive"`
	Sections        []string             `json:"sections" validate:"min=1,max=10,unique,dive,required,oneof=PROFILE BACKGROUND RECENT_CONTENT UPDATES SERIES CONTACT"`
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

type WritingConfig struct {
	FeaturedWritingID *string `json:"featuredWritingId"`
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

type WritingArchive struct {
	Featured   *Content       `json:"featured"`
	Data       []Content      `json:"data"`
	Pagination PagePagination `json:"pagination"`
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

type AdminComment struct {
	Comment
	ContentTitle string      `json:"contentTitle"`
	ContentSlug  string      `json:"contentSlug,omitempty"`
	ContentKind  ContentKind `json:"contentKind"`
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

type AdminOverviewContent struct {
	ContentCount   int `json:"contentCount"`
	DraftCount     int `json:"draftCount"`
	ArticleCount   int `json:"articleCount"`
	ThoughtCount   int `json:"thoughtCount"`
	WordCount      int `json:"wordCount"`
	TotalViews     int `json:"totalViews"`
	TotalLikes     int `json:"totalLikes"`
	TotalComments  int `json:"totalComments"`
	ActiveVisitors int `json:"activeVisitors"`
}

type AdminOverviewContentItem struct {
	ID           string      `json:"id"`
	Kind         ContentKind `json:"kind"`
	Slug         string      `json:"slug"`
	Title        string      `json:"title"`
	ViewCount    int         `json:"viewCount"`
	LikeCount    int         `json:"likeCount"`
	CommentCount int         `json:"commentCount"`
}

type AdminOverviewTrendPoint struct {
	Month     string `json:"month"`
	Created   int    `json:"created"`
	Published int    `json:"published"`
}

type AdminOverview struct {
	Content    AdminOverviewContent       `json:"content"`
	Trend      AdminOverviewTrend         `json:"trend"`
	TopContent []AdminOverviewContentItem `json:"topContent"`
	Tags       []TagSummary               `json:"tags"`
}

type AdminOverviewTrend struct {
	Monthly []AdminOverviewTrendPoint `json:"monthly"`
}

type AnalyticsRange struct {
	Days int    `json:"days"`
	From string `json:"from"`
	To   string `json:"to"`
}

type AnalyticsDay struct {
	Date           string `json:"date"`
	Views          int    `json:"views"`
	UniqueVisitors int    `json:"uniqueVisitors"`
}

type AnalyticsReferrer struct {
	Source string `json:"source"`
	Count  int    `json:"count"`
}

type AnalyticsViews struct {
	TotalViews     int                 `json:"totalViews"`
	UniqueVisitors int                 `json:"uniqueVisitors"`
	Range          AnalyticsRange      `json:"range"`
	Daily          []AnalyticsDay      `json:"daily"`
	Referrers      []AnalyticsReferrer `json:"referrers"`
}

type SystemDatabase struct {
	SizeBytes int64 `json:"sizeBytes"`
}

type SystemCaches struct {
	ContentEntries int `json:"contentEntries"`
}

type SystemRuntime struct {
	HeapAllocBytes uint64 `json:"heapAllocBytes"`
	NumGoroutine   int    `json:"numGoroutine"`
	SysRSSBytes    uint64 `json:"sysRssBytes"`
}

type SystemResources struct {
	CPUPercent      float64 `json:"cpuPercent"`
	CPUCores        int     `json:"cpuCores"`
	MemTotalBytes   uint64  `json:"memTotalBytes"`
	MemUsedBytes    uint64  `json:"memUsedBytes"`
	MemUsedPercent  float64 `json:"memUsedPercent"`
	LoadAvg1        float64 `json:"loadAvg1"`
	LoadAvg5        float64 `json:"loadAvg5"`
	LoadAvg15       float64 `json:"loadAvg15"`
	DiskTotalBytes  uint64  `json:"diskTotalBytes"`
	DiskUsedBytes   uint64  `json:"diskUsedBytes"`
	DiskUsedPercent float64 `json:"diskUsedPercent"`
}

type SystemHost struct {
	Hostname   string `json:"hostname"`
	OS         string `json:"os"`
	Platform   string `json:"platform"`
	KernelArch string `json:"kernelArch"`
}

type SystemStatus struct {
	Version         string          `json:"version"`
	StartedAt       string          `json:"startedAt"`
	UptimeSeconds   int64           `json:"uptimeSeconds"`
	Database        SystemDatabase  `json:"database"`
	Caches          SystemCaches    `json:"caches"`
	Runtime         SystemRuntime   `json:"runtime"`
	Resources       SystemResources `json:"resources"`
	Host            SystemHost      `json:"host"`
	AuditEventCount int             `json:"auditEventCount"`
}

type AuditEvent struct {
	ID           string `json:"id"`
	EventName    string `json:"eventName"`
	ResourceType string `json:"resourceType"`
	ResourceID   string `json:"resourceId"`
	Actor        string `json:"actor"`
	MetadataJSON string `json:"metadataJson"`
	CreatedAt    string `json:"createdAt"`
}

type AuditEventList struct {
	Events     []AuditEvent   `json:"events"`
	Pagination PagePagination `json:"pagination"`
}
