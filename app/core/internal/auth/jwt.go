package auth

import (
	"crypto/hmac"
	"crypto/sha256"

	"github.com/golang-jwt/jwt/v5"
)

const (
	tokenIssuer          = "manifold-core"
	adminTokenAudience   = "manifold-admin"
	visitorTokenAudience = "manifold-visitor"
)

// tokenSigningKey derives a purpose-bound subkey from the deployment secret.
// Admin and visitor tokens therefore cannot cross authentication domains even
// though operators still manage one root secret.
func (s *Service) tokenSigningKey(audience string) []byte {
	mac := hmac.New(sha256.New, []byte(s.config.JWTSecret))
	_, _ = mac.Write([]byte("manifold-jwt/v1/" + audience))
	return mac.Sum(nil)
}

func tokenParserOptions(audience string) []jwt.ParserOption {
	return []jwt.ParserOption{
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(tokenIssuer),
		jwt.WithAudience(audience),
		jwt.WithExpirationRequired(),
	}
}

func legacyTokenClaims(claims jwt.RegisteredClaims) bool {
	return claims.Issuer == "" && len(claims.Audience) == 0
}
