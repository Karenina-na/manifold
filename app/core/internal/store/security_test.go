package store

import (
	"testing"
	"time"
)

func TestEnsureAdminCredentialSeedsOnce(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	hash := "$2a$10$abcdefghijklmnopqrstuv"
	if err := database.ensureAdminCredential("admin", hash); err != nil {
		t.Fatal(err)
	}
	got, err := database.GetAdminCredential("admin")
	if err != nil {
		t.Fatal(err)
	}
	if got != hash {
		t.Fatalf("expected hash %q, got %q", hash, got)
	}
	// Seeding a second value must not overwrite the first row.
	if err := database.ensureAdminCredential("admin", "different"); err != nil {
		t.Fatal(err)
	}
	got, err = database.GetAdminCredential("admin")
	if err != nil {
		t.Fatal(err)
	}
	if got != hash {
		t.Fatalf("expected original hash preserved, got %q", got)
	}
}

func TestSessionLifecycle(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	now := time.Now().UTC()
	expires := now.Add(time.Hour)
	if err := database.CreateSession("ses_1", "admin", now, expires); err != nil {
		t.Fatal(err)
	}
	live, err := database.SessionLive("ses_1", now.Add(30*time.Minute))
	if err != nil || !live {
		t.Fatalf("expected live session, got %v %v", live, err)
	}
	if err := database.RevokeSession("ses_1", now); err != nil {
		t.Fatal(err)
	}
	live, err = database.SessionLive("ses_1", now.Add(30*time.Minute))
	if err != nil || live {
		t.Fatalf("expected revoked session to be dead, got %v %v", live, err)
	}
	// Missing session is not live.
	live, err = database.SessionLive("ses_missing", now)
	if err != nil || live {
		t.Fatalf("expected missing session dead, got %v %v", live, err)
	}
	// An expired session is not live.
	if err := database.CreateSession("ses_exp", "admin", now, now.Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	live, err = database.SessionLive("ses_exp", now)
	if err != nil || live {
		t.Fatalf("expected expired session dead, got %v %v", live, err)
	}
}

func TestRevokeSessionsExceptCurrent(t *testing.T) {
	database, err := Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	now := time.Now().UTC()
	for _, id := range []string{"ses_a", "ses_b", "ses_c"} {
		if err := database.CreateSession(id, "admin", now, now.Add(time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
	if err := database.RevokeSessions("admin", "ses_b", now); err != nil {
		t.Fatal(err)
	}
	for id, want := range map[string]bool{"ses_a": false, "ses_b": true, "ses_c": false} {
		live, err := database.SessionLive(id, now.Add(time.Minute))
		if err != nil {
			t.Fatal(err)
		}
		if live != want {
			t.Fatalf("session %s live=%v, want %v", id, live, want)
		}
	}
}
