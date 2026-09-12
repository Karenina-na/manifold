package auth

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/casbin/casbin/v2"
	casbinmodel "github.com/casbin/casbin/v2/model"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/manifold-space/manifold/app/core/internal/apierror"
	"github.com/manifold-space/manifold/app/core/internal/config"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrUnauthorized       = errors.New("unauthorized")
	ErrForbidden          = errors.New("forbidden")
)

// SessionTTL is the single source of truth for token lifetime; the login
// response reports it instead of restating a literal.
const SessionTTL = 12 * time.Hour

// SessionTTLSeconds mirrors SessionTTL for the wire response.
const SessionTTLSeconds = int(12 * time.Hour / time.Second)

type Claims struct {
	Role string `json:"role"`
	jwt.RegisteredClaims
}

type Service struct {
	config   config.Config
	enforcer *casbin.Enforcer
	store    SessionStore
	now      func() time.Time
}

// SessionStore is the persistence surface auth needs. *store.Store satisfies it.
// GetAdminCredential reports "no such credential" as a flag rather than an error
// so a missing username stays distinguishable from a failing database without
// the two packages having to share a sentinel value.
type SessionStore interface {
	GetAdminCredential(username string) (hash string, found bool, err error)
	UpdateAdminCredential(username, passwordHash string) error
	CreateSession(id, subject string, now, expiresAt time.Time) error
	SessionLive(id string, now time.Time) (bool, error)
	RevokeSession(id string, now time.Time) error
	RevokeSessions(subject string, exceptCurrentID string, now time.Time) error
}

// Seams for the two operations whose failure modes are security-relevant and
// otherwise unreachable from a test: a broken CSPRNG and the bcrypt comparison.
// Production never reassigns them.
var (
	readRandom      = rand.Read
	comparePassword = bcrypt.CompareHashAndPassword
)

// A valid bcrypt hash whose pre-image is a random string generated for this
// purpose and never stored anywhere. It exists only so that an unknown username
// costs the same as a known one; see Login.
var dummyPasswordHash = []byte("$2a$10$dmmb3CjY/IzLR8l7Pgvt8.urDgxsmuPt40QYkES.WDFQ.oIQ.Z5kq")

// newSessionID returns a fresh session id. It fails closed: the id is the JWT
// `jti` and the key of the admin_sessions row, so a predictable fallback would
// be a guessable session handle. The previous version silently substituted a
// nanosecond timestamp when the CSPRNG failed.
func newSessionID() (string, error) {
	var b [16]byte
	if _, err := readRandom(b[:]); err != nil {
		return "", fmt.Errorf("generate session id: %w", err)
	}
	return fmt.Sprintf("ses_%x", b), nil
}

func New(cfg config.Config, db SessionStore) (*Service, error) {
	model, err := casbinmodel.NewModelFromString(`[request_definition]
r = sub, obj, act

[policy_definition]
p = sub, obj, act

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = r.sub == p.sub && keyMatch(r.obj, p.obj) && (p.act == "*" || r.act == p.act)`)
	if err != nil {
		return nil, err
	}
	enforcer, err := casbin.NewEnforcer(model)
	if err != nil {
		return nil, err
	}
	if _, err := enforcer.AddPolicy("admin", "/api/v1/admin/*", "*"); err != nil {
		return nil, err
	}
	return &Service{config: cfg, enforcer: enforcer, store: db, now: time.Now}, nil
}

func (s *Service) Login(username, password string) (string, error) {
	hash, found, err := s.store.GetAdminCredential(username)
	if err != nil {
		// A store failure is not a wrong password: collapsing it into
		// ErrInvalidCredentials told the operator "your password is wrong"
		// while the database was actually unreachable.
		return "", fmt.Errorf("read admin credential: %w", err)
	}
	if !found {
		// Unknown username. Comparing against a dummy hash keeps the work — and
		// therefore the response time — the same as the wrong-password path;
		// returning here directly was a timing oracle that revealed which
		// usernames exist. The result is discarded either way.
		_ = comparePassword(dummyPasswordHash, []byte(password))
		return "", ErrInvalidCredentials
	}
	if comparePassword([]byte(hash), []byte(password)) != nil {
		return "", ErrInvalidCredentials
	}
	now := s.now()
	sessionID, err := newSessionID()
	if err != nil {
		return "", err
	}
	claims := Claims{
		Role: "admin",
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   username,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(SessionTTL)),
		},
	}
	claims.ID = sessionID
	if err := s.store.CreateSession(sessionID, username, now, now.Add(SessionTTL)); err != nil {
		return "", err
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(s.config.JWTSecret))
}

func (s *Service) Parse(tokenValue string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenValue, claims, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, ErrUnauthorized
		}
		return []byte(s.config.JWTSecret), nil
	})
	if err != nil || !token.Valid {
		return nil, ErrUnauthorized
	}
	return claims, nil
}

func (s *Service) RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		value := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		claims, err := s.Parse(value)
		if err != nil {
			writeAuthError(w, http.StatusUnauthorized, apierror.Unauthorized, "A valid JWT is required.")
			return
		}
		if claims.ID == "" {
			writeAuthError(w, http.StatusUnauthorized, apierror.Unauthorized, "A valid session is required.")
			return
		}
		live, err := s.store.SessionLive(claims.ID, s.now())
		if err != nil {
			writeAuthError(w, http.StatusInternalServerError, apierror.SessionUnavailable, "Session state is unavailable.")
			return
		}
		if !live {
			writeAuthError(w, http.StatusUnauthorized, apierror.Unauthorized, "Session is no longer active.")
			return
		}
		allowed, err := s.enforcer.Enforce(claims.Role, r.URL.Path, r.Method)
		if err != nil || !allowed {
			writeAuthError(w, http.StatusForbidden, apierror.Forbidden, "The role cannot access this resource.")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), claimsKey{}, claims)))
	})
}

// UpdateCredential verifies the current password, replaces the stored hash, and
// revokes every other active session for the subject.
func (s *Service) UpdateCredential(username, currentPassword, newPassword string, currentSessionID string) error {
	hash, found, err := s.store.GetAdminCredential(username)
	if err != nil {
		// Same split as Login: an unreachable database must not be reported as a
		// wrong current password.
		return fmt.Errorf("read admin credential: %w", err)
	}
	if !found {
		return ErrInvalidCredentials
	}
	if comparePassword([]byte(hash), []byte(currentPassword)) != nil {
		return ErrInvalidCredentials
	}
	nextHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	if err := s.store.UpdateAdminCredential(username, string(nextHash)); err != nil {
		return err
	}
	return s.store.RevokeSessions(username, currentSessionID, s.now())
}

type claimsKey struct{}

func ClaimsFromContext(ctx context.Context) *Claims {
	claims, _ := ctx.Value(claimsKey{}).(*Claims)
	return claims
}

func writeAuthError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	errorBody := map[string]any{"code": code, "message": message}
	if requestID := w.Header().Get("X-Request-ID"); requestID != "" {
		errorBody["requestId"] = requestID
	}
	if traceID := w.Header().Get("X-Trace-ID"); traceID != "" {
		errorBody["traceId"] = traceID
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"error": errorBody})
}
