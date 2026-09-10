package application

import (
	"sort"

	"github.com/manifold-space/manifold/app/core/internal/chain"
	"github.com/manifold-space/manifold/app/core/internal/model"
)

func ContentPayload(c model.Content) ([]byte, string, string, map[string]any, error) {
	editorial := map[string]any{}
	switch metadata := c.Metadata.(type) {
	case model.ThoughtMetadata:
		editorial["mood"] = nullable(metadata.Mood)
		editorial["question"] = nullable(metadata.Question)
		editorial["context"] = nullable(metadata.Context)
		editorial["source"] = nullable(metadata.Source)
	case model.ArticleMetadata:
		editorial["language"] = nullable(metadata.Language)
		editorial["aiAssisted"] = metadata.AiAssisted
	}
	tags := append([]string(nil), c.Tags...)
	sort.Strings(tags)
	canonical, err := chain.CanonicalJSON(map[string]any{
		"kind": string(c.Kind), "slug": c.Slug, "title": nullable(c.Title),
		"summary": c.Summary, "body": c.Body, "tags": tags, "metadata": editorial,
	})
	if err != nil {
		return nil, "", "", nil, err
	}
	return []byte(canonical), "", c.ID, map[string]any{
		"contentId": c.ID, "kind": string(c.Kind), "status": string(c.Status), "version": c.Version, "slug": c.Slug,
	}, nil
}

func CommentPayload(c model.Comment, action string) ([]byte, string, string, map[string]any, error) {
	payload, err := commentPayload(c, true)
	if err != nil {
		return nil, "", "", nil, err
	}
	return payload, "", c.ID, map[string]any{"commentId": c.ID, "contentId": c.ContentID, "action": action}, nil
}

func CommentPayloadHashes(c model.Comment) ([]string, error) {
	current, _, _, _, err := CommentPayload(c, "created")
	if err != nil {
		return nil, err
	}
	legacy, err := commentPayload(c, false)
	if err != nil {
		return nil, err
	}
	return []string{chain.SubjectHashHex(current), chain.SubjectHashHex(legacy)}, nil
}

func commentPayload(c model.Comment, includeAvatar bool) ([]byte, error) {
	fields := map[string]any{
		"contentId": c.ContentID, "authorName": c.AuthorName, "authorUrl": nullable(c.AuthorURL),
		"authorProvider": c.AuthorProvider, "body": c.Body,
		"replyToId": nullable(c.ReplyToID), "avatarSeed": c.AvatarSeed,
	}
	if includeAvatar {
		fields["authorAvatarUrl"] = c.AuthorAvatarURL
	}
	canonical, err := chain.CanonicalJSON(fields)
	return []byte(canonical), err
}

func ReactionActionPayload(contentID, visitorID, action string) ([]byte, string, string, map[string]any, error) {
	canonical, err := chain.CanonicalJSON(map[string]any{"contentId": contentID, "visitorId": visitorID, "action": action})
	return []byte(canonical), "", "", map[string]any{"contentId": contentID, "action": action}, err
}

func ProfilePayload(input model.Profile) ([]byte, string, string, map[string]any, error) {
	canonical, err := chain.CanonicalJSON(map[string]any{
		"displayName": input.DisplayName, "handle": input.Handle, "headline": input.Headline,
		"bio": input.Bio, "avatarUrl": input.AvatarURL, "location": input.Location,
		"organization": input.Organization, "websiteUrl": input.WebsiteURL,
		"resumeUrl": nullable(input.ResumeURL), "interests": input.Interests,
		"education": input.Education, "experience": input.Experience,
		"series": input.Series, "contacts": input.Contacts,
	})
	return []byte(canonical), "", "profile_1", map[string]any{}, err
}

func SitePayload(input model.SiteConfig) ([]byte, string, string, map[string]any, error) {
	canonical, err := chain.CanonicalJSON(map[string]any{
		"title": input.Title, "description": input.Description, "footer": input.Footer,
		"social": input.Social, "commentsEnabled": input.CommentsEnabled,
		"navigation": input.Navigation, "sections": input.Sections,
	})
	return []byte(canonical), "", "site_1", map[string]any{"target": "site"}, err
}

func PinsPayload(kind model.ContentKind, pinnedIDs []string) ([]byte, string, string, map[string]any, error) {
	ids := append([]string(nil), pinnedIDs...)
	canonical, err := chain.CanonicalJSON(map[string]any{"kind": string(kind), "pinnedIds": ids})
	target := "thoughts_1"
	if kind == model.ContentKindArticle {
		target = "writings_1"
	}
	return []byte(canonical), "", target, map[string]any{"target": "pins", "kind": string(kind), "configId": target}, err
}

func MediaUploadPayload(mediaID, mime string, size int64, shaHex, filename string) ([]byte, string, string, map[string]any, error) {
	canonical, err := chain.CanonicalJSON(map[string]any{"mime": mime, "size": size, "sha256": shaHex, "filename": filename})
	return []byte(canonical), "", mediaID, map[string]any{"mediaId": mediaID, "action": "uploaded"}, err
}

func MediaDeletePayload(mediaID string) ([]byte, string, string, map[string]any, error) {
	canonical, err := chain.CanonicalJSON(map[string]any{"mediaId": mediaID, "action": "deleted"})
	return []byte(canonical), "", mediaID, map[string]any{"mediaId": mediaID, "action": "deleted"}, err
}

func AuthActionPayload(username, action, sessionID string) ([]byte, string, string, map[string]any, error) {
	canonical, err := chain.CanonicalJSON(map[string]any{"username": username, "action": action})
	metadata := map[string]any{}
	if sessionID != "" {
		metadata["sessionId"] = sessionID
	}
	return []byte(canonical), "", "", metadata, err
}

func nullable[T any](value *T) any {
	if value == nil {
		return nil
	}
	return *value
}
