package model

type ContentKind string

const (
	ContentKindPost     ContentKind = "POST"
	ContentKindNote     ContentKind = "NOTE"
	ContentKindResearch ContentKind = "RESEARCH"
)

type Profile struct {
	ID           string `json:"id"`
	DisplayName  string `json:"displayName"`
	Handle       string `json:"handle"`
	Headline     string `json:"headline"`
	Bio          string `json:"bio"`
	AvatarURL    string `json:"avatarUrl"`
	Location     string `json:"location"`
	Organization string `json:"organization"`
	WebsiteURL   string `json:"websiteUrl"`
	UpdatedAt    string `json:"updatedAt"`
}

type Content struct {
	ID          string      `json:"id"`
	Kind        ContentKind `json:"kind"`
	Status      string      `json:"status"`
	Slug        string      `json:"slug"`
	Title       string      `json:"title"`
	Summary     string      `json:"summary"`
	Body        string      `json:"body,omitempty"`
	Tags        []string    `json:"tags"`
	PublishedAt *string     `json:"publishedAt"`
	CreatedAt   string      `json:"createdAt"`
	UpdatedAt   string      `json:"updatedAt"`
	Version     int         `json:"version"`
	Href        string      `json:"href,omitempty"`
}

type Project struct {
	ID            string   `json:"id"`
	Slug          string   `json:"slug"`
	Name          string   `json:"name"`
	Summary       string   `json:"summary"`
	Description   string   `json:"description"`
	Status        string   `json:"status"`
	Featured      bool     `json:"featured"`
	HomepageURL   string   `json:"homepageUrl"`
	RepositoryURL string   `json:"repositoryUrl"`
	TechStack     []string `json:"techStack"`
	StartedAt     string   `json:"startedAt"`
	UpdatedAt     string   `json:"updatedAt"`
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
	Status     string  `json:"status"`
	CreatedAt  string  `json:"createdAt"`
	ReplyToID  *string `json:"replyToId,omitempty"`
}

type Stats struct {
	ContentCount  int    `json:"contentCount"`
	PostCount     int    `json:"postCount"`
	NoteCount     int    `json:"noteCount"`
	ResearchCount int    `json:"researchCount"`
	WordCount     int    `json:"wordCount"`
	UpdatedAt     string `json:"updatedAt"`
}
