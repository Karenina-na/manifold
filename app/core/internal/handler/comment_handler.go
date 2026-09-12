package handler

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/manifold-space/manifold/app/core/internal/apierror"
	"github.com/manifold-space/manifold/app/core/internal/application"
	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

type commentInput struct {
	AuthorName string  `json:"authorName" validate:"max=80"`
	AuthorURL  *string `json:"authorUrl" validate:"omitempty,max=200"`
	Body       string  `json:"body" validate:"required,max=4000"`
	ReplyToID  *string `json:"replyToId"`
	AvatarSeed string  `json:"avatarSeed" validate:"max=64"`
}

func (h *apiHandler) resolvePublicContent(w http.ResponseWriter, r *http.Request) (model.Content, bool) {
	content, err := h.store.GetContentBySlug(r.Context(), chi.URLParam(r, "slug"), false)
	if errors.Is(err, store.ErrContentNotFound) || errors.Is(err, sql.ErrNoRows) {
		WriteError(w, http.StatusNotFound, apierror.ContentNotFound, "Content was not found.")
		return model.Content{}, false
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.ContentUnavailable, "Content is unavailable.")
		return model.Content{}, false
	}
	return content, true
}

func (h *apiHandler) listPublicComments(w http.ResponseWriter, r *http.Request) {
	content, ok := h.resolvePublicContent(w, r)
	if !ok {
		return
	}
	options, err := parseCommentListOptions(r)
	if err != nil {
		WriteError(w, http.StatusBadRequest, apierror.InvalidQuery, err.Error())
		return
	}
	result, err := h.store.ListComments(r.Context(), content.ID, options)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.CommentsUnavailable, "Comments are unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, collection(result.Comments, model.Pagination{Page: result.Page, PageSize: result.PageSize, TotalItems: result.TotalItems, TotalPages: result.TotalPages}))
}

func (h *apiHandler) createComment(w http.ResponseWriter, r *http.Request) {
	config, err := h.store.GetSiteConfig(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.SiteUnavailable, "Site configuration is unavailable.")
		return
	}
	if !config.CommentsEnabled {
		WriteError(w, http.StatusForbidden, apierror.CommentDisabled, "Comments are disabled for this site.")
		return
	}
	content, ok := h.resolvePublicContent(w, r)
	if !ok {
		return
	}
	h.createCommentOnContent(w, r, content, true)
}

// createCommentOnContent shares the comment-write path between the public
// endpoint (withVisitor resolves the Bearer visitor session) and the admin
// endpoint (false: admin tokens are admin JWTs, not visitor sessions).
func (h *apiHandler) createCommentOnContent(w http.ResponseWriter, r *http.Request, content model.Content, withVisitor bool) {
	var input commentInput
	if err := decodeJSON(w, r, &input); err != nil || h.validate.Struct(input) != nil {
		if !errors.Is(err, errBodyTooLarge) {
			WriteError(w, http.StatusUnprocessableEntity, apierror.ValidationError, "Comment body is required.")
		}
		return
	}
	authorName := strings.TrimSpace(input.AuthorName)
	if authorName == "" {
		authorName = "Anonymous"
	}
	authorProvider := "visitor"
	authorAvatarURL := ""
	avatarSeed := strings.TrimSpace(input.AvatarSeed)
	if withVisitor {
		visitor, err := h.visitorIdentity(r)
		if err != nil {
			WriteError(w, http.StatusUnauthorized, apierror.InvalidVisitorSession, "The signed-in session is no longer valid.")
			return
		}
		if visitor != nil {
			// A provider-backed session is authoritative: the account name and
			// avatar replace whatever the client sent, so identity cannot be
			// spoofed by editing the form.
			authorName = visitor.DisplayName
			authorProvider = visitor.Provider
			authorAvatarURL = visitor.AvatarURL
			avatarSeed = ""
		}
	}
	var authorURL *string
	if input.AuthorURL != nil {
		trimmed := strings.TrimSpace(*input.AuthorURL)
		if trimmed != "" {
			authorURL = &trimmed
		}
	}
	var replyToID *string
	if input.ReplyToID != nil && strings.TrimSpace(*input.ReplyToID) != "" {
		replyToID = input.ReplyToID
	}
	comment, err := h.mutations.CreateComment(r.Context(), mutationRequest(r), content, application.CommentInput{
		AuthorName: authorName, AuthorURL: authorURL, Body: strings.TrimSpace(input.Body), ReplyToID: replyToID,
		AvatarSeed: avatarSeed, AuthorProvider: authorProvider, AuthorAvatarURL: authorAvatarURL,
	})
	if errors.Is(err, store.ErrCommentReplyInvalid) {
		WriteError(w, http.StatusUnprocessableEntity, apierror.ReplyTargetInvalid, "The comment you replied to is no longer available.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.CommentCreateFailed, "Comment could not be created.")
		return
	}
	WriteJSON(w, http.StatusCreated, comment)
}

func parseCommentListOptions(r *http.Request) (store.CommentListOptions, error) {
	query := r.URL.Query()
	if err := rejectUnknownQuery(query, "page", "pageSize", "q"); err != nil {
		return store.CommentListOptions{}, err
	}
	options := store.CommentListOptions{Page: 1, PageSize: 10}
	if rawPage := strings.TrimSpace(query.Get("page")); rawPage != "" {
		value, err := strconv.Atoi(rawPage)
		if err != nil || value < 1 {
			return options, errInvalid("page must be a positive integer")
		}
		options.Page = value
	}
	if rawPageSize := strings.TrimSpace(query.Get("pageSize")); rawPageSize != "" {
		value, err := strconv.Atoi(rawPageSize)
		if err != nil || value < 1 || value > 100 {
			return options, errInvalid("pageSize must be between 1 and 100")
		}
		options.PageSize = value
	}
	if options.Query = strings.TrimSpace(query.Get("q")); len(options.Query) > 200 {
		return options, errInvalid("q is too long")
	}
	return options, nil
}

type validationError string

func (e validationError) Error() string { return string(e) }

func errInvalid(message string) error { return validationError(message) }
