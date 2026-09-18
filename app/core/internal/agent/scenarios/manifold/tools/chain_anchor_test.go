package tools_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"

	manifoldtools "github.com/manifold-space/manifold/app/core/internal/agent/scenarios/manifold/tools"
	"github.com/manifold-space/manifold/app/core/internal/chain"
)

type contentAnchorReader struct {
	anchor    chain.Anchor
	err       error
	contentID string
}

func (reader *contentAnchorReader) LatestContentAnchor(_ context.Context, contentID string) (chain.Anchor, error) {
	reader.contentID = contentID
	if reader.err != nil {
		return chain.Anchor{}, reader.err
	}
	return reader.anchor, nil
}

func TestContentAnchorReturnsCertificateStatus(t *testing.T) {
	reader := &contentAnchorReader{anchor: chain.Anchor{
		ID: "cert_1", SubjectHash: "hash", Source: chain.SourceContent, SubjectRef: "content_1",
		Label: "Writing", CreatedAt: "2026-09-18T00:00:00Z", BlockID: "block_1", SitePublicKey: "public",
	}}
	result, err := (manifoldtools.ContentAnchor{Ledger: reader}).Execute(t.Context(), json.RawMessage(`{"contentId":"content_1"}`))
	if err != nil {
		t.Fatal(err)
	}
	if reader.contentID != "content_1" {
		t.Fatalf("unexpected content id: %q", reader.contentID)
	}
	raw, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	var output map[string]any
	if err := json.Unmarshal(raw, &output); err != nil {
		t.Fatal(err)
	}
	if output["anchored"] != true || output["status"] != "anchored" || output["blockId"] != "block_1" {
		t.Fatalf("unexpected anchor result: %s", raw)
	}
}

func TestContentAnchorDoesNotTreatPendingCertificateAsAnchored(t *testing.T) {
	reader := &contentAnchorReader{anchor: chain.Anchor{ID: "cert_1"}}
	result, err := (manifoldtools.ContentAnchor{Ledger: reader}).Execute(t.Context(), json.RawMessage(`{"contentId":"content_1"}`))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	var output map[string]any
	if err := json.Unmarshal(raw, &output); err != nil {
		t.Fatal(err)
	}
	if output["anchored"] != false || output["status"] != "pending" {
		t.Fatalf("unexpected pending anchor result: %s", raw)
	}
}

func TestContentAnchorTreatsMissingCertificateAsKnownUnanchoredState(t *testing.T) {
	reader := &contentAnchorReader{err: sql.ErrNoRows}
	result, err := (manifoldtools.ContentAnchor{Ledger: reader}).Execute(t.Context(), json.RawMessage(`{"contentId":"content_1"}`))
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(result)
	if string(raw) != `{"anchored":false,"contentId":"content_1","status":"unanchored"}` {
		t.Fatalf("unexpected unanchored result: %s", raw)
	}
}
