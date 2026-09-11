package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"

	"github.com/manifold-space/manifold/app/core/internal/config"
)

func buildRouter(h *apiHandler, cfg config.Config) chi.Router {
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
		api.Get("/home/timeline", h.homeTimeline)
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
	return router
}
