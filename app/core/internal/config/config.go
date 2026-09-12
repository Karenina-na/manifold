package config

import (
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/caarlos0/env/v11"

	"github.com/manifold-space/manifold/app/core/internal/chain"
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
	// 锚定链配置（docs/chain.md §5）。proofMode 的枚举由 chain.NewLedger 兜底，
	// difficulty 的区间在 proof 模式下由 Validate 强制。
	ChainProofMode       string        `env:"CHAIN_PROOF_MODE" envDefault:"sim"`
	ChainDifficulty      int           `env:"CHAIN_DIFFICULTY" envDefault:"6"`
	ChainSimDelay        time.Duration `env:"CHAIN_SIM_DELAY" envDefault:"1s"`
	ChainBatchSize       int           `env:"CHAIN_BATCH_SIZE" envDefault:"32"`
	ChainMaxBlockAnchors int           `env:"CHAIN_MAX_BLOCK_ANCHORS" envDefault:"500"`
	ChainFlushTimeout    time.Duration `env:"CHAIN_FLUSH_TIMEOUT" envDefault:"30s"`
	ChainAnchorMaxBytes  int64         `env:"CHAIN_ANCHOR_MAX_BYTES" envDefault:"65536"`
	// 验证接口每请求都会全链重放（docs/chain.md §10），比写入更昂贵，
	// 因此单独按更低的配额限流，避免被打满 CPU 与 DB。
	ChainVerifyRatePerMin int `env:"CHAIN_VERIFY_RATE_PER_MIN" envDefault:"20"`
	// GitHub OAuth for comment identities. Empty values disable the provider
	// (auth/me reports providers: [] and the web gate hides the button).
	GitHubClientID     string `env:"GITHUB_CLIENT_ID" envDefault:""`
	GitHubClientSecret string `env:"GITHUB_CLIENT_SECRET" envDefault:""`
	// GitHubRedirectURI is the full callback URL of the consuming web app, e.g.
	// http://localhost:3000/api/v1/auth/callback/github. It must match the
	// Redirect URI registered in the GitHub OAuth App.
	GitHubRedirectURI string `env:"GITHUB_REDIRECT_URI" envDefault:""`
}

const devJWTSecret = "manifold-dev-secret-change-me"

// Validate enforces the configuration contract. The chain difficulty bound is
// checked in every environment rather than only in production: an out-of-range
// value is a resource fault (an effectively unbounded hash search inside the
// miner goroutine), not a deployment-secret mistake, and it must fail at
// startup even on a developer machine. The secret checks stay
// production-only, where the dev defaults are a convenience for local runs and
// never a deployment.
func (c Config) Validate() error {
	var problems []string
	if c.ChainProofMode == string(chain.ProofModeProof) && (c.ChainDifficulty < chain.MinProofDifficulty || c.ChainDifficulty > chain.MaxProofDifficulty) {
		problems = append(problems, fmt.Sprintf("CORE_CHAIN_DIFFICULTY must be between %d and %d in proof mode, got %d", chain.MinProofDifficulty, chain.MaxProofDifficulty, c.ChainDifficulty))
	}
	if c.Env == "production" {
		problems = append(problems, c.productionProblems()...)
	}
	if len(problems) > 0 {
		return fmt.Errorf("configuration refused: %s", strings.Join(problems, "; "))
	}
	return nil
}

// productionProblems lists the deployment contract violations: dev defaults for
// secrets are never acceptable outside a local run.
func (c Config) productionProblems() []string {
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
	return problems
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
