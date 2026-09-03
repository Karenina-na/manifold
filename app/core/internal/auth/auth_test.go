package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/manifold-space/manifold/app/core/internal/config"
)

type fakeStore struct {
	hash     string
	sessions map[string]bool
}

func (f *fakeStore) GetAdminCredential(username string) (string, error) { return f.hash, nil }
func (f *fakeStore) UpdateAdminCredential(username, passwordHash string) error {
	f.hash = passwordHash
	return nil
}
func (f *fakeStore) CreateSession(id, subject string, now, expiresAt time.Time) error { return nil }
func (f *fakeStore) SessionLive(id string, now time.Time) (bool, error)              { return f.sessions[id], nil }
func (f *fakeStore) RevokeSession(id string, now time.Time) error {
	delete(f.sessions, id)
	return nil
}
func (f *fakeStore) RevokeSessions(subject, exceptCurrentID string, now time.Time) error {
	for id := range f.sessions {
		if id != exceptCurrentID {
			delete(f.sessions, id)
		}
	}
	return nil
}

func testConfig() config.Config {
	hash, _ := bcrypt.GenerateFromPassword([]byte("password"), bcrypt.MinCost)
	return config.Config{JWTSecret: "test-secret", AdminUsername: "admin", AdminPasswordHash: string(hash)}
}

func testService(t *testing.T, wantHash string, sessions map[string]bool) (*Service, *fakeStore) {
	t.Helper()
	store := &fakeStore{hash: wantHash, sessions: sessions}
	service, err := New(testConfig(), store)
	if err != nil {
		t.Fatal(err)
	}
	return service, store
}

// testPasswordHash returns a valid bcrypt hash for "password".
func testPasswordHash(t *testing.T) string {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte("password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	return string(hash)
}

func mintAdminToken(t *testing.T, id string) string {
	t.Helper()
	now := time.Now()
	claims := Claims{
		Role: "admin",
		RegisteredClaims: jwt.RegisteredClaims{
			Subject: "admin", IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}
	claims.ID = id
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("test-secret"))
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func TestLoginAndAdminAuthorization(t *testing.T) {
	service, store := testService(t, testPasswordHash(t), map[string]bool{})
	tokens, err := service.Login("admin", "password")
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := service.Parse(tokens)
	if err != nil {
		t.Fatal(err)
	}
	// Simulate the DB-backed liveness: register the created session as live.
	store.sessions[parsed.ID] = true
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/admin/content", nil)
	request.Header.Set("Authorization", "Bearer "+tokens)
	service.RequireAdmin(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("expected authorized request, got %d", recorder.Code)
	}
}

func TestRequireAdminChecksSessionLiveness(t *testing.T) {
	service, _ := testService(t, "$2a$10$abcdefghijklmnopqrstuv", map[string]bool{"ses_fixed": true})
	token := mintAdminToken(t, "ses_fixed")
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/admin/content", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	service.RequireAdmin(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("expected authorized request, got %d", recorder.Code)
	}
}

func TestRequireAdminRejectsRevokedSession(t *testing.T) {
	service, _ := testService(t, "$2a$10$abcdefghijklmnopqrstuv", map[string]bool{"ses_revoked": false})
	token := mintAdminToken(t, "ses_revoked")
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/admin/content", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	service.RequireAdmin(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for revoked session, got %d", recorder.Code)
	}
}

func TestExpiredTokenIsRejected(t *testing.T) {
	service, _ := testService(t, "$2a$10$abcdefghijklmnopqrstuv", map[string]bool{})
	claims := Claims{Role: "admin", RegisteredClaims: jwt.RegisteredClaims{Subject: "admin", ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Minute))}}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("test-secret"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Parse(token); err == nil {
		t.Fatal("expected expired token to be rejected")
	}
}

func TestInvalidPasswordIsRejected(t *testing.T) {
	hash, _ := bcrypt.GenerateFromPassword([]byte("password"), bcrypt.MinCost)
	service, _ := testService(t, string(hash), map[string]bool{})
	if _, err := service.Login("admin", "wrong"); err != ErrInvalidCredentials {
		t.Fatalf("expected invalid credentials, got %v", err)
	}
}

func TestDefaultCredentialsAcceptDocumentedPassword(t *testing.T) {
	// The env-seeded hash now lives in the credential store instead of config.
	service, _ := testService(t, "$2a$10$tT6zviyM5ANs0OHmn18g4eqtgsvaprMNl9n4CTkccoZW9N/aTcd8W", map[string]bool{})
	if _, err := service.Login("admin", "password"); err != nil {
		t.Fatalf("documented default credentials should authenticate: %v", err)
	}
}

func TestUpdateCredentialRevokesOtherSessions(t *testing.T) {
	hash, _ := bcrypt.GenerateFromPassword([]byte("password"), bcrypt.MinCost)
	service, store := testService(t, string(hash), map[string]bool{"ses_cur": true, "ses_other": true})
	if err := service.UpdateCredential("admin", "password", "newsecret9x", "ses_cur"); err != nil {
		t.Fatal(err)
	}
	if !store.sessions["ses_cur"] {
		t.Fatal("expected current session to remain live")
	}
	if store.sessions["ses_other"] {
		t.Fatal("expected other session to be revoked")
	}
	if err := service.UpdateCredential("admin", "wrong", "newsecret9x", "ses_cur"); err != ErrInvalidCredentials {
		t.Fatalf("expected invalid current password, got %v", err)
	}
}
