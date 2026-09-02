package config

import (
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/caarlos0/env/v11"
)

type Config struct {
	Env               string        `env:"ENV" envDefault:"development"`
	Addr              string        `env:"ADDR" envDefault:":8080"`
	DatabasePath      string        `env:"DATABASE_PATH" envDefault:"./data/manifold.db"`
	AllowedOrigins    []string      `env:"ALLOWED_ORIGINS" envDefault:"http://localhost:3000,http://localhost:5173" envSeparator:","`
	JWTSecret         string        `env:"JWT_SECRET" envDefault:"manifold-dev-secret-change-me"`
	AdminUsername     string        `env:"ADMIN_USERNAME" envDefault:"admin"`
	AdminPasswordHash string        `env:"ADMIN_PASSWORD_HASH" envDefault:"$2a$10$tT6zviyM5ANs0OHmn18g4eqtgsvaprMNl9n4CTkccoZW9N/aTcd8W"`
	ContentCacheTTL   time.Duration `env:"CONTENT_CACHE_TTL" envDefault:"30s"`
	StatsCacheTTL     time.Duration `env:"STATS_CACHE_TTL" envDefault:"30s"`
	AuditEventBuffer  int           `env:"AUDIT_EVENT_BUFFER" envDefault:"256"`
	MediaMaxBytes     int64         `env:"MEDIA_MAX_BYTES" envDefault:"5242880"`
	PublicURL         string        `env:"PUBLIC_URL" envDefault:""`
	RateLimitPerMin   int           `env:"RATE_LIMIT_PER_MIN" envDefault:"60"`
	LoginRatePerMin   int           `env:"LOGIN_RATE_LIMIT_PER_MIN" envDefault:"5"`
	TrustedProxyCIDRs []string      `env:"TRUSTED_PROXY_CIDRS" envDefault:"" envSeparator:","`
	SeedFile          string        `env:"SEED_FILE" envDefault:""`
}

const devJWTSecret = "manifold-dev-secret-change-me"

// Validate enforces the production contract: dev defaults for secrets are a
// convenience for local runs only, never for a deployment.
func (c Config) Validate() error {
	if c.Env != "production" {
		return nil
	}
	var problems []string
	if c.JWTSecret == "" || c.JWTSecret == devJWTSecret || len(c.JWTSecret) < 16 {
		problems = append(problems, "CORE_JWT_SECRET must be set to a non-default secret of at least 16 characters")
	}
	if c.AdminPasswordHash == "" || c.AdminPasswordHash == "$2a$10$tT6zviyM5ANs0OHmn18g4eqtgsvaprMNl9n4CTkccoZW9N/aTcd8W" {
		problems = append(problems, "CORE_ADMIN_PASSWORD_HASH must be set to a bcrypt hash that is not the dev default (plaintext \"password\")")
	}
	for _, value := range c.TrustedProxyCIDRs {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, _, err := net.ParseCIDR(trimmed); err != nil {
			problems = append(problems, fmt.Sprintf("CORE_TRUSTED_PROXY_CIDRS contains invalid CIDR %q", value))
		}
	}
	if len(problems) > 0 {
		return fmt.Errorf("production configuration refused: %s", strings.Join(problems, "; "))
	}
	return nil
}

func (c Config) IsProduction() bool { return c.Env == "production" }

func Load() (Config, error) {
	if err := loadDotEnv(); err != nil {
		return Config{}, err
	}
	var cfg Config
	if err := env.ParseWithOptions(&cfg, env.Options{Prefix: "CORE_"}); err != nil {
		return cfg, err
	}
	if err := cfg.Validate(); err != nil {
		return cfg, err
	}
	return cfg, nil
}
