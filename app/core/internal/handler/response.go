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
	"strconv"
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
		AllowedHeaders: []string{"Accept", "Authorization", "Content-Type", "Idempotency-Key", "X-Visitor-ID"},
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
		api.Get("/content/{slug}/reactions", h.getReactions)
		api.Put("/content/{slug}/reactions/{kind}", h.putReaction)
		api.Delete("/content/{slug}/reactions/{kind}", h.deleteReaction)
		api.Get("/projects", h.projects)
		api.Get("/now", h.now)
		api.Post("/admin/session", h.login)
		api.Route("/admin", func(admin chi.Router) {
			admin.Use(h.auth.RequireAdmin)
			admin.Get("/profile", h.adminProfile)
			admin.Patch("/profile", h.adminUpdateProfile)
			admin.Get("/site", h.adminSite)
			admin.Patch("/site", h.adminUpdateSite)
			admin.Get("/projects", h.adminProjects)
			admin.Post("/projects", h.adminCreateProject)
			admin.Patch("/projects/{id}", h.adminUpdateProject)
			admin.Delete("/projects/{id}", h.adminDeleteProject)
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
	config, err := h.store.GetSiteConfig()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "SITE_UNAVAILABLE", "Site configuration is unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{
		"profile":          map[string]string{"id": "profile_1"},
		"featuredContent":  config.FeaturedContent,
		"featuredProjects": config.FeaturedProjects,
		"navigation":       config.Navigation,
		"sections":         config.Sections,
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

func (h *apiHandler) listContent(w http.ResponseWriter, r *http.Request) {
	options, err := parseContentListOptions(r, false)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_QUERY", err.Error())
		return
	}
	items, hasMore, err := h.store.ListContent(false, options)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CONTENT_UNAVAILABLE", "Content is unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, collectionWithCursor(items, options.Offset, options.Limit, hasMore))
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

func (h *apiHandler) getReactions(w http.ResponseWriter, r *http.Request) {
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
	summary, err := h.store.GetReactionSummary(content.ID, visitorID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "REACTIONS_UNAVAILABLE", "Reactions are unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, summary)
}

func (h *apiHandler) putReaction(w http.ResponseWriter, r *http.Request) {
	h.mutateReaction(w, r, true)
}

func (h *apiHandler) deleteReaction(w http.ResponseWriter, r *http.Request) {
	h.mutateReaction(w, r, false)
}

func (h *apiHandler) mutateReaction(w http.ResponseWriter, r *http.Request, enabled bool) {
	content, err := h.store.GetContent(chi.URLParam(r, "slug"), false)
	if errors.Is(err, sql.ErrNoRows) {
		WriteError(w, http.StatusNotFound, "CONTENT_NOT_FOUND", "Content was not found.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CONTENT_UNAVAILABLE", "Content is unavailable.")
		return
	}
	kind := strings.ToUpper(strings.TrimSpace(chi.URLParam(r, "kind")))
	if kind != "LIKE" && kind != "FAVORITE" {
		WriteError(w, http.StatusBadRequest, "REACTION_KIND_INVALID", "Reaction kind must be LIKE or FAVORITE.")
		return
	}
	visitorID, err := visitorID(r, true)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VISITOR_ID_INVALID", "Visitor ID is required and invalid.")
		return
	}
	if enabled {
		err = h.store.SetReaction(content.ID, visitorID, kind)
	} else {
		err = h.store.DeleteReaction(content.ID, visitorID, kind)
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "REACTION_UPDATE_FAILED", "Reaction could not be updated.")
		return
	}
	action := "removed"
	if enabled {
		action = "added"
	}
	h.audit(r, "reaction."+strings.ToLower(kind)+"."+action, "content", content.ID, nil)
	summary, err := h.store.GetReactionSummary(content.ID, visitorID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "REACTIONS_UNAVAILABLE", "Reactions are unavailable.")
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
	items, hasMore, err := h.store.ListContent(true, options)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CONTENT_UNAVAILABLE", "Content is unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, collectionWithCursor(items, options.Offset, options.Limit, hasMore))
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

func (h *apiHandler) adminProjects(w http.ResponseWriter, _ *http.Request) {
	items, err := h.store.ListProjects()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "PROJECTS_UNAVAILABLE", "Projects are unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, collection(items))
}

type projectInput struct {
	Slug          string   `json:"slug" validate:"required,max=160"`
	Name          string   `json:"name" validate:"required,max=160"`
	Summary       string   `json:"summary" validate:"max=4000"`
	Description   string   `json:"description" validate:"max=10000"`
	Status        string   `json:"status" validate:"required,oneof=ACTIVE PAUSED ARCHIVED"`
	Featured      bool     `json:"featured"`
	HomepageURL   string   `json:"homepageUrl" validate:"omitempty,url,max=500"`
	RepositoryURL string   `json:"repositoryUrl" validate:"omitempty,url,max=500"`
	TechStack     []string `json:"techStack" validate:"max=20,dive,max=80"`
	StartedAt     string   `json:"startedAt" validate:"max=40"`
}

func projectFromInput(input projectInput) model.Project {
	return model.Project{Slug: input.Slug, Name: input.Name, Summary: input.Summary, Description: input.Description, Status: input.Status, Featured: input.Featured, HomepageURL: input.HomepageURL, RepositoryURL: input.RepositoryURL, TechStack: input.TechStack, StartedAt: input.StartedAt}
}

func (h *apiHandler) adminCreateProject(w http.ResponseWriter, r *http.Request) {
	var input projectInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || h.validate.Struct(input) != nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "Project fields are invalid.")
		return
	}
	created, err := h.store.CreateProject(projectFromInput(input))
	if err != nil {
		WriteError(w, http.StatusConflict, "PROJECT_CREATE_FAILED", "Project could not be created.")
		return
	}
	h.audit(r, "project.created", "project", created.ID, nil)
	WriteJSON(w, http.StatusCreated, created)
}

type projectPatchInput struct {
	Name          *string   `json:"name" validate:"omitempty,max=160"`
	Summary       *string   `json:"summary" validate:"omitempty,max=4000"`
	Description   *string   `json:"description" validate:"omitempty,max=10000"`
	Status        *string   `json:"status" validate:"omitempty,oneof=ACTIVE PAUSED ARCHIVED"`
	Featured      *bool     `json:"featured"`
	HomepageURL   *string   `json:"homepageUrl" validate:"omitempty,url,max=500"`
	RepositoryURL *string   `json:"repositoryUrl" validate:"omitempty,url,max=500"`
	TechStack     *[]string `json:"techStack" validate:"omitempty,max=20,dive,max=80"`
	StartedAt     *string   `json:"startedAt" validate:"omitempty,max=40"`
}

func (h *apiHandler) adminUpdateProject(w http.ResponseWriter, r *http.Request) {
	var input projectPatchInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || h.validate.Struct(input) != nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "Project fields are invalid.")
		return
	}
	if input.Name == nil && input.Summary == nil && input.Description == nil && input.Status == nil && input.Featured == nil && input.HomepageURL == nil && input.RepositoryURL == nil && input.TechStack == nil && input.StartedAt == nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "At least one project field is required.")
		return
	}
	err := h.store.UpdateProject(chi.URLParam(r, "id"), store.ProjectUpdate{Name: input.Name, Summary: input.Summary, Description: input.Description, Status: input.Status, Featured: input.Featured, HomepageURL: input.HomepageURL, RepositoryURL: input.RepositoryURL, TechStack: input.TechStack, StartedAt: input.StartedAt})
	if errors.Is(err, store.ErrProjectNotFound) {
		WriteError(w, http.StatusNotFound, "PROJECT_NOT_FOUND", "Project was not found.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "PROJECT_UPDATE_FAILED", "Project could not be updated.")
		return
	}
	h.audit(r, "project.updated", "project", chi.URLParam(r, "id"), nil)
	h.writeAdminProject(w, r)
}

func (h *apiHandler) writeAdminProject(w http.ResponseWriter, r *http.Request) {
	project, err := h.store.GetProjectByID(chi.URLParam(r, "id"))
	if err != nil {
		WriteError(w, http.StatusNotFound, "PROJECT_NOT_FOUND", "Project was not found.")
		return
	}
	WriteJSON(w, http.StatusOK, project)
}

func (h *apiHandler) adminDeleteProject(w http.ResponseWriter, r *http.Request) {
	err := h.store.DeleteProject(chi.URLParam(r, "id"))
	if errors.Is(err, store.ErrProjectNotFound) {
		WriteError(w, http.StatusNotFound, "PROJECT_NOT_FOUND", "Project was not found.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "PROJECT_DELETE_FAILED", "Project could not be deleted.")
		return
	}
	h.audit(r, "project.deleted", "project", chi.URLParam(r, "id"), nil)
	w.WriteHeader(http.StatusNoContent)
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

type contentPatchInput struct {
	Title           *string   `json:"title" validate:"omitempty,max=200"`
	Summary         *string   `json:"summary" validate:"omitempty,max=4000"`
	Body            *string   `json:"body" validate:"omitempty,max=100000"`
	Tags            *[]string `json:"tags"`
	ExpectedVersion *int      `json:"expectedVersion" validate:"required,min=1"`
}

func (h *apiHandler) adminUpdateContent(w http.ResponseWriter, r *http.Request) {
	var input contentPatchInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil || h.validate.Struct(input) != nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "Invalid content input.")
		return
	}
	if input.Title == nil && input.Summary == nil && input.Body == nil && input.Tags == nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "At least one content field is required.")
		return
	}
	err := h.store.UpdateContent(chi.URLParam(r, "id"), store.ContentUpdate{Title: input.Title, Summary: input.Summary, Body: input.Body, Tags: input.Tags, ExpectedVersion: *input.ExpectedVersion})
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
	if rawCursor := strings.TrimSpace(query.Get("cursor")); rawCursor != "" {
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
	for _, rawValue := range query["kind"] {
		for _, rawKind := range strings.Split(rawValue, ",") {
			rawKind = strings.TrimSpace(rawKind)
			if rawKind == "" {
				continue
			}
			kind := model.ContentKind(rawKind)
			switch kind {
			case model.ContentKindPost, model.ContentKindNote, model.ContentKindResearch:
				options.Kinds = append(options.Kinds, kind)
			default:
				return options, fmt.Errorf("kind is invalid")
			}
		}
	}
	if options.Tag = strings.TrimSpace(query.Get("tag")); len(options.Tag) > 80 {
		return options, fmt.Errorf("tag is too long")
	}
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
		recorder := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(recorder, r)
		slog.Info("http_request", "requestId", requestID, "method", r.Method, "path", r.URL.Path, "status", recorder.status, "durationMs", time.Since(started).Milliseconds())
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
	value := make([]byte, 8)
	if _, err := rand.Read(value); err != nil {
		return fmt.Sprintf("req_%d", time.Now().UnixNano())
	}
	return "req_" + fmt.Sprintf("%x", value)
}
