package model

import (
	"bytes"
	"encoding/json"
)

func decodeMetadata(raw json.RawMessage, dst any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	return decoder.Decode(dst)
}

// ContentMetadata is the kind-discriminated metadata union. The zero value is
// used only transiently; stores must call NormalizeMetadata before persisting
// so every row carries the typed shape of its kind.
type ContentMetadata interface{ isContentMetadata() }

func (ThoughtMetadata) isContentMetadata() {}
func (ArticleMetadata) isContentMetadata() {}

// NormalizeMetadataFor returns the canonical metadata for a kind. THOUGHT
// starts from an empty ThoughtMetadata; ARTICLE derives readingMinutes and toc
// from the body and keeps the editorial fields of the supplied input.
func NormalizeMetadataFor(kind ContentKind, body string, raw json.RawMessage) (ContentMetadata, error) {
	switch kind {
	case ContentKindThought:
		metadata := ThoughtMetadata{}
		if len(raw) > 0 {
			if err := decodeMetadata(raw, &metadata); err != nil {
				return nil, err
			}
		}
		return metadata, nil
	case ContentKindArticle:
		metadata := emptyArticleMetadata()
		if len(raw) > 0 {
			if err := decodeMetadata(raw, &metadata); err != nil {
				return nil, err
			}
		}
		// Derived fields are authoritative at the Core boundary.
		metadata.ReadingMinutes = estimateReadingMinutes(body)
		metadata.Toc = deriveTableOfContents(body)
		if metadata.Toc == nil {
			metadata.Toc = []TocItem{}
		}
		return metadata, nil
	default:
		return ThoughtMetadata{}, nil
	}
}

// EmptyMetadataFor returns the canonical empty metadata for a kind.
func EmptyMetadataFor(kind ContentKind) ContentMetadata {
	if kind == ContentKindArticle {
		return emptyArticleMetadata()
	}
	return ThoughtMetadata{}
}

func emptyArticleMetadata() ArticleMetadata {
	return ArticleMetadata{
		Toc: []TocItem{},
	}
}
