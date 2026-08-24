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

func testConfig() config.Config {
	hash, _ := bcrypt.GenerateFromPassword([]byte("password"), bcrypt.MinCost)
	return config.Config{JWTSecret: "test-secret", AdminUsername: "admin", AdminPasswordHash: string(hash)}
}

func TestLoginAndAdminAuthorization(t *testing.T) {
	service, err := New(testConfig())
	if err != nil {
		t.Fatal(err)
	}
	token, err := service.Login("admin", "password")
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/admin/content", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	service.RequireAdmin(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("expected authorized request, got %d", recorder.Code)
	}
}

func TestExpiredTokenIsRejected(t *testing.T) {
	cfg := testConfig()
	service, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	claims := Claims{Role: "admin", RegisteredClaims: jwt.RegisteredClaims{Subject: "admin", ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Minute))}}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(cfg.JWTSecret))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Parse(token); err == nil {
		t.Fatal("expected expired token to be rejected")
	}
}

func TestInvalidPasswordIsRejected(t *testing.T) {
	service, err := New(testConfig())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Login("admin", "wrong"); err != ErrInvalidCredentials {
		t.Fatalf("expected invalid credentials, got %v", err)
	}
}

func TestDefaultCredentialsAcceptDocumentedPassword(t *testing.T) {
	cfg := config.Config{
		JWTSecret:         "test-secret",
		AdminUsername:     "admin",
		AdminPasswordHash: "$2a$10$tT6zviyM5ANs0OHmn18g4eqtgsvaprMNl9n4CTkccoZW9N/aTcd8W",
	}
	service, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Login("admin", "password"); err != nil {
		t.Fatalf("documented default credentials should authenticate: %v", err)
	}
}
