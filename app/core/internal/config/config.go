package config

import (
	"time"

	"github.com/caarlos0/env/v11"
)

type Config struct {
	Addr              string        `env:"ADDR" envDefault:":8080"`
	DatabasePath      string        `env:"DATABASE_PATH" envDefault:"./data/manifold.db"`
	AllowedOrigins    []string      `env:"ALLOWED_ORIGINS" envDefault:"http://localhost:3000,http://localhost:5173" envSeparator:","`
	JWTSecret         string        `env:"JWT_SECRET" envDefault:"manifold-dev-secret-change-me"`
	AdminUsername     string        `env:"ADMIN_USERNAME" envDefault:"admin"`
	AdminPasswordHash string        `env:"ADMIN_PASSWORD_HASH" envDefault:"$2y$10$c1RwBHkB5sMnrXuxlNO5xudapo9RFfI4swx.EiH5k7HkJp9RDUG9O"`
	ContentCacheTTL   time.Duration `env:"CONTENT_CACHE_TTL" envDefault:"30s"`
	StatsCacheTTL     time.Duration `env:"STATS_CACHE_TTL" envDefault:"30s"`
}

func Load() (Config, error) {
	var cfg Config
	err := env.ParseWithOptions(&cfg, env.Options{Prefix: "CORE_"})
	return cfg, err
}
