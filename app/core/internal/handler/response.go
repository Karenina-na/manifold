package handler

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/go-playground/validator/v10"

	"github.com/manifold-space/manifold/app/core/internal/auth"
	"github.com/manifold-space/manifold/app/core/internal/config"
	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

type apiHandler struct {
	cfg      config.Config
	store    *store.Store
	auth     *auth.Service
	validate *validator.Validate
}

func Router(cfg config.Config, database *store.Store) http.Handler {
	authService, err := auth.New(cfg)
	if err != nil {
		panic(err)
	}
	h := &apiHandler{cfg: cfg, store: database, auth: authService, validate: validator.New()}
	router := chi.NewRouter()
	router.Use(requestIDMiddleware)
	router.Use(cors.Handler(cors.Options{
		AllowedOrigins: cfg.AllowedOrigins,
		AllowedMethods: []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions},
		AllowedHeaders: []string{"Accept", "Authorization", "Content-Type", "Idempotency-Key"},
	}))
	router.Get("/healthz", Health)
	router.Route("/api/v1", func(api chi.Router) {
		api.Get("/profile", h.profile)
		api.Get("/site", h.site)
		api.Get("/feed", h.feed)
		api.Get("/stats", h.stats)
		api.Get("/content", h.listContent)
		api.Get("/content/{slug}", h.getContent)
		api.Get("/content/{slug}/comments", h.listPublicComments)
		api.Post("/content/{slug}/comments", h.createComment)
		api.Get("/projects", h.projects)
		api.Get("/now", h.now)
		api.Post("/admin/session", h.login)
		api.Route("/admin", func(admin chi.Router) {
			admin.Use(h.auth.RequireAdmin)
			admin.Get("/content", h.adminListContent)
			admin.Post("/content", h.adminCreateContent)
			admin.Patch("/content/{id}", h.adminUpdateContent)
			admin.Post("/content/{id}/publish", h.adminPublishContent)
			admin.Post("/content/{id}/unpublish", h.adminUnpublishContent)
			admin.Delete("/content/{id}", h.adminDeleteContent)
			admin.Get("/comments", h.adminListComments)
			admin.Post("/comments/{id}/approve", h.adminApproveComment)
			admin.Post("/comments/{id}/reject", h.adminRejectComment)
			admin.Get("/now", h.now)
			admin.Put("/now", h.adminUpdateNow)
			admin.Get("/stats", h.adminStats)
		})
	})
	return router
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
	WriteJSON(w, status, map[string]any{"error": errorBody})
}

func Health(w http.ResponseWriter, _ *http.Request) {
	WriteJSON(w, http.StatusOK, map[string]string{"status": "ok", "version": "0.1.0"})
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
	WriteJSON(w, http.StatusOK, map[string]any{
		"profile":          map[string]string{"id": "profile_1"},
		"featuredContent":  []map[string]string{{"id": "content_1", "kind": "POST"}},
		"featuredProjects": []map[string]string{{"id": "project_1"}},
		"navigation":       []map[string]string{{"label": "Writing", "href": "/writing"}, {"label": "Projects", "href": "/projects"}},
		"sections":         []string{"PROFILE", "FEED", "PROJECTS", "NOW"},
	})
}

func (h *apiHandler) feed(w http.ResponseWriter, r *http.Request) {
	h.listContent(w, r)
}

func (h *apiHandler) stats(w http.ResponseWriter, _ *http.Request) {
	stats, err := h.store.Stats()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "STATS_UNAVAILABLE", "Stats are unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, stats)
}

func (h *apiHandler) listContent(w http.ResponseWriter, _ *http.Request) {
	items, err := h.store.ListContent(false)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CONTENT_UNAVAILABLE", "Content is unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, collection(items))
}

func (h *apiHandler) getContent(w http.ResponseWriter, r *http.Request) {
	content, err := h.store.GetContent(chi.URLParam(r, "slug"), false)
	if errors.Is(err, sql.ErrNoRows) {
		WriteError(w, http.StatusNotFound, "CONTENT_NOT_FOUND", "Content was not found.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CONTENT_UNAVAILABLE", "Content is unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, content)
}

func (h *apiHandler) projects(w http.ResponseWriter, _ *http.Request) {
	items, err := h.store.ListProjects()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "PROJECTS_UNAVAILABLE", "Projects are unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, collection(items))
}

func (h *apiHandler) now(w http.ResponseWriter, _ *http.Request) {
	status, err := h.store.GetNow()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "NOW_UNAVAILABLE", "Now status is unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, status)
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
	comments, err := h.store.ListComments(content.ID, "APPROVED")
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "COMMENTS_UNAVAILABLE", "Comments are unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, collection(comments))
}

type commentInput struct {
	AuthorName string  `json:"authorName" validate:"required,max=80"`
	AuthorURL  string  `json:"authorUrl"`
	Body       string  `json:"body" validate:"required,max=4000"`
	ReplyToID  *string `json:"replyToId"`
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
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "Author name and comment body are required.")
		return
	}
	comment, err := h.store.CreateComment(content.ID, strings.TrimSpace(input.AuthorName), strings.TrimSpace(input.AuthorURL), strings.TrimSpace(input.Body), input.ReplyToID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "COMMENT_CREATE_FAILED", "Comment could not be created.")
		return
	}
	h.audit(r, "comment.created", "comment", comment.ID, map[string]string{"contentId": content.ID})
	WriteJSON(w, http.StatusCreated, comment)
}

func (h *apiHandler) adminListContent(w http.ResponseWriter, _ *http.Request) {
	items, err := h.store.ListContent(true)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CONTENT_UNAVAILABLE", "Content is unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, collection(items))
}

type contentInput struct {
	Kind    model.ContentKind `json:"kind" validate:"required,oneof=POST NOTE RESEARCH"`
	Slug    string            `json:"slug" validate:"required,max=160"`
	Title   string            `json:"title" validate:"required,max=200"`
	Summary string            `json:"summary" validate:"max=4000"`
	Body    string            `json:"body" validate:"required,max=100000"`
	Tags    []string          `json:"tags"`
}

func (h *apiHandler) adminCreateContent(w http.ResponseWriter, r *http.Request) {
	var input contentInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || h.validate.Struct(input) != nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "Kind, slug, title, and body are required.")
		return
	}
	created, err := h.store.CreateContent(model.Content{Kind: input.Kind, Slug: input.Slug, Title: input.Title, Summary: input.Summary, Body: input.Body, Tags: input.Tags})
	if err != nil {
		WriteError(w, http.StatusConflict, "CONTENT_CREATE_FAILED", "Content could not be created.")
		return
	}
	h.audit(r, "content.created", "content", created.ID, map[string]string{"kind": string(created.Kind)})
	WriteJSON(w, http.StatusCreated, created)
}

func (h *apiHandler) adminUpdateContent(w http.ResponseWriter, r *http.Request) {
	var input contentInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || h.validate.Struct(input) != nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "Invalid content input.")
		return
	}
	if err := h.store.UpdateContent(chi.URLParam(r, "id"), model.Content{Title: input.Title, Summary: input.Summary, Body: input.Body, Tags: input.Tags}); err != nil {
		WriteError(w, http.StatusInternalServerError, "CONTENT_UPDATE_FAILED", "Content could not be updated.")
		return
	}
	h.audit(r, "content.updated", "content", chi.URLParam(r, "id"), nil)
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
	if err := h.store.DeleteContent(chi.URLParam(r, "id")); err != nil {
		WriteError(w, http.StatusNotFound, "CONTENT_NOT_FOUND", "Content was not found.")
		return
	}
	h.audit(r, "content.deleted", "content", chi.URLParam(r, "id"), nil)
	w.WriteHeader(http.StatusNoContent)
}

func (h *apiHandler) adminListComments(w http.ResponseWriter, r *http.Request) {
	comments, err := h.store.ListAllComments(r.URL.Query().Get("status"))
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "COMMENTS_UNAVAILABLE", "Comments are unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, collection(comments))
}

func (h *apiHandler) adminApproveComment(w http.ResponseWriter, r *http.Request) {
	h.setCommentStatus(w, r, "APPROVED")
}

func (h *apiHandler) adminRejectComment(w http.ResponseWriter, r *http.Request) {
	h.setCommentStatus(w, r, "REJECTED")
}

func (h *apiHandler) setCommentStatus(w http.ResponseWriter, r *http.Request, status string) {
	if err := h.store.SetCommentStatus(chi.URLParam(r, "id"), status); err != nil {
		WriteError(w, http.StatusNotFound, "COMMENT_NOT_FOUND", "Comment was not found.")
		return
	}
	h.audit(r, "comment."+strings.ToLower(status), "comment", chi.URLParam(r, "id"), nil)
	w.WriteHeader(http.StatusNoContent)
}

func (h *apiHandler) adminUpdateNow(w http.ResponseWriter, r *http.Request) {
	var input model.NowStatus
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || input.Title == "" {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "Title is required.")
		return
	}
	if err := h.store.UpdateNow(input); err != nil {
		WriteError(w, http.StatusInternalServerError, "NOW_UPDATE_FAILED", "Now status could not be updated.")
		return
	}
	h.audit(r, "now.updated", "now", "now_1", nil)
	h.now(w, r)
}

func (h *apiHandler) adminStats(w http.ResponseWriter, _ *http.Request) {
	stats, err := h.store.Stats()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "STATS_UNAVAILABLE", "Stats are unavailable.")
		return
	}
	pending, err := h.store.PendingCommentCount()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "STATS_UNAVAILABLE", "Stats are unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"content": stats, "pendingComments": pending})
}

func collection[T any](items []T) map[string]any {
	if items == nil {
		items = []T{}
	}
	return map[string]any{"data": items, "pagination": map[string]any{"nextCursor": nil, "hasMore": false}}
}

func (h *apiHandler) audit(r *http.Request, eventName, resourceType, resourceID string, metadata map[string]string) {
	actor := "anonymous"
	if claims := auth.ClaimsFromContext(r.Context()); claims != nil && claims.Subject != "" {
		actor = claims.Subject
	}
	requestID := r.Header.Get("X-Request-ID")
	if err := h.store.RecordAuditEvent(eventName, resourceType, resourceID, actor, requestID, metadata); err != nil {
		slog.Error("audit_event_failed", "eventName", eventName, "resourceType", resourceType, "resourceId", resourceID, "requestId", requestID, "error", err)
	}
}

func requestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := strings.TrimSpace(r.Header.Get("X-Request-ID"))
		if requestID == "" {
			requestID = newRequestID()
		}
		w.Header().Set("X-Request-ID", requestID)
		r = r.WithContext(r.Context())
		started := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		slog.Info("http_request", "requestId", requestID, "method", r.Method, "path", r.URL.Path, "status", recorder.status, "durationMs", time.Since(started).Milliseconds())
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Write(body []byte) (int, error) {
	if r.status == http.StatusOK {
		r.WriteHeader(http.StatusOK)
	}
	return r.ResponseWriter.Write(body)
}

func newRequestID() string {
	value := make([]byte, 8)
	if _, err := rand.Read(value); err != nil {
		return fmt.Sprintf("req_%d", time.Now().UnixNano())
	}
	return "req_" + fmt.Sprintf("%x", value)
}
