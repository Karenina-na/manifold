package model

import "time"

type EntryKind string

const (
	EntryKindArticle  EntryKind = "article"
	EntryKindThought  EntryKind = "thought"
	EntryKindResearch EntryKind = "research"
)

type Profile struct {
	Name      string    `json:"name"`
	Bio       string    `json:"bio"`
	Location  string    `json:"location"`
	AvatarURL string    `json:"avatarUrl"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Entry struct {
	ID          string    `json:"id"`
	Kind        EntryKind `json:"kind"`
	Slug        string    `json:"slug"`
	Title       string    `json:"title"`
	Excerpt     string    `json:"excerpt"`
	Content     string    `json:"content"`
	PublishedAt time.Time `json:"publishedAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type NowStatus struct {
	Title     string    `json:"title"`
	Detail    string    `json:"detail"`
	UpdatedAt time.Time `json:"updatedAt"`
}

