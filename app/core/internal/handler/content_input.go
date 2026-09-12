package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

// contentInput is the create payload. Metadata is decoded as raw JSON and
// validated against the kind; derived fields (readingMinutes/toc) are
// rejected as input.
type contentInput struct {
	Kind     model.ContentKind `json:"kind" validate:"required,oneof=THOUGHT ARTICLE"`
	Slug     json.RawMessage   `json:"slug"`
	Title    json.RawMessage   `json:"title"`
	Summary  json.RawMessage   `json:"summary"`
	Body     json.RawMessage   `json:"body"`
	Tags     json.RawMessage   `json:"tags"`
	Metadata json.RawMessage   `json:"metadata"`
}

type contentUpdateInput struct {
	Kind            model.ContentKind `json:"kind" validate:"required,oneof=THOUGHT ARTICLE"`
	Slug            json.RawMessage   `json:"slug"`
	Title           json.RawMessage   `json:"title"`
	Summary         json.RawMessage   `json:"summary"`
	Body            json.RawMessage   `json:"body"`
	Tags            json.RawMessage   `json:"tags"`
	Metadata        json.RawMessage   `json:"metadata"`
	ExpectedVersion int               `json:"expectedVersion" validate:"required,min=1"`
}

func (h *apiHandler) decodeContentInput(w http.ResponseWriter, r *http.Request) (model.ContentInput, error) {
	var input contentInput
	if err := decodeJSON(w, r, &input); err != nil || h.validate.Struct(input) != nil {
		if errors.Is(err, errBodyTooLarge) {
			// decodeJSON already answered with 413; the caller must not write.
			return model.ContentInput{}, err
		}
		return model.ContentInput{}, errors.New("kind, slug, title, summary, body, tags, and metadata are required")
	}
	slug, err := requiredString(input.Slug, "slug", false, 160)
	if err != nil {
		return model.ContentInput{}, err
	}
	title, err := nullableString(input.Title, "title", 200)
	if err != nil {
		return model.ContentInput{}, err
	}
	summary, err := requiredString(input.Summary, "summary", false, 4000)
	if err != nil {
		return model.ContentInput{}, err
	}
	body, err := requiredString(input.Body, "body", false, 100000)
	if err != nil || strings.TrimSpace(body) == "" {
		return model.ContentInput{}, errors.New("body is required")
	}
	var tags []string
	if err := decodeRequiredArray(input.Tags, "tags", &tags); err != nil {
		return model.ContentInput{}, err
	}
	if err := validateInputTags(tags); err != nil {
		return model.ContentInput{}, err
	}
	if err := validateMetadataInput(input.Kind, input.Metadata); err != nil {
		return model.ContentInput{}, err
	}
	return model.ContentInput{
		Kind: input.Kind, Slug: strings.TrimSpace(slug), Title: title,
		Summary: summary, Body: body, Tags: tags,
		EditorialMetadata: input.Metadata,
	}, nil
}

func requiredString(raw json.RawMessage, name string, allowNull bool, max int) (string, error) {
	if len(raw) == 0 {
		return "", fmt.Errorf("%s is required", name)
	}
	if string(raw) == "null" {
		if allowNull {
			return "", nil
		}
		return "", fmt.Errorf("%s must be a string", name)
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil || len(value) > max {
		return "", fmt.Errorf("%s must be a string of at most %d characters", name, max)
	}
	return value, nil
}

func nullableString(raw json.RawMessage, name string, max int) (*string, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("%s is required and may be null", name)
	}
	if string(raw) == "null" {
		return nil, nil
	}
	value, err := requiredString(raw, name, false, max)
	if err != nil {
		return nil, err
	}
	return &value, nil
}

func decodeRequiredArray(raw json.RawMessage, name string, dst *[]string) error {
	if len(raw) == 0 || string(raw) == "null" {
		return fmt.Errorf("%s is required and must be an array", name)
	}
	if err := json.Unmarshal(raw, dst); err != nil || *dst == nil {
		return fmt.Errorf("%s must be an array", name)
	}
	return nil
}

func (h *apiHandler) decodeContentUpdateInput(w http.ResponseWriter, r *http.Request) (store.ContentUpdate, error) {
	var input contentUpdateInput
	if err := decodeJSON(w, r, &input); err != nil || h.validate.Struct(input) != nil {
		if errors.Is(err, errBodyTooLarge) {
			// decodeJSON already answered with 413; the caller must not write.
			return store.ContentUpdate{}, err
		}
		return store.ContentUpdate{}, errors.New("complete content input and expectedVersion are required")
	}
	slug, err := requiredString(input.Slug, "slug", false, 160)
	if err != nil {
		return store.ContentUpdate{}, err
	}
	title, err := nullableString(input.Title, "title", 200)
	if err != nil {
		return store.ContentUpdate{}, err
	}
	summary, err := requiredString(input.Summary, "summary", false, 4000)
	if err != nil {
		return store.ContentUpdate{}, err
	}
	body, err := requiredString(input.Body, "body", false, 100000)
	if err != nil || strings.TrimSpace(body) == "" {
		return store.ContentUpdate{}, errors.New("body is required")
	}
	var tags []string
	if err := decodeRequiredArray(input.Tags, "tags", &tags); err != nil {
		return store.ContentUpdate{}, err
	}
	if err := validateInputTags(tags); err != nil {
		return store.ContentUpdate{}, err
	}
	if err := validateMetadataInput(input.Kind, input.Metadata); err != nil {
		return store.ContentUpdate{}, err
	}
	return store.ContentUpdate{Kind: &input.Kind, Slug: &slug, Title: title, TitleSet: true, Summary: &summary, Body: &body, Tags: &tags, Metadata: input.Metadata, ExpectedVersion: input.ExpectedVersion}, nil
}

func validateInputTags(tags []string) error {
	if len(tags) > 10 {
		return errors.New("too many tags")
	}
	for _, raw := range tags {
		canonical := strings.Join(strings.Fields(strings.TrimSpace(raw)), " ")
		if canonical == "" || utf8.RuneCountInString(canonical) > 80 {
			return errors.New("tags must be 1-80 characters")
		}
	}
	return nil
}

// validateContentSemantics enforces kind-level rules that structs cannot
// express: articles require a title; every kind requires a slug.
func validateContentSemantics(kind model.ContentKind, title *string, slug string) error {
	if strings.TrimSpace(slug) == "" {
		return errors.New("slug is required")
	}
	if kind == model.ContentKindArticle && (title == nil || strings.TrimSpace(*title) == "") {
		return errors.New("articles require a title")
	}
	return nil
}

// validateMetadataInput rejects malformed metadata and client-supplied
// derived fields. Editorial keys are checked per kind; unknown keys are
// rejected explicitly, and wrong types fail loudly.
func validateMetadataInput(kind model.ContentKind, raw json.RawMessage) error {
	if len(raw) == 0 {
		return errors.New("metadata is required")
	}
	var values map[string]any
	if err := json.Unmarshal(raw, &values); err != nil {
		return errors.New("metadata must be an object")
	}
	if values == nil {
		return errors.New("metadata must be an object")
	}
	for _, derived := range []string{"readingMinutes", "toc"} {
		if _, exists := values[derived]; exists {
			return fmt.Errorf("metadata.%s is derived by Core and cannot be set", derived)
		}
	}
	stringField := func(name string, max int) error {
		value, ok := values[name]
		if !ok || value == nil {
			return nil
		}
		text, isString := value.(string)
		if !isString || len(strings.TrimSpace(text)) > max {
			return fmt.Errorf("metadata.%s must be a string of at most %d characters", name, max)
		}
		return nil
	}
	switch kind {
	case model.ContentKindThought:
		allowed := map[string]bool{"mood": true, "question": true, "context": true, "source": true}
		for key := range values {
			if !allowed[key] {
				return fmt.Errorf("metadata.%s is not supported", key)
			}
		}
		for _, field := range []string{"mood", "question", "context", "source"} {
			if _, ok := values[field]; !ok {
				return fmt.Errorf("metadata.%s is required", field)
			}
			if err := stringField(field, 2000); err != nil {
				return err
			}
		}
		return nil
	case model.ContentKindArticle:
		allowed := map[string]bool{"language": true, "aiAssisted": true}
		for key := range values {
			if !allowed[key] {
				return fmt.Errorf("metadata.%s is not supported", key)
			}
		}
		if err := stringField("language", 80); err != nil {
			return err
		}
		if _, ok := values["language"]; !ok {
			return errors.New("metadata.language is required")
		}
		if aiAssisted, ok := values["aiAssisted"]; ok && aiAssisted != nil {
			if _, valid := aiAssisted.(bool); !valid {
				return errors.New("metadata.aiAssisted must be a boolean")
			}
		}
		if aiAssisted, ok := values["aiAssisted"]; ok && aiAssisted == nil {
			return errors.New("metadata.aiAssisted must be a boolean")
		}
		if _, ok := values["aiAssisted"]; !ok {
			return errors.New("metadata.aiAssisted is required")
		}
		return nil
	default:
		return errors.New("kind is invalid")
	}
}
