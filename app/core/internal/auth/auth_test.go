package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/manifold-space/manifold/app/core/internal/config"
)

type fakeStore struct {
	hash string
	// missing makes GetAdminCredential report "no such username"; credentialErr
	// makes it report a failing database. They must stay distinguishable.
	missing       bool
	credentialErr error
	sessions      map[string]bool
}

func (f *fakeStore) GetAdminCredential(ctx context.Context, username string) (string, bool, error) {
	if f.credentialErr != nil {
		return "", false, f.credentialErr
	}
	if f.missing {
		return "", false, nil
	}
	return f.hash, true, nil
}
func (f *fakeStore) UpdateAdminCredential(ctx context.Context, username, passwordHash string) error {
	f.hash = passwordHash
	return nil
}
func (f *fakeStore) CreateSession(ctx context.Context, id, subject string, now, expiresAt time.Time) error {
	return nil
}
func (f *fakeStore) SessionLive(ctx context.Context, id string, now time.Time) (bool, error) {
	return f.sessions[id], nil
}
func (f *fakeStore) RevokeSession(ctx context.Context, id string, now time.Time) error {
	delete(f.sessions, id)
	return nil
}
func (f *fakeStore) RevokeSessions(ctx context.Context, subject, exceptCurrentID string, now time.Time) error {
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
	ctx := t.Context()
	service, store := testService(t, testPasswordHash(t), map[string]bool{})
	tokens, err := service.Login(ctx, "admin", "password")
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := service.Parse(tokens)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Issuer != tokenIssuer || len(parsed.Audience) != 1 || parsed.Audience[0] != adminTokenAudience {
		t.Fatalf("admin token domain = issuer %q audience %v", parsed.Issuer, parsed.Audience)
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
	// mintAdminToken deliberately uses the pre-domain-separation root key and
	// omits issuer/audience. Existing 12-hour admin sessions remain valid.
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

func TestLegacyKeyCannotClaimTheAdminTokenDomain(t *testing.T) {
	service, _ := testService(t, testPasswordHash(t), map[string]bool{})
	now := time.Now()
	claims := Claims{
		Role: "admin",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    tokenIssuer,
			Subject:   "admin",
			Audience:  jwt.ClaimStrings{adminTokenAudience},
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
			ID:        "ses_downgrade",
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("test-secret"))
	if err != nil {
		t.Fatal(err)
	}
	if parsed, err := service.Parse(token); !errors.Is(err, ErrUnauthorized) || parsed != nil {
		t.Fatalf("legacy root key must not mint a modern admin token, got claims=%+v err=%v", parsed, err)
	}
}

func TestInvalidPasswordIsRejected(t *testing.T) {
	ctx := t.Context()
	hash, _ := bcrypt.GenerateFromPassword([]byte("password"), bcrypt.MinCost)
	service, _ := testService(t, string(hash), map[string]bool{})
	if _, err := service.Login(ctx, "admin", "wrong"); err != ErrInvalidCredentials {
		t.Fatalf("expected invalid credentials, got %v", err)
	}
}

func TestDefaultCredentialsAcceptDocumentedPassword(t *testing.T) {
	ctx := t.Context()
	// The env-seeded hash now lives in the credential store instead of config.
	service, _ := testService(t, "$2a$10$tT6zviyM5ANs0OHmn18g4eqtgsvaprMNl9n4CTkccoZW9N/aTcd8W", map[string]bool{})
	if _, err := service.Login(ctx, "admin", "password"); err != nil {
		t.Fatalf("documented default credentials should authenticate: %v", err)
	}
}

func TestUpdateCredentialRevokesOtherSessions(t *testing.T) {
	ctx := t.Context()
	hash, _ := bcrypt.GenerateFromPassword([]byte("password"), bcrypt.MinCost)
	service, store := testService(t, string(hash), map[string]bool{"ses_cur": true, "ses_other": true})
	if err := service.UpdateCredential(ctx, "admin", "password", "newsecret9x", "ses_cur"); err != nil {
		t.Fatal(err)
	}
	if !store.sessions["ses_cur"] {
		t.Fatal("expected current session to remain live")
	}
	if store.sessions["ses_other"] {
		t.Fatal("expected other session to be revoked")
	}
	if err := service.UpdateCredential(ctx, "admin", "wrong", "newsecret9x", "ses_cur"); err != ErrInvalidCredentials {
		t.Fatalf("expected invalid current password, got %v", err)
	}
}

// spyComparisons records the hash every password comparison ran against, so the
// unknown-username timing workaround can be asserted instead of timed.
func spyComparisons(t *testing.T) func() [][]byte {
	t.Helper()
	original := comparePassword
	seen := [][]byte{}
	comparePassword = func(hash, password []byte) error {
		seen = append(seen, append([]byte(nil), hash...))
		return original(hash, password)
	}
	t.Cleanup(func() { comparePassword = original })
	return func() [][]byte { return seen }
}

func TestLoginDoesNotReportAStoreFailureAsBadCredentials(t *testing.T) {
	ctx := t.Context()
	service, store := testService(t, testPasswordHash(t), map[string]bool{})
	store.credentialErr = errors.New("database is locked")
	_, err := service.Login(ctx, "admin", "password")
	if err == nil {
		t.Fatal("expected an error")
	}
	if errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("a failing database must not be reported as a wrong password: %v", err)
	}
	if !errors.Is(err, store.credentialErr) {
		t.Fatalf("expected the store error to be wrapped, got %v", err)
	}
}

func TestLoginStillComparesAPasswordForAnUnknownUsername(t *testing.T) {
	ctx := t.Context()
	service, store := testService(t, testPasswordHash(t), map[string]bool{})
	store.missing = true
	seen := spyComparisons(t)
	if _, err := service.Login(ctx, "nobody", "password"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("expected invalid credentials, got %v", err)
	}
	hashes := seen()
	if len(hashes) != 1 {
		t.Fatalf("expected exactly one bcrypt comparison for an unknown username, got %d", len(hashes))
	}
	// It must be the dummy hash: comparing a real credential for a username that
	// has none would be meaningless, and skipping the work entirely is the
	// timing oracle this exists to close.
	if string(hashes[0]) != string(dummyPasswordHash) {
		t.Fatalf("expected the dummy hash, got %q", hashes[0])
	}
}

func TestLoginComparesTheStoredHashForAKnownUsername(t *testing.T) {
	ctx := t.Context()
	hash := testPasswordHash(t)
	service, _ := testService(t, hash, map[string]bool{})
	seen := spyComparisons(t)
	if _, err := service.Login(ctx, "admin", "wrong"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("expected invalid credentials, got %v", err)
	}
	hashes := seen()
	if len(hashes) != 1 || string(hashes[0]) != hash {
		t.Fatalf("expected one comparison against the stored hash, got %q", hashes)
	}
}

func TestUpdateCredentialDoesNotReportAStoreFailureAsABadPassword(t *testing.T) {
	ctx := t.Context()
	service, store := testService(t, testPasswordHash(t), map[string]bool{"ses_cur": true})
	store.credentialErr = errors.New("database is locked")
	err := service.UpdateCredential(ctx, "admin", "password", "newsecret9x", "ses_cur")
	if errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("a failing database must not be reported as a wrong password: %v", err)
	}
	if !errors.Is(err, store.credentialErr) {
		t.Fatalf("expected the store error to be wrapped, got %v", err)
	}
}

func TestNewSessionIDFailsClosedWhenTheCSPRNGIsUnavailable(t *testing.T) {
	ctx := t.Context()
	original := readRandom
	readRandom = func([]byte) (int, error) { return 0, errors.New("entropy unavailable") }
	t.Cleanup(func() { readRandom = original })

	if _, err := newSessionID(); err == nil {
		t.Fatal("expected a failed CSPRNG to error rather than fall back to a timestamp")
	}
	// The failure has to reach the caller: a session that cannot be named
	// unpredictably must not be issued at all.
	service, _ := testService(t, testPasswordHash(t), map[string]bool{})
	if _, err := service.Login(ctx, "admin", "password"); err == nil || errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("expected Login to surface the session-id failure, got %v", err)
	}
}

func TestNewSessionIDIsRandomHex(t *testing.T) {
	id, err := newSessionID()
	if err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`^ses_[0-9a-f]{32}$`).MatchString(id) {
		t.Fatalf("unexpected session id %q", id)
	}
}

// The dummy hash only equalises timing if bcrypt actually performs the work on
// it. A malformed hash fails immediately with ErrHashTooShort or
// InvalidHashPrefixError, which would restore the oracle while leaving the
// "a comparison happened" test above green — so assert the hash is well formed
// and at the same cost the real hashes use.
func TestTheDummyHashIsAWellFormedBcryptHashAtDefaultCost(t *testing.T) {
	cost, err := bcrypt.Cost(dummyPasswordHash)
	if err != nil {
		t.Fatalf("bcrypt rejected the dummy hash, so it costs nothing to compare: %v", err)
	}
	if cost != bcrypt.DefaultCost {
		t.Fatalf("expected the dummy hash at cost %d to match GenerateFromPassword, got %d", bcrypt.DefaultCost, cost)
	}
	if err := bcrypt.CompareHashAndPassword(dummyPasswordHash, []byte("not the preimage")); !errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
		t.Fatalf("expected a real mismatch, got %v", err)
	}
}
