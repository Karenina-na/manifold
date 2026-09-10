package handler

import (
	"encoding/json"
	"testing"

	"github.com/manifold-space/manifold/app/core/internal/chain"
	"github.com/manifold-space/manifold/app/core/internal/model"
)

func TestCommentPayloadIncludesProviderAvatarSnapshot(t *testing.T) {
	payload, _, _, _, err := CommentPayload(model.Comment{
		ContentID:       "content_1",
		AuthorName:      "Ada",
		AuthorProvider:  "github",
		AuthorAvatarURL: "https://avatars.example/ada.png",
		Body:            "Hello",
		AvatarSeed:      "ada",
	}, "created")
	if err != nil {
		t.Fatal(err)
	}

	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["authorAvatarUrl"] != "https://avatars.example/ada.png" {
		t.Fatalf("comment payload must cover the provider avatar snapshot: %s", payload)
	}
}

func TestCommentPayloadHashesKeepLegacyCertificatesVerifiable(t *testing.T) {
	comment := model.Comment{
		ContentID:       "content_1",
		AuthorName:      "Ada",
		AuthorProvider:  "github",
		AuthorAvatarURL: "https://avatars.example/ada.png",
		Body:            "Hello",
		AvatarSeed:      "ada",
	}
	hashes, err := commentPayloadHashes(comment)
	if err != nil {
		t.Fatal(err)
	}
	legacy, err := legacyCommentPayload(comment)
	if err != nil {
		t.Fatal(err)
	}
	if len(hashes) != 2 || hashes[1] != chain.SubjectHashHex(legacy) {
		t.Fatalf("expected current and legacy comment hash candidates, got %v", hashes)
	}
	if hashes[0] == hashes[1] {
		t.Fatal("current comment certificate must cover more fields than the legacy projection")
	}
}
