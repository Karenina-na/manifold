package handler

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-playground/validator/v10"

	"github.com/manifold-space/manifold/app/core/internal/agent"
	agentscenarios "github.com/manifold-space/manifold/app/core/internal/agent/scenarios"
	"github.com/manifold-space/manifold/app/core/internal/application"
	"github.com/manifold-space/manifold/app/core/internal/auth"
	"github.com/manifold-space/manifold/app/core/internal/cache"
	"github.com/manifold-space/manifold/app/core/internal/chain"
	"github.com/manifold-space/manifold/app/core/internal/config"
	"github.com/manifold-space/manifold/app/core/internal/events"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

type apiHandler struct {
	cfg           config.Config
	store         *store.Store
	auth          *auth.Service
	validate      *validator.Validate
	contentCache  *cache.ContentCache
	statsCache    *cache.StatsCache
	overviewCache *cache.OverviewCache
	auditEvents   events.AuditPublisher
	ledger        *chain.Ledger
	mutations     *application.Service
	githubClient  *http.Client
	agentRuntime  agentRunner
}

type agentRunner interface {
	Ready(ctx context.Context) error
	Run(ctx context.Context, sessionID, userMessage string, emit func(agent.StreamEvent) error) error
	List(ctx context.Context, sessionID string, limit int) ([]agent.SessionMessage, error)
	Clear(ctx context.Context, sessionID string) error
	Undo(ctx context.Context, sessionID, messageID string) (agent.SessionMessage, []agent.SessionMessage, error)
}

// coreVersion is the build version reported by /healthz and the admin system endpoint.
const coreVersion = "0.2.0"

var processStartedAt = time.Now().UTC()

func Router(cfg config.Config, database *store.Store) http.Handler {
	return newRouter(cfg, database, nil, events.NewSynchronousAuditPublisher(recordAuditEvent(database)))
}

// RouterWithLifecycle wires the production stack: the audit dispatcher and,
// when a ledger is supplied, the anchoring-chain miner. The returned close
// function cancels and waits for the miner before draining audit events.
func RouterWithLifecycle(cfg config.Config, database *store.Store, ledger *chain.Ledger) (http.Handler, func()) {
	auditEvents := events.NewAuditDispatcher(cfg.AuditEventBuffer, recordAuditEvent(database))
	router, closeRouter := newRouterWithMiner(cfg, database, ledger, auditEvents)
	return router, func() {
		closeRouter()
		if !auditEvents.CloseWithTimeout(5 * time.Second) {
			slog.Warn("audit_shutdown_timeout", "timeout", "5s")
		}
	}
}

// recordAuditEvent is the dispatcher's sink. It runs on the dispatcher's
// own goroutine, after the request that produced the event has finished, so
// it has no request context to inherit and starts a detached one.
func recordAuditEvent(database *store.Store) func(events.AuditEvent) {
	return func(event events.AuditEvent) {
		if err := database.RecordAuditEvent(context.Background(), event.EventName, event.ResourceType, event.ResourceID, event.Actor, event.RequestID, event.TraceID, event.Metadata); err != nil {
			slog.Error("audit_event_failed", "eventName", event.EventName, "resourceType", event.ResourceType, "resourceId", event.ResourceID, "error", err)
		}
	}
}

func newRouter(cfg config.Config, database *store.Store, ledger *chain.Ledger, auditEvents events.AuditPublisher) http.Handler {
	router, _ := newRouterWithMiner(cfg, database, ledger, auditEvents)
	return router
}

// newRouterWithMiner builds the router and, for a non-nil ledger, starts the
// miner goroutine whose OnMined hook invalidates content caches for every
// content-source certificate that got anchored (docs/chain.md §9). The
// returned close function cancels the miner and waits for its goroutine.
func newRouterWithMiner(cfg config.Config, database *store.Store, ledger *chain.Ledger, auditEvents events.AuditPublisher) (http.Handler, func()) {
	authService, err := auth.New(cfg, database)
	if err != nil {
		panic(err)
	}
	h := &apiHandler{cfg: cfg, store: database, auth: authService, validate: validator.New(), contentCache: cache.NewContentCache(cfg.ContentCacheTTL), statsCache: cache.NewStatsCache(cfg.StatsCacheTTL), overviewCache: cache.NewOverviewCache(cfg.StatsCacheTTL), auditEvents: auditEvents, ledger: ledger, githubClient: &http.Client{Timeout: 12 * time.Second}}
	h.agentRuntime = newAgentRuntime(database, ledger)
	h.mutations = application.NewService(database, ledger, auditEvents, h.contentCache, h.statsCache, h.overviewCache)
	miner := startChainMiner(h, database, ledger)
	closeMiner := func() {
		if miner != nil {
			miner.Close()
		}
	}
	return buildRouter(h, cfg), closeMiner
}

func newAgentRuntime(database *store.Store, ledger *chain.Ledger) agentRunner {
	scenarios := agent.NewScenarioRegistry()
	dependencies := agentscenarios.ManifoldDependencies{Profile: database, Content: database, ContentDetail: database}
	if ledger != nil {
		dependencies.Chain = ledger
		dependencies.ChainAnchors = ledger
	}
	if err := agentscenarios.RegisterManifold(scenarios, dependencies); err != nil {
		panic(err)
	}
	scenario, err := scenarios.Build(agentscenarios.Manifold)
	if err != nil {
		panic(err)
	}
	memory := agent.NewMemory()
	return newConfiguredAgentRuntime(database, scenario, memory)
}
