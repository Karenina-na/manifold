package handler

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/go-playground/validator/v10"
	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/process"

	"github.com/manifold-space/manifold/app/core/internal/auth"
	"github.com/manifold-space/manifold/app/core/internal/cache"
	"github.com/manifold-space/manifold/app/core/internal/config"
	"github.com/manifold-space/manifold/app/core/internal/events"
	"github.com/manifold-space/manifold/app/core/internal/model"
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
}

// coreVersion is the build version reported by /healthz and the admin system endpoint.
const coreVersion = "0.1.0"

var processStartedAt = time.Now().UTC()

// Router is retained for internal callers that cannot own a shutdown hook.
// Production entry points must use RouterWithLifecycle so audit writes are asynchronous and drained on shutdown.
func Router(cfg config.Config, database *store.Store) http.Handler {
	return newRouter(cfg, database, events.NewSynchronousAuditPublisher(recordAuditEvent(database)))
}

func RouterWithLifecycle(cfg config.Config, database *store.Store) (http.Handler, func()) {
	auditEvents := events.NewAuditDispatcher(cfg.AuditEventBuffer, recordAuditEvent(database))
	router := newRouter(cfg, database, auditEvents)
	return router, func() {
		if !auditEvents.CloseWithTimeout(5 * time.Second) {
			slog.Warn("audit_shutdown_timeout", "timeout", "5s")
		}
	}
}

func recordAuditEvent(database *store.Store) func(events.AuditEvent) {
	return func(event events.AuditEvent) {
		if err := database.RecordAuditEvent(event.EventName, event.ResourceType, event.ResourceID, event.Actor, event.RequestID, event.TraceID, event.Metadata); err != nil {
			slog.Error("audit_event_failed", "eventName", event.EventName, "resourceType", event.ResourceType, "resourceId", event.ResourceID, "requestId", event.RequestID, "traceId", event.TraceID, "error", err)
		}
	}
}

func newRouter(cfg config.Config, database *store.Store, auditEvents events.AuditPublisher) http.Handler {
	authService, err := auth.New(cfg)
	if err != nil {
		panic(err)
	}
	h := &apiHandler{cfg: cfg, store: database, auth: authService, validate: validator.New(), contentCache: cache.NewContentCache(cfg.ContentCacheTTL), statsCache: cache.NewStatsCache(cfg.StatsCacheTTL), overviewCache: cache.NewOverviewCache(cfg.StatsCacheTTL), auditEvents: auditEvents}
	h.prewarmFeaturedContent()
	router := chi.NewRouter()
	router.Use(requestIDMiddleware)
	router.Use(cors.Handler(cors.Options{
		AllowedOrigins: cfg.AllowedOrigins,
		AllowedMethods: []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions},
		AllowedHeaders: []string{"Accept", "Authorization", "Content-Type", "Idempotency-Key", "X-Trace-ID", "X-Visitor-ID"},
		ExposedHeaders: []string{"X-Request-ID", "X-Trace-ID"},
	}))
	router.Get("/healthz", Health)
	router.Route("/api/v1", func(api chi.Router) {
		api.Get("/profile", h.profile)
		api.Get("/site", h.site)
		api.Get("/feed", h.feed)
		api.Get("/stats", h.stats)
		api.Post("/presence", h.presence)
		api.Get("/content", h.listContent)
		api.Get("/thoughts", h.thoughts)
		api.Get("/tags", h.tags)
		api.Get("/content/{slug}", h.getContent)
		api.Get("/content/{slug}/comments", h.listPublicComments)
		api.Post("/content/{slug}/comments", h.createComment)
		api.Get("/content/{slug}/likes", h.getLikes)
		api.Put("/content/{slug}/likes", h.putLike)
		api.Delete("/content/{slug}/likes", h.deleteLike)
		api.Post("/admin/session", h.login)
		api.Route("/admin", func(admin chi.Router) {
			admin.Use(h.auth.RequireAdmin)
			admin.Get("/profile", h.adminProfile)
			admin.Patch("/profile", h.adminUpdateProfile)
			admin.Get("/site", h.adminSite)
			admin.Patch("/site", h.adminUpdateSite)
			admin.Get("/thoughts/config", h.adminThoughtConfig)
			admin.Patch("/thoughts/config", h.adminUpdateThoughtConfig)
			admin.Get("/content", h.adminListContent)
			admin.Post("/content", h.adminCreateContent)
			admin.Patch("/content/{id}", h.adminUpdateContent)
			admin.Post("/content/{id}/publish", h.adminPublishContent)
			admin.Post("/content/{id}/unpublish", h.adminUnpublishContent)
			admin.Delete("/content/{id}", h.adminDeleteContent)
			admin.Get("/comments", h.adminListComments)
			admin.Delete("/comments/{id}", h.adminDeleteComment)
			admin.Post("/comments/{id}/restore", h.adminRestoreComment)
			admin.Get("/stats", h.adminStats)
			admin.Get("/overview", h.adminOverview)
			admin.Get("/analytics/views", h.adminAnalyticsViews)
			admin.Get("/system", h.adminSystem)
			admin.Get("/audit", h.adminAudit)
		})
	})
	return router
}

func (h *apiHandler) prewarmFeaturedContent() {
	config, err := h.store.GetSiteConfig()
	if err != nil {
		slog.Warn("content_cache_prewarm_failed", "reason", "site_config_unavailable", "error", err)
		return
	}
	for _, reference := range config.FeaturedContent {
		content, err := h.store.GetContentByID(reference.ID, false)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			slog.Warn("content_cache_prewarm_failed", "contentId", reference.ID, "error", err)
			continue
		}
		h.contentCache.Set(content.Slug, content)
	}
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

func (h *apiHandler) login(w http.ResponseWriter, r *http.Request) {
	var input loginInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || h.validate.Struct(input) != nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "Username and password are required.")
		return
	}
	token, err := h.auth.Login(input.Username, input.Password)
	if err != nil {
		WriteError(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Username or password is incorrect.")
		return
	}
	h.audit(r, "admin.session.created", "session", input.Username, nil)
	WriteJSON(w, http.StatusOK, map[string]any{"accessToken": token, "tokenType": "Bearer", "expiresIn": 43200, "user": map[string]string{"username": input.Username, "role": "admin"}})
}

func (h *apiHandler) profile(w http.ResponseWriter, _ *http.Request) {
	profile, err := h.store.GetProfile()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "PROFILE_UNAVAILABLE", "Profile is unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, profile)
}

func (h *apiHandler) site(w http.ResponseWriter, _ *http.Request) {
	config, err := h.store.GetSiteConfig()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "SITE_UNAVAILABLE", "Site configuration is unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{
		"profile":         map[string]string{"id": "profile_1"},
		"featuredContent": config.FeaturedContent,
		"navigation":      config.Navigation,
		"sections":        config.Sections,
	})
}

func (h *apiHandler) feed(w http.ResponseWriter, r *http.Request) {
	h.listContent(w, r)
}

func (h *apiHandler) stats(w http.ResponseWriter, _ *http.Request) {
	if stats, ok := h.statsCache.Get(); ok {
		WriteJSON(w, http.StatusOK, stats)
		return
	}
	stats, err := h.store.Stats()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "STATS_UNAVAILABLE", "Stats are unavailable.")
		return
	}
	h.statsCache.Set(stats)
	WriteJSON(w, http.StatusOK, stats)
}

func (h *apiHandler) presence(w http.ResponseWriter, r *http.Request) {
	visitorID, err := visitorID(r, true)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VISITOR_ID_INVALID", "Visitor ID is required and invalid.")
		return
	}
	activeVisitors, err := h.store.TouchPresence(visitorID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "PRESENCE_UNAVAILABLE", "Presence is unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, model.PresenceStatus{ActiveVisitors: activeVisitors, ObservedAt: time.Now().UTC().Format(time.RFC3339)})
}

func (h *apiHandler) listContent(w http.ResponseWriter, r *http.Request) {
	options, err := parseContentListOptions(r, false)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_QUERY", err.Error())
		return
	}
	result, err := h.store.ListContent(false, options)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CONTENT_UNAVAILABLE", "Content is unavailable.")
		return
	}
	if options.Page > 0 {
		items := result.Items
		if items == nil {
			items = []model.Content{}
		}
		WriteJSON(w, http.StatusOK, map[string]any{"data": items, "pagination": map[string]any{"nextCursor": nil, "hasMore": result.HasMore, "page": result.Page, "pageSize": result.PageSize, "totalItems": result.TotalItems, "totalPages": result.TotalPages}})
		return
	}
	WriteJSON(w, http.StatusOK, collectionWithCursor(result.Items, options.Offset, options.Limit, result.HasMore))
}

func (h *apiHandler) tags(w http.ResponseWriter, r *http.Request) {
	kind := model.ContentKind(strings.TrimSpace(r.URL.Query().Get("kind")))
	if kind != "" && kind != model.ContentKindThought && kind != model.ContentKindArticle {
		WriteError(w, http.StatusBadRequest, "INVALID_QUERY", "kind is invalid")
		return
	}
	tags, err := h.store.Tags(kind)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "TAGS_UNAVAILABLE", "Tags are unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, collection(tags))
}

func (h *apiHandler) thoughts(w http.ResponseWriter, r *http.Request) {
	page, limit, tags, search, err := parseThoughtArchiveOptions(r)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_QUERY", err.Error())
		return
	}
	archive, err := h.store.ThoughtArchive(page, limit, tags, search)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "THOUGHTS_UNAVAILABLE", "Thoughts are unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, archive)
}

func (h *apiHandler) getContent(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	content, ok := h.contentCache.Get(slug)
	if !ok {
		var err error
		content, err = h.store.GetContent(slug, false)
		if errors.Is(err, sql.ErrNoRows) {
			WriteError(w, http.StatusNotFound, "CONTENT_NOT_FOUND", "Content was not found.")
			return
		}
		if err != nil {
			WriteError(w, http.StatusInternalServerError, "CONTENT_UNAVAILABLE", "Content is unavailable.")
			return
		}
	}
	if r.URL.Query().Get("trackView") != "false" {
		viewerID := ""
		if id, err := visitorID(r, false); err == nil {
			viewerID = id
		}
		viewCount, likeCount, err := h.store.RecordContentView(content.ID, viewerID, referrerOrigin(r.Referer()))
		if err != nil {
			slog.Error("content_view_count_failed", "contentId", content.ID, "error", err)
		} else {
			content.ViewCount, content.LikeCount = viewCount, likeCount
		}
	}
	if slug != "" {
		h.contentCache.Set(slug, content)
	}
	h.audit(r, "content.viewed", "content", content.ID, nil)
	WriteJSON(w, http.StatusOK, content)
}

// referrerOrigin reduces a Referer header to scheme://host so analytics
// grouping stays stable across page paths; unparseable values are truncated.
func referrerOrigin(header string) string {
	value := strings.TrimSpace(header)
	if value == "" {
		return ""
	}
	if parsed, err := url.Parse(value); err == nil && parsed.Host != "" {
		return parsed.Scheme + "://" + parsed.Host
	}
	if len(value) > 256 {
		value = value[:256]
	}
	return value
}

func (h *apiHandler) listPublicComments(w http.ResponseWriter, r *http.Request) {
	content, err := h.store.GetContent(chi.URLParam(r, "slug"), false)
	if errors.Is(err, sql.ErrNoRows) {
		WriteError(w, http.StatusNotFound, "CONTENT_NOT_FOUND", "Content was not found.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CONTENT_UNAVAILABLE", "Content is unavailable.")
		return
	}
	options, err := parseCommentListOptions(r)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_QUERY", err.Error())
		return
	}
	result, err := h.store.ListComments(content.ID, options)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "COMMENTS_UNAVAILABLE", "Comments are unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": result.Comments, "pagination": map[string]any{"nextCursor": nil, "hasMore": false, "page": result.Page, "pageSize": result.PageSize, "totalItems": result.TotalItems, "totalPages": result.TotalPages}})
}

type commentInput struct {
	AuthorName string  `json:"authorName" validate:"max=80"`
	AuthorURL  string  `json:"authorUrl"`
	Body       string  `json:"body" validate:"required,max=4000"`
	ReplyToID  *string `json:"replyToId"`
	AvatarSeed string  `json:"avatarSeed" validate:"max=64"`
}

type loginInput struct {
	Username string `json:"username" validate:"required,max=80"`
	Password string `json:"password" validate:"required,min=8,max=200"`
}

func (h *apiHandler) createComment(w http.ResponseWriter, r *http.Request) {
	content, err := h.store.GetContent(chi.URLParam(r, "slug"), false)
	if errors.Is(err, sql.ErrNoRows) {
		WriteError(w, http.StatusNotFound, "CONTENT_NOT_FOUND", "Content was not found.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CONTENT_UNAVAILABLE", "Content is unavailable.")
		return
	}
	var input commentInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || h.validate.Struct(input) != nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "Comment body is required.")
		return
	}
	authorName := strings.TrimSpace(input.AuthorName)
	if authorName == "" {
		authorName = "Anonymous"
	}
	comment, err := h.store.CreateComment(content.ID, authorName, strings.TrimSpace(input.AuthorURL), strings.TrimSpace(input.Body), input.ReplyToID, strings.TrimSpace(input.AvatarSeed))
	if errors.Is(err, store.ErrCommentReplyInvalid) {
		WriteError(w, http.StatusUnprocessableEntity, "REPLY_TARGET_INVALID", "The comment you replied to is no longer available.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "COMMENT_CREATE_FAILED", "Comment could not be created.")
		return
	}
	h.audit(r, "comment.created", "comment", comment.ID, map[string]string{"contentId": content.ID})
	h.invalidateContentByID(content.ID)
	WriteJSON(w, http.StatusCreated, comment)
}

func (h *apiHandler) getLikes(w http.ResponseWriter, r *http.Request) {
	content, err := h.store.GetContent(chi.URLParam(r, "slug"), false)
	if errors.Is(err, sql.ErrNoRows) {
		WriteError(w, http.StatusNotFound, "CONTENT_NOT_FOUND", "Content was not found.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CONTENT_UNAVAILABLE", "Content is unavailable.")
		return
	}
	visitorID, err := visitorID(r, false)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VISITOR_ID_INVALID", "Visitor ID is invalid.")
		return
	}
	summary, err := h.store.GetLikeSummary(content.ID, visitorID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "LIKES_UNAVAILABLE", "Likes are unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, summary)
}

func (h *apiHandler) putLike(w http.ResponseWriter, r *http.Request) {
	h.mutateLike(w, r, true)
}

func (h *apiHandler) deleteLike(w http.ResponseWriter, r *http.Request) {
	h.mutateLike(w, r, false)
}

func (h *apiHandler) mutateLike(w http.ResponseWriter, r *http.Request, enabled bool) {
	content, err := h.store.GetContent(chi.URLParam(r, "slug"), false)
	if errors.Is(err, sql.ErrNoRows) {
		WriteError(w, http.StatusNotFound, "CONTENT_NOT_FOUND", "Content was not found.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CONTENT_UNAVAILABLE", "Content is unavailable.")
		return
	}
	visitorID, err := visitorID(r, true)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VISITOR_ID_INVALID", "Visitor ID is required and invalid.")
		return
	}
	if enabled {
		err = h.store.SetLike(content.ID, visitorID)
	} else {
		err = h.store.DeleteLike(content.ID, visitorID)
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "LIKE_UPDATE_FAILED", "Like could not be updated.")
		return
	}
	action := "removed"
	if enabled {
		action = "added"
	}
	h.audit(r, "content.like."+action, "content", content.ID, nil)
	h.overviewCache.Purge()
	summary, err := h.store.GetLikeSummary(content.ID, visitorID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "LIKES_UNAVAILABLE", "Likes are unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, summary)
}

func visitorID(r *http.Request, required bool) (string, error) {
	value := strings.TrimSpace(r.Header.Get("X-Visitor-ID"))
	if value == "" && !required {
		return "", nil
	}
	if len(value) < 8 || len(value) > 128 {
		return "", errors.New("visitor id length is invalid")
	}
	for _, char := range value {
		if (char < 'a' || char > 'z') && (char < 'A' || char > 'Z') && (char < '0' || char > '9') && char != '-' && char != '_' {
			return "", errors.New("visitor id contains invalid characters")
		}
	}
	return value, nil
}

func (h *apiHandler) adminListContent(w http.ResponseWriter, r *http.Request) {
	options, err := parseContentListOptions(r, true)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_QUERY", err.Error())
		return
	}
	result, err := h.store.ListContent(true, options)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CONTENT_UNAVAILABLE", "Content is unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, collectionWithCursor(result.Items, options.Offset, options.Limit, result.HasMore))
}

func (h *apiHandler) adminProfile(w http.ResponseWriter, _ *http.Request) {
	profile, err := h.store.GetProfile()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "PROFILE_UNAVAILABLE", "Profile is unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, profile)
}

func (h *apiHandler) adminUpdateProfile(w http.ResponseWriter, r *http.Request) {
	var input model.Profile
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || h.validate.Struct(input) != nil || strings.TrimSpace(input.DisplayName) == "" {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "Display name is required.")
		return
	}
	if err := h.store.UpdateProfile(input); err != nil {
		WriteError(w, http.StatusInternalServerError, "PROFILE_UPDATE_FAILED", "Profile could not be updated.")
		return
	}
	h.audit(r, "profile.updated", "profile", "profile_1", nil)
	h.profile(w, r)
}

func (h *apiHandler) adminSite(w http.ResponseWriter, _ *http.Request) {
	config, err := h.store.GetSiteConfig()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "SITE_UNAVAILABLE", "Site configuration is unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, config)
}

func (h *apiHandler) adminUpdateSite(w http.ResponseWriter, r *http.Request) {
	var input model.SiteConfig
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || h.validate.Struct(input) != nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "Navigation and sections are required.")
		return
	}
	if err := h.store.UpdateSiteConfig(input); err != nil {
		WriteError(w, http.StatusInternalServerError, "SITE_UPDATE_FAILED", "Site configuration could not be updated.")
		return
	}
	h.audit(r, "site.updated", "site", "site_1", nil)
	h.adminSite(w, r)
}

func (h *apiHandler) adminThoughtConfig(w http.ResponseWriter, _ *http.Request) {
	config, err := h.store.GetThoughtConfig()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "THOUGHT_CONFIG_UNAVAILABLE", "Thought configuration is unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, config)
}

func (h *apiHandler) adminUpdateThoughtConfig(w http.ResponseWriter, r *http.Request) {
	var input struct {
		FeaturedThoughtID json.RawMessage `json:"featuredThoughtId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || len(input.FeaturedThoughtID) == 0 {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "featuredThoughtId is required and may be null.")
		return
	}
	var featuredThoughtID *string
	if string(input.FeaturedThoughtID) != "null" {
		var value string
		if err := json.Unmarshal(input.FeaturedThoughtID, &value); err != nil || strings.TrimSpace(value) == "" || len(value) > 160 {
			WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "featuredThoughtId must be a content ID or null.")
			return
		}
		value = strings.TrimSpace(value)
		content, err := h.store.GetContentByID(value, false)
		if err != nil || content.Kind != model.ContentKindThought {
			WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "Featured thought must reference published Thought content.")
			return
		}
		featuredThoughtID = &value
	}
	if err := h.store.UpdateThoughtConfig(featuredThoughtID); err != nil {
		WriteError(w, http.StatusInternalServerError, "THOUGHT_CONFIG_UPDATE_FAILED", "Thought configuration could not be updated.")
		return
	}
	h.audit(r, "thoughts.config.updated", "thoughts_config", "thoughts_1", nil)
	h.adminThoughtConfig(w, r)
}

type contentInput struct {
	Kind     model.ContentKind `json:"kind" validate:"required,oneof=THOUGHT ARTICLE"`
	Slug     string            `json:"slug" validate:"omitempty,max=160"`
	Title    string            `json:"title" validate:"omitempty,max=200"`
	Summary  string            `json:"summary" validate:"max=4000"`
	Body     string            `json:"body" validate:"required,max=100000"`
	Tags     []string          `json:"tags"`
	Metadata map[string]any    `json:"metadata"`
}

func validateContentMetadata(kind model.ContentKind, metadata map[string]any) error {
	if metadata == nil {
		metadata = map[string]any{}
	}
	stringField := func(name string, required bool) error {
		value, ok := metadata[name]
		if !ok || value == nil || strings.TrimSpace(fmt.Sprint(value)) == "" {
			if required {
				return fmt.Errorf("metadata.%s is required", name)
			}
			return nil
		}
		if _, ok := value.(string); !ok {
			return fmt.Errorf("metadata.%s must be a string", name)
		}
		if len(strings.TrimSpace(value.(string))) > 2000 {
			return fmt.Errorf("metadata.%s is too long", name)
		}
		return nil
	}
	switch kind {
	case model.ContentKindThought:
		if err := stringField("mood", false); err != nil {
			return err
		}
		if err := stringField("question", false); err != nil {
			return err
		}
		if err := stringField("context", false); err != nil {
			return err
		}
		return stringField("source", false)
	case model.ContentKindArticle:
		if readingMinutes, ok := metadata["readingMinutes"]; ok {
			value, valid := readingMinutes.(float64)
			if !valid || value < 0 || value != float64(int(value)) {
				return fmt.Errorf("metadata.readingMinutes must be a non-negative integer")
			}
		}
		if toc, ok := metadata["toc"]; ok {
			items, valid := toc.([]any)
			if !valid {
				return fmt.Errorf("metadata.toc must be an array")
			}
			if len(items) > 100 {
				return fmt.Errorf("metadata.toc has too many items")
			}
			for _, raw := range items {
				item, valid := raw.(map[string]any)
				if !valid {
					return fmt.Errorf("metadata.toc items must be objects")
				}
				id, idOK := item["id"].(string)
				label, labelOK := item["label"].(string)
				level, levelOK := item["level"].(float64)
				if !idOK || strings.TrimSpace(id) == "" || len(id) > 160 || !labelOK || strings.TrimSpace(label) == "" || len(label) > 200 || !levelOK || (level != 2 && level != 3) {
					return fmt.Errorf("metadata.toc items require id, label, and level 2 or 3")
				}
			}
		}
		if frontmatter, ok := metadata["frontmatter"]; ok {
			values, valid := frontmatter.(map[string]any)
			if !valid {
				return fmt.Errorf("metadata.frontmatter must be an object")
			}
			for key, value := range values {
				text, valid := value.(string)
				if strings.TrimSpace(key) == "" || len(key) > 120 || !valid || len(text) > 2000 {
					return fmt.Errorf("metadata.frontmatter values must be strings")
				}
			}
		}
		if technologies, ok := metadata["technologies"]; ok {
			items, valid := technologies.([]any)
			if !valid || len(items) > 32 {
				return fmt.Errorf("metadata.technologies must be an array of at most 32 strings")
			}
			for _, item := range items {
				text, valid := item.(string)
				if !valid || strings.TrimSpace(text) == "" || len(text) > 80 {
					return fmt.Errorf("metadata.technologies must contain strings")
				}
			}
		}
		if err := stringField("language", false); err != nil {
			return err
		}
		if difficulty, ok := metadata["difficulty"]; ok {
			value, valid := difficulty.(string)
			if !valid || (value != "BEGINNER" && value != "INTERMEDIATE" && value != "ADVANCED") {
				return fmt.Errorf("metadata.difficulty is invalid")
			}
		}
		return stringField("repositoryUrl", false)
	default:
		return fmt.Errorf("kind is invalid")
	}
}

func (h *apiHandler) adminCreateContent(w http.ResponseWriter, r *http.Request) {
	var input contentInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || h.validate.Struct(input) != nil || validateContentMetadata(input.Kind, input.Metadata) != nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "Kind, slug, title, and body are required.")
		return
	}
	if input.Kind == model.ContentKindArticle && (strings.TrimSpace(input.Slug) == "" || strings.TrimSpace(input.Title) == "") {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "Articles require a slug and title.")
		return
	}
	created, err := h.store.CreateContent(model.Content{Kind: input.Kind, Slug: input.Slug, Title: input.Title, Summary: input.Summary, Body: input.Body, Tags: input.Tags, Metadata: input.Metadata})
	if err != nil {
		WriteError(w, http.StatusConflict, "CONTENT_CREATE_FAILED", "Content could not be created.")
		return
	}
	h.audit(r, "content.created", "content", created.ID, map[string]string{"kind": string(created.Kind)})
	h.statsCache.Purge()
	h.overviewCache.Purge()
	WriteJSON(w, http.StatusCreated, created)
}

type contentPatchInput struct {
	Kind            *model.ContentKind `json:"kind" validate:"omitempty,oneof=THOUGHT ARTICLE"`
	Slug            *string            `json:"slug" validate:"omitempty,max=160"`
	Title           *string            `json:"title" validate:"omitempty,max=200"`
	Summary         *string            `json:"summary" validate:"omitempty,max=4000"`
	Body            *string            `json:"body" validate:"omitempty,max=100000"`
	Tags            *[]string          `json:"tags"`
	Metadata        *map[string]any    `json:"metadata"`
	ExpectedVersion *int               `json:"expectedVersion" validate:"required,min=1"`
}

func (h *apiHandler) adminUpdateContent(w http.ResponseWriter, r *http.Request) {
	var input contentPatchInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || h.validate.Struct(input) != nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "Invalid content input.")
		return
	}
	if input.Kind == nil && input.Slug == nil && input.Title == nil && input.Summary == nil && input.Body == nil && input.Tags == nil && input.Metadata == nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "At least one content field is required.")
		return
	}
	content, err := h.store.GetContentByID(chi.URLParam(r, "id"), true)
	if errors.Is(err, sql.ErrNoRows) {
		WriteError(w, http.StatusNotFound, "CONTENT_NOT_FOUND", "Content was not found.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CONTENT_UNAVAILABLE", "Content is unavailable.")
		return
	}
	contentKind := content.Kind
	if input.Kind != nil {
		contentKind = *input.Kind
	}
	effectiveTitle := content.Title
	if input.Title != nil {
		effectiveTitle = *input.Title
	}
	effectiveSlug := content.Slug
	if input.Slug != nil {
		effectiveSlug = *input.Slug
	}
	if contentKind == model.ContentKindArticle && (strings.TrimSpace(effectiveTitle) == "" || strings.TrimSpace(effectiveSlug) == "") {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "Articles require a title and slug.")
		return
	}
	if input.Metadata != nil {
		if validateContentMetadata(contentKind, *input.Metadata) != nil {
			WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "Metadata does not match the content kind.")
			return
		}
	}
	err = h.store.UpdateContent(chi.URLParam(r, "id"), store.ContentUpdate{Kind: input.Kind, Slug: input.Slug, Title: input.Title, Summary: input.Summary, Body: input.Body, Tags: input.Tags, Metadata: input.Metadata, ExpectedVersion: *input.ExpectedVersion})
	if errors.Is(err, store.ErrContentNotFound) {
		WriteError(w, http.StatusNotFound, "CONTENT_NOT_FOUND", "Content was not found.")
		return
	}
	if errors.Is(err, store.ErrVersionConflict) {
		WriteError(w, http.StatusConflict, "VERSION_CONFLICT", "Content was updated elsewhere.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CONTENT_UPDATE_FAILED", "Content could not be updated.")
		return
	}
	h.audit(r, "content.updated", "content", chi.URLParam(r, "id"), nil)
	h.invalidateContentByID(chi.URLParam(r, "id"))
	h.writeAdminContent(w, r)
}

func (h *apiHandler) adminPublishContent(w http.ResponseWriter, r *http.Request) {
	h.setContentStatus(w, r, "PUBLISHED")
}

func (h *apiHandler) adminUnpublishContent(w http.ResponseWriter, r *http.Request) {
	h.setContentStatus(w, r, "DRAFT")
}

func (h *apiHandler) setContentStatus(w http.ResponseWriter, r *http.Request, status string) {
	if err := h.store.SetContentStatus(chi.URLParam(r, "id"), status); err != nil {
		WriteError(w, http.StatusNotFound, "CONTENT_NOT_FOUND", "Content was not found.")
		return
	}
	h.audit(r, "content."+strings.ToLower(status), "content", chi.URLParam(r, "id"), nil)
	h.invalidateContentByID(chi.URLParam(r, "id"))
	h.writeAdminContent(w, r)
}

func (h *apiHandler) writeAdminContent(w http.ResponseWriter, r *http.Request) {
	content, err := h.store.GetContentByID(chi.URLParam(r, "id"), true)
	if err != nil {
		WriteError(w, http.StatusNotFound, "CONTENT_NOT_FOUND", "Content was not found.")
		return
	}
	WriteJSON(w, http.StatusOK, content)
}

func (h *apiHandler) adminDeleteContent(w http.ResponseWriter, r *http.Request) {
	slug := h.contentSlug(chi.URLParam(r, "id"))
	if err := h.store.DeleteContent(chi.URLParam(r, "id")); err != nil {
		WriteError(w, http.StatusNotFound, "CONTENT_NOT_FOUND", "Content was not found.")
		return
	}
	h.audit(r, "content.deleted", "content", chi.URLParam(r, "id"), nil)
	h.statsCache.Purge()
	h.overviewCache.Purge()
	if slug == "" {
		h.contentCache.Purge()
	} else {
		h.contentCache.Remove(slug)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *apiHandler) contentSlug(id string) string {
	content, err := h.store.GetContentByID(id, true)
	if err != nil {
		return ""
	}
	return content.Slug
}

func (h *apiHandler) invalidateContentByID(id string) {
	h.statsCache.Purge()
	h.overviewCache.Purge()
	slug := h.contentSlug(id)
	if slug == "" {
		h.contentCache.Purge()
		return
	}
	h.contentCache.Remove(slug)
}

func (h *apiHandler) adminListComments(w http.ResponseWriter, _ *http.Request) {
	comments, err := h.store.ListAllComments()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "COMMENTS_UNAVAILABLE", "Comments are unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, collection(comments))
}

func (h *apiHandler) adminDeleteComment(w http.ResponseWriter, r *http.Request) {
	h.setCommentDeleted(w, r, true)
}

func (h *apiHandler) adminRestoreComment(w http.ResponseWriter, r *http.Request) {
	h.setCommentDeleted(w, r, false)
}

func (h *apiHandler) setCommentDeleted(w http.ResponseWriter, r *http.Request, deleted bool) {
	var (
		contentID string
		err       error
	)
	if deleted {
		contentID, err = h.store.SoftDeleteComment(chi.URLParam(r, "id"))
	} else {
		contentID, err = h.store.RestoreComment(chi.URLParam(r, "id"))
	}
	if err != nil {
		WriteError(w, http.StatusNotFound, "COMMENT_NOT_FOUND", "Comment was not found.")
		return
	}
	event := "comment.deleted"
	if !deleted {
		event = "comment.restored"
	}
	h.audit(r, event, "comment", chi.URLParam(r, "id"), nil)
	h.invalidateContentByID(contentID)
	w.WriteHeader(http.StatusNoContent)
}

func (h *apiHandler) adminStats(w http.ResponseWriter, _ *http.Request) {
	stats, ok := h.statsCache.Get()
	if !ok {
		var err error
		stats, err = h.store.Stats()
		if err != nil {
			WriteError(w, http.StatusInternalServerError, "STATS_UNAVAILABLE", "Stats are unavailable.")
			return
		}
		h.statsCache.Set(stats)
	}
	WriteJSON(w, http.StatusOK, map[string]any{"content": stats})
}

func (h *apiHandler) adminOverview(w http.ResponseWriter, _ *http.Request) {
	overview, ok := h.overviewCache.Get()
	if !ok {
		var err error
		overview, err = h.store.Overview()
		if err != nil {
			WriteError(w, http.StatusInternalServerError, "OVERVIEW_UNAVAILABLE", "Overview is unavailable.")
			return
		}
		h.overviewCache.Set(overview)
	}
	WriteJSON(w, http.StatusOK, overview)
}

func (h *apiHandler) adminAnalyticsViews(w http.ResponseWriter, r *http.Request) {
	days := 0
	if rawDays := strings.TrimSpace(r.URL.Query().Get("days")); rawDays != "" {
		value, err := strconv.Atoi(rawDays)
		if err != nil || value < 1 {
			WriteError(w, http.StatusBadRequest, "INVALID_QUERY", "days must be a positive integer")
			return
		}
		days = value
	}
	views, err := h.store.AnalyticsViews(days)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "ANALYTICS_UNAVAILABLE", "Analytics are unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, views)
}

func (h *apiHandler) adminSystem(w http.ResponseWriter, _ *http.Request) {
	sizeBytes, err := h.store.DatabaseSizeBytes()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "SYSTEM_UNAVAILABLE", "System status is unavailable.")
		return
	}
	auditEventCount, err := h.store.AuditEventCount()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "SYSTEM_UNAVAILABLE", "System status is unavailable.")
		return
	}
	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)
	resources, rssBytes := systemResources(h.cfg.DatabasePath)
	WriteJSON(w, http.StatusOK, model.SystemStatus{
		Version:         coreVersion,
		StartedAt:       processStartedAt.Format(time.RFC3339),
		UptimeSeconds:   int64(time.Since(processStartedAt).Seconds()),
		Database:        model.SystemDatabase{SizeBytes: sizeBytes},
		Caches:          model.SystemCaches{ContentEntries: h.contentCache.Len()},
		Runtime:         model.SystemRuntime{HeapAllocBytes: memStats.HeapAlloc, NumGoroutine: runtime.NumGoroutine(), SysRSSBytes: rssBytes},
		Resources:       resources,
		Host:            systemHost(),
		AuditEventCount: auditEventCount,
	})
}

// systemResources samples host metrics via gopsutil. Individual metric failures
// degrade to zero values: resource sampling is observational data and must not
// fail the health query the way store reads do. cpu.Percent(0, ...) takes a
// non-blocking delta sample, so the first call in a process reports 0.
func systemResources(databasePath string) (model.SystemResources, uint64) {
	resources := model.SystemResources{}
	if percents, err := cpu.Percent(0, false); err == nil && len(percents) > 0 {
		resources.CPUPercent = percents[0]
	}
	if counts, err := cpu.Counts(true); err == nil {
		resources.CPUCores = counts
	}
	if vm, err := mem.VirtualMemory(); err == nil {
		resources.MemTotalBytes = vm.Total
		resources.MemUsedBytes = vm.Used
		resources.MemUsedPercent = vm.UsedPercent
	}
	if avg, err := load.Avg(); err == nil {
		resources.LoadAvg1 = avg.Load1
		resources.LoadAvg5 = avg.Load5
		resources.LoadAvg15 = avg.Load15
	}
	if usage, err := disk.Usage(filepath.Dir(databasePath)); err == nil {
		resources.DiskTotalBytes = usage.Total
		resources.DiskUsedBytes = usage.Used
		resources.DiskUsedPercent = usage.UsedPercent
	}
	var rssBytes uint64
	if proc, err := process.NewProcess(int32(os.Getpid())); err == nil {
		if info, err := proc.MemoryInfo(); err == nil {
			rssBytes = info.RSS
		}
	}
	return resources, rssBytes
}

func systemHost() model.SystemHost {
	status := model.SystemHost{}
	if info, err := host.Info(); err == nil {
		status.Hostname = info.Hostname
		status.OS = info.OS
		status.Platform = info.Platform
		status.KernelArch = info.KernelArch
	}
	return status
}

func (h *apiHandler) adminAudit(w http.ResponseWriter, r *http.Request) {
	page := 1
	if rawPage := strings.TrimSpace(r.URL.Query().Get("page")); rawPage != "" {
		value, err := strconv.Atoi(rawPage)
		if err != nil || value < 1 {
			WriteError(w, http.StatusBadRequest, "INVALID_QUERY", "page must be a positive integer")
			return
		}
		page = value
	}
	pageSize := 10
	if rawPageSize := strings.TrimSpace(r.URL.Query().Get("pageSize")); rawPageSize != "" {
		value, err := strconv.Atoi(rawPageSize)
		if err != nil || value < 1 || value > 50 {
			WriteError(w, http.StatusBadRequest, "INVALID_QUERY", "pageSize must be between 1 and 50")
			return
		}
		pageSize = value
	}
	needle := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(needle) > 200 {
		WriteError(w, http.StatusBadRequest, "INVALID_QUERY", "q is too long")
		return
	}
	events, total, err := h.store.ListAuditEvents(page, pageSize, needle)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "AUDIT_UNAVAILABLE", "Audit events are unavailable.")
		return
	}
	totalPages := (total + pageSize - 1) / pageSize
	if totalPages < 1 {
		totalPages = 1
	}
	if page > totalPages {
		page = totalPages
	}
	WriteJSON(w, http.StatusOK, model.AuditEventList{Events: events, Pagination: model.PagePagination{Page: page, PageSize: pageSize, TotalItems: total, TotalPages: totalPages}})
}

func collection[T any](items []T) map[string]any {
	if items == nil {
		items = []T{}
	}
	return map[string]any{"data": items, "pagination": map[string]any{"nextCursor": nil, "hasMore": false}}
}

func collectionWithCursor[T any](items []T, offset, limit int, hasMore bool) map[string]any {
	if items == nil {
		items = []T{}
	}
	var nextCursor *string
	if hasMore {
		value := base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(offset + len(items))))
		nextCursor = &value
	}
	return map[string]any{"data": items, "pagination": map[string]any{"nextCursor": nextCursor, "hasMore": hasMore}}
}

func parseContentListOptions(r *http.Request, includeDrafts bool) (store.ContentListOptions, error) {
	query := r.URL.Query()
	options := store.ContentListOptions{Limit: 20}
	if rawLimit := strings.TrimSpace(query.Get("limit")); rawLimit != "" {
		limit, err := strconv.Atoi(rawLimit)
		if err != nil || limit < 1 {
			return options, fmt.Errorf("limit must be a positive integer")
		}
		if limit > 50 {
			limit = 50
		}
		options.Limit = limit
	}
	cursorProvided := false
	if rawCursor := strings.TrimSpace(query.Get("cursor")); rawCursor != "" {
		cursorProvided = true
		decoded, err := base64.RawURLEncoding.DecodeString(rawCursor)
		if err != nil {
			return options, fmt.Errorf("cursor is invalid")
		}
		offset, err := strconv.Atoi(string(decoded))
		if err != nil || offset < 0 {
			return options, fmt.Errorf("cursor is invalid")
		}
		options.Offset = offset
	}
	if rawPage := strings.TrimSpace(query.Get("page")); rawPage != "" {
		page, err := strconv.Atoi(rawPage)
		if err != nil || page < 1 {
			return options, fmt.Errorf("page must be a positive integer")
		}
		if cursorProvided {
			return options, fmt.Errorf("page and cursor cannot be combined")
		}
		options.Page = page
	}
	if rawSort := strings.TrimSpace(query.Get("sort")); rawSort != "" {
		switch rawSort {
		case "newest", "oldest", "updated":
			options.Sort = rawSort
		default:
			return options, fmt.Errorf("sort is invalid")
		}
	}
	if rawAiAssisted := strings.TrimSpace(query.Get("aiAssisted")); rawAiAssisted != "" {
		value, err := strconv.ParseBool(rawAiAssisted)
		if err != nil {
			return options, fmt.Errorf("aiAssisted must be a boolean")
		}
		options.AiAssisted = &value
	}
	if rawSkipFirst := strings.TrimSpace(query.Get("skipFirst")); rawSkipFirst != "" {
		value, err := strconv.ParseBool(rawSkipFirst)
		if err != nil {
			return options, fmt.Errorf("skipFirst must be a boolean")
		}
		if options.Page == 0 {
			return options, fmt.Errorf("skipFirst requires page")
		}
		options.SkipFirst = value
	}
	for _, rawValue := range query["kind"] {
		for _, rawKind := range strings.Split(rawValue, ",") {
			rawKind = strings.TrimSpace(rawKind)
			if rawKind == "" {
				continue
			}
			kind := model.ContentKind(rawKind)
			switch kind {
			case model.ContentKindArticle, model.ContentKindThought:
				options.Kinds = append(options.Kinds, kind)
			default:
				return options, fmt.Errorf("kind is invalid")
			}
		}
	}
	tags, err := parseTagFilters(query["tag"])
	if err != nil {
		return options, err
	}
	options.Tags = tags
	if options.Query = strings.TrimSpace(query.Get("q")); len(options.Query) > 200 {
		return options, fmt.Errorf("q is too long")
	}
	if rawStatus := strings.TrimSpace(query.Get("status")); rawStatus != "" {
		if !includeDrafts || (rawStatus != "DRAFT" && rawStatus != "PUBLISHED" && rawStatus != "DELETED") {
			return options, fmt.Errorf("status is invalid")
		}
		options.Status = rawStatus
	}
	return options, nil
}

func parseThoughtArchiveOptions(r *http.Request) (page, limit int, tags []string, search string, err error) {
	page, limit = 1, 8
	if rawPage := strings.TrimSpace(r.URL.Query().Get("page")); rawPage != "" {
		value, parseErr := strconv.Atoi(rawPage)
		if parseErr != nil || value < 1 {
			return page, limit, tags, search, fmt.Errorf("page must be a positive integer")
		}
		page = value
	}
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		value, parseErr := strconv.Atoi(rawLimit)
		if parseErr != nil || value < 1 || value > 50 {
			return page, limit, tags, search, fmt.Errorf("limit must be between 1 and 50")
		}
		limit = value
	}
	tags, err = parseTagFilters(r.URL.Query()["tag"])
	if err != nil {
		return page, limit, tags, search, err
	}
	search = strings.TrimSpace(r.URL.Query().Get("q"))
	if len(search) > 200 {
		return page, limit, tags, search, fmt.Errorf("q is too long")
	}
	return page, limit, tags, search, nil
}

func parseCommentListOptions(r *http.Request) (store.CommentListOptions, error) {
	query := r.URL.Query()
	options := store.CommentListOptions{Page: 1, PageSize: 10}
	if rawPage := strings.TrimSpace(query.Get("page")); rawPage != "" {
		value, err := strconv.Atoi(rawPage)
		if err != nil || value < 1 {
			return options, fmt.Errorf("page must be a positive integer")
		}
		options.Page = value
	}
	if rawLimit := strings.TrimSpace(query.Get("limit")); rawLimit != "" {
		value, err := strconv.Atoi(rawLimit)
		if err != nil || value < 1 || value > 50 {
			return options, fmt.Errorf("limit must be between 1 and 50")
		}
		options.PageSize = value
	}
	if options.Query = strings.TrimSpace(query.Get("q")); len(options.Query) > 200 {
		return options, fmt.Errorf("q is too long")
	}
	return options, nil
}

func parseTagFilters(rawValues []string) ([]string, error) {
	tags := make([]string, 0, len(rawValues))
	seen := make(map[string]struct{}, len(rawValues))
	for _, rawValue := range rawValues {
		for _, rawTag := range strings.Split(rawValue, ",") {
			tag := strings.TrimSpace(rawTag)
			if tag == "" {
				continue
			}
			if len(tag) > 80 {
				return nil, fmt.Errorf("tag is too long")
			}
			if _, exists := seen[tag]; exists {
				continue
			}
			seen[tag] = struct{}{}
			tags = append(tags, tag)
			if len(tags) > 10 {
				return nil, fmt.Errorf("too many tags")
			}
		}
	}
	if len(tags) == 0 {
		return nil, nil
	}
	return tags, nil
}

func (h *apiHandler) audit(r *http.Request, eventName, resourceType, resourceID string, metadata map[string]string) {
	actor := "anonymous"
	if claims := auth.ClaimsFromContext(r.Context()); claims != nil && claims.Subject != "" {
		actor = claims.Subject
	}
	requestID := r.Header.Get("X-Request-ID")
	if !h.auditEvents.Publish(events.AuditEvent{EventName: eventName, ResourceType: resourceType, ResourceID: resourceID, Actor: actor, RequestID: requestID, TraceID: r.Header.Get("X-Trace-ID"), Metadata: metadata}) {
		slog.Warn("audit_event_dropped", "eventName", eventName, "resourceType", resourceType, "resourceId", resourceID, "requestId", requestID, "traceId", r.Header.Get("X-Trace-ID"))
	}
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

func newRequestID() string {
	return newCorrelationID("req")
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
