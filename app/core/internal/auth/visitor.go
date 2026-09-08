package auth

import (
	"errors"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Visitor identity sessions power the public comment identity (GitHub sign-in).
// Unlike admin sessions they carry no role and are never checked against the
// Casbin enforcer; they only assert "this visitor authenticated with a
// provider". The token is consumed by the web app as a non-HttpOnly cookie so
// the browser SDK can forward it as a Bearer credential to Core directly.
const VisitorTTL = 90 * 24 * time.Hour

var ErrInvalidVisitorToken = errors.New("invalid visitor token")

type VisitorClaims struct {
	Provider    string `json:"provider"`
	DisplayName string `json:"displayName"`
	AvatarURL   string `json:"avatarUrl,omitempty"`
	jwt.RegisteredClaims
}

// SignVisitor mints the visitor session for an identity. Subject is the
// identity id so /auth/me can re-read the row.
func (s *Service) SignVisitor(identityID, provider, displayName, avatarURL string, now time.Time) (string, error) {
	claims := VisitorClaims{
		Provider:    provider,
		DisplayName: displayName,
		AvatarURL:   avatarURL,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   identityID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(VisitorTTL)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(s.config.JWTSecret))
}

// ParseVisitor validates a Bearer visitor token. A token that is structurally
// valid but missing a subject is rejected: every visitor session names an
// identity row.
func (s *Service) ParseVisitor(tokenValue string) (*VisitorClaims, error) {
	value := strings.TrimSpace(strings.TrimPrefix(tokenValue, "Bearer "))
	if value == "" {
		return nil, ErrInvalidVisitorToken
	}
	claims := &VisitorClaims{}
	token, err := jwt.ParseWithClaims(value, claims, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, ErrInvalidVisitorToken
		}
		return []byte(s.config.JWTSecret), nil
	})
	if err != nil || !token.Valid || claims.Subject == "" {
		return nil, ErrInvalidVisitorToken
	}
	return claims, nil
}

// VisitorFromRequest extracts an optional visitor session from the request's
// Authorization header. A missing header yields nil, nil — comment creation
// falls back to the anonymous identity path.
func VisitorFromRequest(s *Service, header string) (*VisitorClaims, error) {
	value := strings.TrimSpace(header)
	if value == "" {
		return nil, nil
	}
	claims, err := s.ParseVisitor(value)
	if err != nil {
		return nil, err
	}
	return claims, nil
}
