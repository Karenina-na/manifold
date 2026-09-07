package handler

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/manifold-space/manifold/app/core/internal/chain"
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
	content, err := h.store.GetContentBySlug(chi.URLParam(r, "slug"), false)
	if errors.Is(err, store.ErrContentNotFound) || errors.Is(err, sql.ErrNoRows) {
		WriteError(w, http.StatusNotFound, "CONTENT_NOT_FOUND", "Content was not found.")
		return model.Content{}, false
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CONTENT_UNAVAILABLE", "Content is unavailable.")
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
		WriteError(w, http.StatusBadRequest, "INVALID_QUERY", err.Error())
		return
	}
	result, err := h.store.ListComments(content.ID, options)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "COMMENTS_UNAVAILABLE", "Comments are unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, collection(result.Comments, model.Pagination{Page: result.Page, PageSize: result.PageSize, TotalItems: result.TotalItems, TotalPages: result.TotalPages}))
}

func (h *apiHandler) createComment(w http.ResponseWriter, r *http.Request) {
	config, err := h.store.GetSiteConfig()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "SITE_UNAVAILABLE", "Site configuration is unavailable.")
		return
	}
	if !config.CommentsEnabled {
		WriteError(w, http.StatusForbidden, "COMMENT_DISABLED", "Comments are disabled for this site.")
		return
	}
	content, ok := h.resolvePublicContent(w, r)
	if !ok {
		return
	}
	h.createCommentOnContent(w, r, content)
}

func (h *apiHandler) createCommentOnContent(w http.ResponseWriter, r *http.Request, content model.Content) {
	var input commentInput
	if err := decodeJSON(r, &input); err != nil || h.validate.Struct(input) != nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "Comment body is required.")
		return
	}
	authorName := strings.TrimSpace(input.AuthorName)
	if authorName == "" {
		authorName = "Anonymous"
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
	comment, err := h.store.CreateComment(content.ID, authorName, authorURL, strings.TrimSpace(input.Body), replyToID, strings.TrimSpace(input.AvatarSeed))
	if errors.Is(err, store.ErrCommentReplyInvalid) {
		WriteError(w, http.StatusUnprocessableEntity, "REPLY_TARGET_INVALID", "The comment you replied to is no longer available.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "COMMENT_CREATE_FAILED", "Comment could not be created.")
		return
	}
	h.audit(r, "comment.created", "comment", comment.ID, map[string]string{"contentId": content.ID})
	if payload, label, subjectRef, metadata, payloadErr := CommentPayload(comment, "created"); payloadErr == nil {
		h.anchorBusinessChange(r, chain.SourceComment, payload, label, subjectRef, metadata)
	}
	h.invalidateContentBySlug(content.Slug)
	h.contentCache.Remove(content.Slug)
	WriteJSON(w, http.StatusCreated, comment)
}

func (h *apiHandler) getLikes(w http.ResponseWriter, r *http.Request) {
	content, ok := h.resolvePublicContent(w, r)
	if !ok {
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
	content, ok := h.resolvePublicContent(w, r)
	if !ok {
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
	if payload, label, subjectRef, metadata, payloadErr := ReactionActionPayload(content.ID, visitorID, action); payloadErr == nil {
		h.anchorBusinessChange(r, chain.SourceReaction, payload, label, subjectRef, metadata)
	}
	h.overviewCache.Purge()
	// The cached detail carries likeCount; drop it so readers never see a
	// stale count for the TTL window.
	h.contentCache.Remove(content.Slug)
	summary, err := h.store.GetLikeSummary(content.ID, visitorID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "LIKES_UNAVAILABLE", "Likes are unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, summary)
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
