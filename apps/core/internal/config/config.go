package config

import "github.com/caarlos0/env/v11"

type Config struct {
	Addr           string   `env:"ADDR" envDefault:":8080"`
	DatabasePath   string   `env:"DATABASE_PATH" envDefault:"./data/manifold.db"`
	AllowedOrigins []string `env:"ALLOWED_ORIGINS" envDefault:"http://localhost:3000,http://localhost:5173" envSeparator:","`
}

func Load() (Config, error) {
	var cfg Config
	err := env.ParseWithOptions(&cfg, env.Options{Prefix: "CORE_"})
	return cfg, err
}

