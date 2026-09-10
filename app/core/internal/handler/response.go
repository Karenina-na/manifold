package handler

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/go-playground/validator/v10"

	"github.com/manifold-space/manifold/app/core/internal/auth"
	"github.com/manifold-space/manifold/app/core/internal/cache"
	"github.com/manifold-space/manifold/app/core/internal/chain"
	"github.com/manifold-space/manifold/app/core/internal/config"
	"github.com/manifold-space/manifold/app/core/internal/events"
	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

// decodeJSON is the single JSON request boundary. Unknown fields and trailing
// payloads are rejected so the wire contract cannot silently drift.
func decodeJSON(r *http.Request, dst any) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("request body must contain one JSON value")
		}
		return err
	}
	return nil
}

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
	githubClient  *http.Client
}

type minerLifecycle struct {
	cancel context.CancelFunc
	done   <-chan struct{}
}

func startMiner(run func(context.Context)) *minerLifecycle {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		run(ctx)
	}()
	return &minerLifecycle{cancel: cancel, done: done}
}

func (m *minerLifecycle) Close() {
	m.cancel()
	<-m.done
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

func recordAuditEvent(database *store.Store) func(events.AuditEvent) {
	return func(event events.AuditEvent) {
		if err := database.RecordAuditEvent(event.EventName, event.ResourceType, event.ResourceID, event.Actor, event.RequestID, event.TraceID, event.Metadata); err != nil {
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
	var miner *minerLifecycle
	if ledger != nil {
		miner = startMiner(func(minerCtx context.Context) {
			if err := ledger.Run(minerCtx, chain.RunOptions{
				OnMined: func(block chain.Block, minedFor time.Duration) {
					// Audit chain.block.mined per docs/chain.md §9 (index, cert
					// count, nonce, mode, duration); the miner has no request
					// context, so publish directly through the dispatcher.
					if h.auditEvents != nil {
						h.auditEvents.Publish(events.AuditEvent{
							EventName: "chain.block.mined", ResourceType: "chain_block", ResourceID: block.ID,
							Actor: "chain-miner",
							Metadata: map[string]string{"index": strconv.Itoa(block.Index), "certCount": strconv.Itoa(len(block.CertIDs)),
								"nonce": strconv.Itoa(block.Nonce), "proofMode": string(block.ProofMode), "durationMs": strconv.FormatInt(minedFor.Milliseconds(), 10)},
						})
					}
					for _, certID := range block.CertIDs {
						anchor, err := ledger.GetAnchor(certID)
						if err != nil {
							continue
						}
						if anchor.Source == chain.SourceContent {
							if slug, ok := anchor.Metadata["slug"].(string); ok && slug != "" {
								h.contentCache.Remove(slug)
								if content, err := database.GetContentByID(anchor.SubjectRef, true); err == nil {
									h.contentCache.Remove(content.Slug)
								}
							}
						}
					}
				},
				OnCrashed: func(err error) {
					slog.Error("chain_miner_crashed", "error", err)
					if h.auditEvents != nil {
						h.auditEvents.Publish(events.AuditEvent{
							EventName: "chain.miner.crashed", ResourceType: "chain_miner", ResourceID: "miner", Actor: "chain-miner",
							Metadata: map[string]string{"error": err.Error()},
						})
					}
				},
			}); err != nil && !errors.Is(err, context.Canceled) {
				slog.Error("chain_miner_stopped", "error", err)
			}
		})
	}
	closeMiner := func() {
		if miner != nil {
			miner.Close()
		}
	}
	publicLimiter := newRateLimiter(cfg.RateLimitPerMin)
	loginLimiter := newRateLimiter(cfg.LoginRatePerMin)
	// 每个验证请求都会全链重放，配额比普通公开写入更紧（docs/chain.md §10）。
	verifyLimiter := newRateLimiter(cfg.ChainVerifyRatePerMin)
	trustedProxies := trustedProxyNetworks(cfg.TrustedProxyCIDRs)
	router := chi.NewRouter()
	router.Use(requestIDMiddleware)
	router.Use(securityHeaders)
	router.Use(cors.Handler(cors.Options{
		AllowedOrigins: cfg.AllowedOrigins,
		AllowedMethods: []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodOptions},
		AllowedHeaders: []string{"Accept", "Authorization", "Content-Type", "X-Trace-ID", "X-Visitor-ID"},
		ExposedHeaders: []string{"X-Request-ID", "X-Trace-ID"},
	}))
	router.Get("/healthz", Health)
	router.Route("/api/v1", func(api chi.Router) {
		api.Get("/profile", h.profile)
		api.Get("/site", h.site)
		api.Get("/stats", h.stats)
		api.With(publicLimiter.middleware(trustedProxies)).Post("/presence", h.presence)
		api.Get("/content", h.listContent)
		api.Get("/tags", h.tags)
		api.Get("/content/{slug}", h.getContent)
		api.Get("/media/{id}", h.getMedia)
		api.Get("/content/{slug}/comments", h.listPublicComments)
		api.With(publicLimiter.middleware(trustedProxies)).Post("/content/{slug}/comments", h.createComment)
		api.Get("/auth/me", h.authMe)
		api.With(publicLimiter.middleware(trustedProxies)).Post("/auth/github/exchange", h.githubExchange)
		api.Get("/content/{slug}/likes", h.getLikes)
		api.With(publicLimiter.middleware(trustedProxies)).Put("/content/{slug}/likes", h.putLike)
		api.With(publicLimiter.middleware(trustedProxies)).Delete("/content/{slug}/likes", h.deleteLike)
		api.With(loginLimiter.middleware(trustedProxies)).Post("/admin/session", h.login)
		api.Route("/chain", func(ch chi.Router) {
			ch.Get("/", h.chainInfo)
			ch.Get("/anchors", h.listChainAnchors)
			ch.With(publicLimiter.middleware(trustedProxies)).Post("/anchors", h.submitPublicAnchor)
			ch.Get("/anchors/{id}", h.getChainAnchor)
			ch.Get("/blocks", h.listChainBlocks)
			ch.Get("/blocks/{id}", h.getChainBlock)
			ch.With(verifyLimiter.middleware(trustedProxies)).Get("/verify", h.verifyAnchorByHash)
			ch.With(verifyLimiter.middleware(trustedProxies)).Post("/verify", h.verifyAnchorPayload)
			ch.With(verifyLimiter.middleware(trustedProxies)).Get("/verify/content/{slug}", h.verifyAnchorContent)
			ch.With(verifyLimiter.middleware(trustedProxies)).Get("/verify/comment/{id}", h.verifyAnchorComment)
			ch.Get("/keys", h.listChainKeys)
		})
		api.Route("/admin", func(admin chi.Router) {
			admin.Use(h.auth.RequireAdmin)
			admin.Get("/profile", h.adminProfile)
			admin.Put("/profile", h.adminUpdateProfile)
			admin.Get("/site", h.adminSite)
			admin.Put("/site", h.adminUpdateSite)
			admin.Get("/thoughts/config", h.adminThoughtConfig)
			admin.Put("/thoughts/config", h.adminUpdateThoughtConfig)
			admin.Get("/writings/config", h.adminWritingConfig)
			admin.Put("/writings/config", h.adminUpdateWritingConfig)
			admin.Get("/content", h.adminListContent)
			admin.Get("/content/{id}", h.adminGetContent)
			admin.Post("/content", h.adminCreateContent)
			admin.Put("/content/{id}", h.adminUpdateContent)
			admin.Post("/content/{id}/comments", h.adminCreateComment)
			admin.Post("/content/{id}/publish", h.adminPublishContent)
			admin.Post("/content/{id}/unpublish", h.adminUnpublishContent)
			admin.Post("/content/{id}/restore", h.adminRestoreContent)
			admin.Delete("/content/{id}", h.adminDeleteContent)
			admin.Get("/comments", h.adminListComments)
			admin.Delete("/comments/{id}", h.adminDeleteComment)
			admin.Post("/comments/{id}/restore", h.adminRestoreComment)
			admin.Post("/comments/{id}/hide", h.adminHideComment)
			admin.Post("/comments/{id}/unhide", h.adminUnhideComment)
			admin.Put("/comments/{id}", h.adminUpdateCommentAuthor)
			admin.Get("/stats", h.adminStats)
			admin.Get("/overview", h.adminOverview)
			admin.Get("/analytics/views", h.adminAnalyticsViews)
			admin.Get("/system", h.adminSystem)
			admin.Get("/audit", h.adminAudit)
			admin.Post("/session/logout", h.adminLogoutSession)
			admin.Post("/session/logout-all", h.adminLogoutSessions)
			admin.Post("/session/{id}/logout", h.adminLogoutSessionByID)
			admin.Get("/session/list", h.adminListSessions)
			admin.Post("/password", h.adminChangePassword)
			admin.Get("/media", h.adminListMedia)
			admin.Post("/media", h.adminUploadMedia)
			admin.Delete("/media/{id}", h.adminDeleteMedia)
			admin.Get("/media/{id}/references", h.adminListMediaReferences)
			admin.Post("/chain/anchors", h.adminSubmitAnchor)
		})
	})
	return router, closeMiner
}

func WriteJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func WriteError(w http.ResponseWriter, status int, code, message string) {
	errorBody := map[string]any{"code": code, "message": message}
	if requestID := w.Header().Get("X-Request-ID"); requestID != "" {
		errorBody["requestId"] = requestID
	}
	if traceID := w.Header().Get("X-Trace-ID"); traceID != "" {
		errorBody["traceId"] = traceID
	}
	WriteJSON(w, status, map[string]any{"error": errorBody})
}

func Health(w http.ResponseWriter, _ *http.Request) {
	WriteJSON(w, http.StatusOK, map[string]string{"status": "ok", "version": coreVersion, "startedAt": processStartedAt.Format(time.RFC3339)})
}

// collection is the single list envelope for every endpoint.
func collection[T any](items []T, pagination model.Pagination) map[string]any {
	if items == nil {
		items = []T{}
	}
	return map[string]any{"data": items, "pagination": pagination}
}

func (h *apiHandler) audit(r *http.Request, eventName, resourceType, resourceID string, metadata map[string]string) {
	actor := "anonymous"
	if claims := auth.ClaimsFromContext(r.Context()); claims != nil && claims.Subject != "" {
		actor = claims.Subject
	}
	requestID := headerPtr(r.Header.Get("X-Request-ID"))
	traceID := headerPtr(r.Header.Get("X-Trace-ID"))
	if !h.auditEvents.Publish(events.AuditEvent{EventName: eventName, ResourceType: resourceType, ResourceID: resourceID, Actor: actor, RequestID: requestID, TraceID: traceID, Metadata: metadata}) {
		slog.Warn("audit_event_dropped", "eventName", eventName, "resourceType", resourceType, "resourceId", resourceID)
	}
}

func headerPtr(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func requestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := correlationID(r.Header.Get("X-Request-ID"), "req")
		traceID := correlationID(r.Header.Get("X-Trace-ID"), "trace")
		w.Header().Set("X-Request-ID", requestID)
		w.Header().Set("X-Trace-ID", traceID)
		r.Header.Set("X-Request-ID", requestID)
		r.Header.Set("X-Trace-ID", traceID)
		started := time.Now()
		recorder := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(recorder, r)
		slog.Info("http_request", "requestId", requestID, "traceId", traceID, "method", r.Method, "path", r.URL.Path, "status", recorder.status, "durationMs", time.Since(started).Milliseconds())
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (r *statusRecorder) WriteHeader(status int) {
	if r.wroteHeader {
		return
	}
	r.wroteHeader = true
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Write(body []byte) (int, error) {
	if !r.wroteHeader {
		r.WriteHeader(http.StatusOK)
	}
	if r.status == 0 {
		r.status = http.StatusOK
	}
	return r.ResponseWriter.Write(body)
}

var correlationIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`)

func correlationID(value, prefix string) string {
	value = strings.TrimSpace(value)
	if correlationIDPattern.MatchString(value) {
		return value
	}
	return newCorrelationID(prefix)
}

func newCorrelationID(prefix string) string {
	value := make([]byte, 8)
	if _, err := rand.Read(value); err != nil {
		return fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())
	}
	return prefix + "_" + fmt.Sprintf("%x", value)
}

// systemResources samples host metrics via gopsutil. Individual metric failures
// degrade to zero values: resource sampling is observational data and must not
// fail the health query the way store reads do.
func systemResources(databasePath string) (model.SystemResources, uint64) {
	resources := model.SystemResources{}
	if percents, err := systemCPUPercent(); err == nil {
		resources.CPUPercent = percents
	}
	if counts, err := systemCPUCores(); err == nil {
		resources.CPUCores = counts
	}
	if vm, err := systemMemory(); err == nil {
		resources.MemTotalBytes = vm.Total
		resources.MemUsedBytes = vm.Used
		resources.MemUsedPercent = vm.UsedPercent
	}
	if avg, err := systemLoad(); err == nil {
		resources.LoadAvg1 = avg.Load1
		resources.LoadAvg5 = avg.Load5
		resources.LoadAvg15 = avg.Load15
	}
	if usage, err := systemDisk(databasePath); err == nil {
		resources.DiskTotalBytes = usage.Total
		resources.DiskUsedBytes = usage.Used
		resources.DiskUsedPercent = usage.UsedPercent
	}
	var rssBytes uint64
	if proc, err := systemProcess(); err == nil {
		if info, err := proc.MemoryInfo(); err == nil {
			rssBytes = info.RSS
		}
	}
	return resources, rssBytes
}

// invalidateContentBySlug drops the public cache key for a slug and purges the
// aggregate snapshots that include content data.
func (h *apiHandler) invalidateContentBySlug(slug string) {
	h.statsCache.Purge()
	h.overviewCache.Purge()
	if slug != "" {
		h.contentCache.Remove(slug)
	}
}
