package auth

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Visitor sessions (GitHub sign-in for public comments) use a purpose-derived
// signing key and their own audience. These cases pin the mint/parse round trip
// and the ways a token must be refused.
func TestVisitorTokenRoundTrip(t *testing.T) {
	service, _ := testService(t, testPasswordHash(t), map[string]bool{})
	now := time.Now()
	token, err := service.SignVisitor("ident_1", "github", "Ada", "https://example.test/ada.png", now)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := service.ParseVisitor(token)
	if err != nil {
		t.Fatal(err)
	}
	if claims.Subject != "ident_1" {
		t.Fatalf("subject = %q, want ident_1", claims.Subject)
	}
	if claims.Provider != "github" || claims.DisplayName != "Ada" || claims.AvatarURL != "https://example.test/ada.png" {
		t.Fatalf("identity fields did not round trip: %+v", claims)
	}
	if claims.Issuer != tokenIssuer || len(claims.Audience) != 1 || claims.Audience[0] != visitorTokenAudience {
		t.Fatalf("visitor token domain = issuer %q audience %v", claims.Issuer, claims.Audience)
	}
	if claims.ExpiresAt == nil || !claims.ExpiresAt.Time.After(now.Add(VisitorTTL-time.Minute)) {
		t.Fatalf("expected a %s lifetime, got %+v", VisitorTTL, claims.ExpiresAt)
	}
	// A visitor session asserts an identity and nothing else. If it ever gained
	// a jti it would become indistinguishable from an admin session handle,
	// which is the confusion RequireAdmin relies on not happening.
	if claims.ID != "" {
		t.Fatalf("a visitor token must not carry a jti, got %q", claims.ID)
	}
}

// The Bearer prefix is optional because VisitorFromRequest passes the raw header
// through, and the SDK may or may not include it.
func TestParseVisitorAcceptsAnOptionalBearerPrefix(t *testing.T) {
	service, _ := testService(t, testPasswordHash(t), map[string]bool{})
	token, err := service.SignVisitor("ident_1", "github", "Ada", "", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.ParseVisitor("Bearer " + token); err != nil {
		t.Fatalf("a Bearer-prefixed token must parse: %v", err)
	}
}

func TestParseVisitorRejectsBadTokens(t *testing.T) {
	service, _ := testService(t, testPasswordHash(t), map[string]bool{})
	valid, err := service.SignVisitor("ident_1", "github", "Ada", "", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	expired := mintVisitorToken(t, "test-secret", jwt.RegisteredClaims{
		Subject:   "ident_1",
		IssuedAt:  jwt.NewNumericDate(time.Now().Add(-2 * VisitorTTL)),
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Minute)),
	})
	subjectless := mintVisitorToken(t, "test-secret", jwt.RegisteredClaims{
		IssuedAt:  jwt.NewNumericDate(time.Now()),
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
	})
	foreign := mintVisitorToken(t, "another-secret", jwt.RegisteredClaims{
		Subject:   "ident_1",
		IssuedAt:  jwt.NewNumericDate(time.Now()),
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
	})
	none := mintVisitorTokenWithMethod(t, jwt.SigningMethodNone, jwt.UnsafeAllowNoneSignatureType, jwt.RegisteredClaims{
		Subject:   "ident_1",
		IssuedAt:  jwt.NewNumericDate(time.Now()),
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
	})
	// Another HMAC variant signed with the same secret. This is the case the
	// explicit `token.Method != jwt.SigningMethodHS256` guard exists for: the
	// library verifies any HMAC method with the key it is handed, so without the
	// pin an HS512 token would be accepted. The alg:none case below is refused
	// by the library itself, not by that guard.
	otherHMAC := mintVisitorTokenWithMethod(t, jwt.SigningMethodHS512, []byte("test-secret"), jwt.RegisteredClaims{
		Subject:   "ident_1",
		IssuedAt:  jwt.NewNumericDate(time.Now()),
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
	})
	cases := []struct {
		name  string
		token string
	}{
		{"empty", ""},
		{"not a jwt", "not-a-token"},
		{"expired", expired},
		{"no subject", subjectless},
		{"signed with another key", foreign},
		{"signed with another hmac algorithm", otherHMAC},
		{"alg none", none},
		{"tampered payload", tamperPayload(valid)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			claims, err := service.ParseVisitor(tc.token)
			if !errors.Is(err, ErrInvalidVisitorToken) {
				t.Fatalf("expected ErrInvalidVisitorToken, got claims=%+v err=%v", claims, err)
			}
			if claims != nil {
				t.Fatal("a rejected token must not return claims")
			}
		})
	}
}

// A missing Authorization header means "anonymous commenter", which is not an
// error; anything else is. Comment creation depends on this split.
func TestVisitorFromRequestDistinguishesAbsentFromInvalid(t *testing.T) {
	service, _ := testService(t, testPasswordHash(t), map[string]bool{})
	claims, err := VisitorFromRequest(service, "   ")
	if err != nil || claims != nil {
		t.Fatalf("an absent header must yield (nil, nil), got claims=%+v err=%v", claims, err)
	}
	if _, err := VisitorFromRequest(service, "Bearer nonsense"); !errors.Is(err, ErrInvalidVisitorToken) {
		t.Fatalf("a malformed header must be an error, got %v", err)
	}
}

func TestLegacyVisitorTokenRemainsValidUntilItsExistingExpiry(t *testing.T) {
	service, _ := testService(t, testPasswordHash(t), map[string]bool{})
	now := time.Now()
	token := mintVisitorToken(t, "test-secret", jwt.RegisteredClaims{
		Subject:   "ident_legacy",
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
	})
	claims, err := service.ParseVisitor(token)
	if err != nil {
		t.Fatalf("legacy visitor cookie must remain valid: %v", err)
	}
	if claims.Subject != "ident_legacy" {
		t.Fatalf("legacy subject = %q", claims.Subject)
	}
}

func TestAdminAndVisitorTokenDomainsAreNotInterchangeable(t *testing.T) {
	ctx := t.Context()
	service, _ := testService(t, testPasswordHash(t), map[string]bool{})
	adminToken, err := service.Login(ctx, "admin", "password")
	if err != nil {
		t.Fatal(err)
	}
	visitorToken, err := service.SignVisitor("ident_1", "github", "Ada", "", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if claims, err := service.ParseVisitor(adminToken); !errors.Is(err, ErrInvalidVisitorToken) || claims != nil {
		t.Fatalf("visitor parser accepted an admin token: claims=%+v err=%v", claims, err)
	}
	if claims, err := service.Parse(visitorToken); !errors.Is(err, ErrUnauthorized) || claims != nil {
		t.Fatalf("admin parser accepted a visitor token: claims=%+v err=%v", claims, err)
	}

	legacyAdmin := mintAdminToken(t, "ses_legacy_admin")
	if claims, err := service.ParseVisitor(legacyAdmin); !errors.Is(err, ErrInvalidVisitorToken) || claims != nil {
		t.Fatalf("visitor parser accepted a legacy admin token: claims=%+v err=%v", claims, err)
	}
	legacyVisitor := mintVisitorToken(t, "test-secret", jwt.RegisteredClaims{
		Subject:   "ident_legacy",
		IssuedAt:  jwt.NewNumericDate(time.Now()),
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
	})
	if claims, err := service.Parse(legacyVisitor); !errors.Is(err, ErrUnauthorized) || claims != nil {
		t.Fatalf("admin parser accepted a legacy visitor token: claims=%+v err=%v", claims, err)
	}
}

func TestLegacyKeyCannotClaimTheVisitorTokenDomain(t *testing.T) {
	service, _ := testService(t, testPasswordHash(t), map[string]bool{})
	now := time.Now()
	token := mintVisitorToken(t, "test-secret", jwt.RegisteredClaims{
		Issuer:    tokenIssuer,
		Subject:   "ident_1",
		Audience:  jwt.ClaimStrings{visitorTokenAudience},
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
	})
	if claims, err := service.ParseVisitor(token); !errors.Is(err, ErrInvalidVisitorToken) || claims != nil {
		t.Fatalf("legacy root key must not mint a modern visitor token, got claims=%+v err=%v", claims, err)
	}
}

func TestTokenParsersRequireIssuerAndAudience(t *testing.T) {
	service, _ := testService(t, testPasswordHash(t), map[string]bool{})
	now := time.Now()
	wrongAdminAudience := Claims{
		Role: "admin",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    tokenIssuer,
			Subject:   "admin",
			Audience:  jwt.ClaimStrings{visitorTokenAudience},
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
			ID:        "ses_wrong_audience",
		},
	}
	adminToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, wrongAdminAudience).SignedString(service.tokenSigningKey(adminTokenAudience))
	if err != nil {
		t.Fatal(err)
	}
	if claims, err := service.Parse(adminToken); !errors.Is(err, ErrUnauthorized) || claims != nil {
		t.Fatalf("admin parser accepted the visitor audience: claims=%+v err=%v", claims, err)
	}

	wrongVisitorIssuer := VisitorClaims{
		Provider: "github", DisplayName: "Ada",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "another-issuer",
			Subject:   "ident_1",
			Audience:  jwt.ClaimStrings{visitorTokenAudience},
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}
	visitorToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, wrongVisitorIssuer).SignedString(service.tokenSigningKey(visitorTokenAudience))
	if err != nil {
		t.Fatal(err)
	}
	if claims, err := service.ParseVisitor(visitorToken); !errors.Is(err, ErrInvalidVisitorToken) || claims != nil {
		t.Fatalf("visitor parser accepted another issuer: claims=%+v err=%v", claims, err)
	}
}

func TestPurposeDerivedSigningKeysAreNotInterchangeable(t *testing.T) {
	service, _ := testService(t, testPasswordHash(t), map[string]bool{})
	now := time.Now()
	adminClaims := Claims{
		Role: "admin",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    tokenIssuer,
			Subject:   "admin",
			Audience:  jwt.ClaimStrings{adminTokenAudience},
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
			ID:        "ses_wrong_key",
		},
	}
	adminToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, adminClaims).SignedString(service.tokenSigningKey(visitorTokenAudience))
	if err != nil {
		t.Fatal(err)
	}
	if claims, err := service.Parse(adminToken); !errors.Is(err, ErrUnauthorized) || claims != nil {
		t.Fatalf("visitor subkey signed an admin token: claims=%+v err=%v", claims, err)
	}

	visitorClaims := VisitorClaims{
		Provider: "github", DisplayName: "Ada",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    tokenIssuer,
			Subject:   "ident_1",
			Audience:  jwt.ClaimStrings{visitorTokenAudience},
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}
	visitorToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, visitorClaims).SignedString(service.tokenSigningKey(adminTokenAudience))
	if err != nil {
		t.Fatal(err)
	}
	if claims, err := service.ParseVisitor(visitorToken); !errors.Is(err, ErrInvalidVisitorToken) || claims != nil {
		t.Fatalf("admin subkey signed a visitor token: claims=%+v err=%v", claims, err)
	}
}

// Purpose-derived keys plus issuer/audience checks are the primary separation.
// RequireAdmin still keeps its session-liveness gate as defense in depth.
func TestVisitorTokenCannotAuthorizeAnAdminRequest(t *testing.T) {
	service, store := testService(t, testPasswordHash(t), map[string]bool{})
	token, err := service.SignVisitor("ident_1", "github", "Ada", "", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	store.sessions["ident_1"] = true
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/admin/site", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	reached := false
	service.RequireAdmin(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached = true })).ServeHTTP(recorder, request)
	if reached {
		t.Fatal("a visitor session must not reach an admin handler")
	}
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "valid JWT") {
		t.Fatalf("expected the token-domain rejection, got %s", recorder.Body.String())
	}
}

func mintVisitorToken(t *testing.T, secret string, registered jwt.RegisteredClaims) string {
	t.Helper()
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, VisitorClaims{
		Provider: "github", DisplayName: "Ada", RegisteredClaims: registered,
	}).SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func mintVisitorTokenWithMethod(t *testing.T, method jwt.SigningMethod, key any, registered jwt.RegisteredClaims) string {
	t.Helper()
	token, err := jwt.NewWithClaims(method, VisitorClaims{
		Provider: "github", DisplayName: "Ada", RegisteredClaims: registered,
	}).SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return token
}

// tamperPayload flips the last character of the payload segment so the
// signature no longer matches. It must not accidentally produce a valid token,
// which is why the first character is checked rather than blindly replaced.
func tamperPayload(token string) string {
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[1] == "" {
		return token
	}
	replacement := "A"
	if parts[1][0] == 'A' {
		replacement = "B"
	}
	return parts[0] + "." + replacement + parts[1][1:] + "." + parts[2]
}
