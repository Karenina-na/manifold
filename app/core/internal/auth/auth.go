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
type SessionStore interface {
	GetAdminCredential(username string) (string, error)
	UpdateAdminCredential(username, passwordHash string) error
	CreateSession(id, subject string, now, expiresAt time.Time) error
	SessionLive(id string, now time.Time) (bool, error)
	RevokeSession(id string, now time.Time) error
	RevokeSessions(subject string, exceptCurrentID string, now time.Time) error
}

func newSessionID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("ses_%d", time.Now().UnixNano())
	}
	return fmt.Sprintf("ses_%x", b)
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
	hash, err := s.store.GetAdminCredential(username)
	if err != nil {
		return "", ErrInvalidCredentials
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return "", ErrInvalidCredentials
	}
	now := s.now()
	sessionID := newSessionID()
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
	hash, err := s.store.GetAdminCredential(username)
	if err != nil {
		return ErrInvalidCredentials
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(currentPassword)) != nil {
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
