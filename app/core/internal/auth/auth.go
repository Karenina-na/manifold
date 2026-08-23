package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/casbin/casbin/v2"
	casbinmodel "github.com/casbin/casbin/v2/model"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/manifold-space/manifold/app/core/internal/config"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrUnauthorized       = errors.New("unauthorized")
	ErrForbidden          = errors.New("forbidden")
)

type Claims struct {
	Role string `json:"role"`
	jwt.RegisteredClaims
}

type Service struct {
	config   config.Config
	enforcer *casbin.Enforcer
	now      func() time.Time
}

func New(cfg config.Config) (*Service, error) {
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
	return &Service{config: cfg, enforcer: enforcer, now: time.Now}, nil
}

func (s *Service) Login(username, password string) (string, error) {
	if username != s.config.AdminUsername || bcrypt.CompareHashAndPassword([]byte(s.config.AdminPasswordHash), []byte(password)) != nil {
		return "", ErrInvalidCredentials
	}
	now := s.now()
	claims := Claims{
		Role: "admin",
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   username,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(12 * time.Hour)),
		},
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
			writeAuthError(w, http.StatusUnauthorized, "UNAUTHORIZED", "A valid JWT is required.")
			return
		}
		allowed, err := s.enforcer.Enforce(claims.Role, r.URL.Path, r.Method)
		if err != nil || !allowed {
			writeAuthError(w, http.StatusForbidden, "FORBIDDEN", "The role cannot access this resource.")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), claimsKey{}, claims)))
	})
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
