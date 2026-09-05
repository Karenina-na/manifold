package model

type ContentKind string

const (
	ContentKindThought ContentKind = "THOUGHT"
	ContentKindArticle ContentKind = "ARTICLE"
)

type ContentStatus string

const (
	StatusDraft     ContentStatus = "DRAFT"
	StatusPublished ContentStatus = "PUBLISHED"
	StatusDeleted   ContentStatus = "DELETED"
)

type ProfileEducationItem struct {
	Institution string `json:"institution"`
	Program     string `json:"program"`
	Period      string `json:"period"`
}

type ProfileExperienceItem struct {
	Organization string `json:"organization"`
	Role         string `json:"role"`
	Period       string `json:"period"`
}

type ProfileSeriesItem struct {
	Name        string  `json:"name"`
	URL         string  `json:"url"`
	Description string  `json:"description"`
	Category    *string `json:"category"`
}

type ProfileContact struct {
	Label  string  `json:"label"`
	URL    string  `json:"url"`
	Handle *string `json:"handle"`
	Icon   *string `json:"icon"`
}

type Profile struct {
	ID           string                  `json:"id"`
	DisplayName  string                  `json:"displayName"`
	Handle       string                  `json:"handle"`
	Headline     string                  `json:"headline"`
	Bio          string                  `json:"bio"`
	AvatarURL    string                  `json:"avatarUrl"`
	Location     string                  `json:"location"`
	Organization string                  `json:"organization"`
	WebsiteURL   string                  `json:"websiteUrl"`
	ResumeURL    *string                 `json:"resumeUrl"`
	Interests    []string                `json:"interests"`
	Education    []ProfileEducationItem  `json:"education"`
	Experience   []ProfileExperienceItem `json:"experience"`
	Series       []ProfileSeriesItem     `json:"series"`
	Contacts     []ProfileContact        `json:"contacts"`
	UpdatedAt    string                  `json:"updatedAt"`
}

// ThoughtMetadata is the whole metadata object for THOUGHT content. Null means
// "no value"; keys are always emitted.
type ThoughtMetadata struct {
	Mood     *string `json:"mood"`
	Question *string `json:"question"`
	Context  *string `json:"context"`
	Source   *string `json:"source"`
}

type TocItem struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Level int    `json:"level"`
}

// ArticleMetadata is the whole metadata object for ARTICLE content.
// readingMinutes and toc are derived by Core on save.
type ArticleMetadata struct {
	ReadingMinutes int       `json:"readingMinutes"`
	Toc            []TocItem `json:"toc"`
	Language       *string   `json:"language"`
	AiAssisted     bool      `json:"aiAssisted"`
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

type SiteNavigationItem struct {
	Label    string `json:"label" validate:"required,max=80"`
	Href     string `json:"href" validate:"required,max=200"`
	External bool   `json:"external"`
}

// MediaReference is one content row that embeds a media URL in its body.
type MediaReference struct {
	ContentID string        `json:"contentId"`
	Kind      ContentKind   `json:"kind"`
	Title     *string       `json:"title"`
	Slug      string        `json:"slug"`
	Status    ContentStatus `json:"status"`
}

type ThoughtConfig struct {
	PinnedIds []string `json:"pinnedIds"`
	UpdatedAt string   `json:"updatedAt"`
}

type WritingConfig struct {
	PinnedIds []string `json:"pinnedIds"`
	UpdatedAt string   `json:"updatedAt"`
}

type Pagination struct {
	Page       int `json:"page"`
	PageSize   int `json:"pageSize"`
	TotalItems int `json:"totalItems"`
	TotalPages int `json:"totalPages"`
}

type TagSummary struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// Comment is the public comment shape; moderation timestamps exist only in the
// admin view.
type Comment struct {
	ID         string  `json:"id"`
	ContentID  string  `json:"contentId"`
	AuthorName string  `json:"authorName"`
	AuthorURL  *string `json:"authorUrl"`
	Body       string  `json:"body"`
	CreatedAt  string  `json:"createdAt"`
	ReplyToID  *string `json:"replyToId"`
	AvatarSeed string  `json:"avatarSeed"`
	Hidden     bool    `json:"hidden"`
}

type AdminComment struct {
	Comment
	DeletedAt    *string     `json:"deletedAt"`
	HiddenAt     *string     `json:"hiddenAt"`
	ContentTitle string      `json:"contentTitle"`
	ContentSlug  string      `json:"contentSlug"`
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
	Title        *string     `json:"title"`
	ViewCount    int         `json:"viewCount"`
	LikeCount    int         `json:"likeCount"`
	CommentCount int         `json:"commentCount"`
}

type AdminOverviewTrendPoint struct {
	Month     string `json:"month"`
	Created   int    `json:"created"`
	Published int    `json:"published"`
}

type AdminOverviewTrend struct {
	Monthly []AdminOverviewTrendPoint `json:"monthly"`
}

type AdminOverview struct {
	Content    AdminOverviewContent       `json:"content"`
	Trend      AdminOverviewTrend         `json:"trend"`
	TopContent []AdminOverviewContentItem `json:"topContent"`
	Tags       []TagSummary               `json:"tags"`
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
	ID           string  `json:"id"`
	EventName    string  `json:"eventName"`
	ResourceType string  `json:"resourceType"`
	ResourceID   string  `json:"resourceId"`
	Actor        string  `json:"actor"`
	RequestID    *string `json:"requestId"`
	TraceID      *string `json:"traceId"`
	MetadataJSON string  `json:"metadataJson"`
	CreatedAt    string  `json:"createdAt"`
}

type AuditEventList struct {
	Events     []AuditEvent `json:"events"`
	Pagination Pagination   `json:"pagination"`
}
