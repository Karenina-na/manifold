package store

import (
	"testing"
	"time"
)

func TestEnsureAdminCredentialSeedsOnce(t *testing.T) {
	ctx := t.Context()
	database, err := Open(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	hash := "$2a$10$abcdefghijklmnopqrstuv"
	if err := database.ensureAdminCredential(ctx, "admin", hash); err != nil {
		t.Fatal(err)
	}
	got, found, err := database.GetAdminCredential(ctx, "admin")
	if err != nil {
		t.Fatal(err)
	}
	if !found {
		t.Fatal("expected the seeded credential to be found")
	}
	if got != hash {
		t.Fatalf("expected hash %q, got %q", hash, got)
	}
	// Seeding a second value must not overwrite the first row.
	if err := database.ensureAdminCredential(ctx, "admin", "different"); err != nil {
		t.Fatal(err)
	}
	got, found, err = database.GetAdminCredential(ctx, "admin")
	if err != nil {
		t.Fatal(err)
	}
	if !found {
		t.Fatal("expected the seeded credential to be found")
	}
	if got != hash {
		t.Fatalf("expected original hash preserved, got %q", got)
	}
}

func TestGetAdminCredentialReportsAMissingUsernameWithoutAnError(t *testing.T) {
	ctx := t.Context()
	database, err := Open(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := database.ensureAdminCredential(ctx, "admin", "$2a$10$abcdefghijklmnopqrstuv"); err != nil {
		t.Fatal(err)
	}
	// "No such username" has to stay distinguishable from "the query failed":
	// auth maps the first to invalid credentials and the second to a 500, and
	// collapsing them was what made an unreachable database look like a wrong
	// password.
	hash, found, err := database.GetAdminCredential(ctx, "nobody")
	if err != nil {
		t.Fatalf("a missing username must not be an error, got %v", err)
	}
	if found || hash != "" {
		t.Fatalf("expected found=false and an empty hash, got %q %v", hash, found)
	}
}

func TestSessionLifecycle(t *testing.T) {
	ctx := t.Context()
	database, err := Open(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	now := time.Now().UTC()
	expires := now.Add(time.Hour)
	if err := database.CreateSession(ctx, "ses_1", "admin", now, expires); err != nil {
		t.Fatal(err)
	}
	live, err := database.SessionLive(ctx, "ses_1", now.Add(30*time.Minute))
	if err != nil || !live {
		t.Fatalf("expected live session, got %v %v", live, err)
	}
	if err := database.RevokeSession(ctx, "ses_1", now); err != nil {
		t.Fatal(err)
	}
	live, err = database.SessionLive(ctx, "ses_1", now.Add(30*time.Minute))
	if err != nil || live {
		t.Fatalf("expected revoked session to be dead, got %v %v", live, err)
	}
	// Missing session is not live.
	live, err = database.SessionLive(ctx, "ses_missing", now)
	if err != nil || live {
		t.Fatalf("expected missing session dead, got %v %v", live, err)
	}
	// An expired session is not live.
	if err := database.CreateSession(ctx, "ses_exp", "admin", now, now.Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	live, err = database.SessionLive(ctx, "ses_exp", now)
	if err != nil || live {
		t.Fatalf("expected expired session dead, got %v %v", live, err)
	}
}

func TestRevokeSessionsExceptCurrent(t *testing.T) {
	ctx := t.Context()
	database, err := Open(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	now := time.Now().UTC()
	for _, id := range []string{"ses_a", "ses_b", "ses_c"} {
		if err := database.CreateSession(ctx, id, "admin", now, now.Add(time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
	if err := database.RevokeSessions(ctx, "admin", "ses_b", now); err != nil {
		t.Fatal(err)
	}
	for id, want := range map[string]bool{"ses_a": false, "ses_b": true, "ses_c": false} {
		live, err := database.SessionLive(ctx, id, now.Add(time.Minute))
		if err != nil {
			t.Fatal(err)
		}
		if live != want {
			t.Fatalf("session %s live=%v, want %v", id, live, want)
		}
	}
}

func TestAdminSessionsListsRowsNewestFirst(t *testing.T) {
	ctx := t.Context()
	database, err := Open(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	now := time.Now().UTC()
	if err := database.CreateSession(ctx, "ses_a", "admin", now.Add(-2*time.Hour), now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := database.CreateSession(ctx, "ses_b", "admin", now.Add(-time.Hour), now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := database.RevokeSession(ctx, "ses_a", now); err != nil {
		t.Fatal(err)
	}
	rows, err := database.AdminSessions(ctx, "admin")
	if err != nil {
		t.Fatal(err)
	}
	// Revoked rows are soft-deleted: only the live session is listed.
	if len(rows) != 1 {
		t.Fatalf("expected 1 live row, got %d", len(rows))
	}
	if rows[0].ID != "ses_b" {
		t.Fatalf("expected newest session first, got %q", rows[0].ID)
	}
	if rows[0].RevokedAt != nil {
		t.Fatalf("expected ses_b live, got %v", rows[0].RevokedAt)
	}
	// An expired session also leaves the list even when not revoked.
	if err := database.CreateSession(ctx, "ses_c", "admin", now.Add(-3*time.Hour), now.Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	rows, err = database.AdminSessions(ctx, "admin")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].ID != "ses_b" {
		t.Fatalf("expected only the live unexpired session, got %+v", rows)
	}
	none, err := database.AdminSessions(ctx, "other")
	if err != nil {
		t.Fatal(err)
	}
	if len(none) != 0 {
		t.Fatalf("expected no rows for other subject, got %d", len(none))
	}
}
