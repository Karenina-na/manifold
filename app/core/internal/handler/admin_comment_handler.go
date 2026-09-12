package handler

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/manifold-space/manifold/app/core/internal/apierror"
	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

func (h *apiHandler) adminCreateComment(w http.ResponseWriter, r *http.Request) {
	content, err := h.store.GetContentByID(chi.URLParam(r, "id"), true)
	if errors.Is(err, store.ErrContentNotFound) || errors.Is(err, sql.ErrNoRows) {
		WriteError(w, http.StatusNotFound, apierror.ContentNotFound, "Content was not found.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.ContentUnavailable, "Content is unavailable.")
		return
	}
	// Admin replies bypass the public comments toggle by design and are never
	// attributed to a visitor session (admin tokens are not visitor sessions).
	h.createCommentOnContent(w, r, content, false)
}

func (h *apiHandler) adminListComments(w http.ResponseWriter, r *http.Request) {
	options, err := parseAdminCommentListOptions(r)
	if err != nil {
		WriteError(w, http.StatusBadRequest, apierror.InvalidQuery, err.Error())
		return
	}
	if options.ContentID != "" {
		if _, err := h.store.GetContentByID(options.ContentID, true); errors.Is(err, store.ErrContentNotFound) {
			WriteError(w, http.StatusNotFound, apierror.ContentNotFound, "Content was not found.")
			return
		} else if err != nil {
			WriteError(w, http.StatusInternalServerError, apierror.ContentUnavailable, "Content is unavailable.")
			return
		}
	}
	result, err := h.store.ListAdminComments(options)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.CommentsUnavailable, "Comments are unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, collection(result.Comments, model.Pagination{Page: result.Page, PageSize: result.PageSize, TotalItems: result.TotalItems, TotalPages: result.TotalPages}))
}

func (h *apiHandler) adminDeleteComment(w http.ResponseWriter, r *http.Request) {
	h.setCommentDeleted(w, r, true)
}

func (h *apiHandler) adminRestoreComment(w http.ResponseWriter, r *http.Request) {
	h.setCommentDeleted(w, r, false)
}

func (h *apiHandler) adminHideComment(w http.ResponseWriter, r *http.Request) {
	h.setCommentHidden(w, r, true)
}

func (h *apiHandler) adminUnhideComment(w http.ResponseWriter, r *http.Request) {
	h.setCommentHidden(w, r, false)
}

func (h *apiHandler) setCommentHidden(w http.ResponseWriter, r *http.Request, hidden bool) {
	err := h.mutations.SetCommentHidden(mutationRequest(r), chi.URLParam(r, "id"), hidden)
	if errors.Is(err, sql.ErrNoRows) {
		WriteError(w, http.StatusNotFound, apierror.CommentNotFound, "Comment was not found.")
		return
	}
	if errors.Is(err, store.ErrCommentDeleted) {
		WriteError(w, http.StatusUnprocessableEntity, apierror.CommentDeleted, "Deleted comments cannot be moderated.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.CommentUpdateFailed, "Comment could not be updated.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type updateCommentAuthorInput struct {
	AuthorName json.RawMessage `json:"authorName"`
	AuthorURL  json.RawMessage `json:"authorUrl"`
	AvatarSeed json.RawMessage `json:"avatarSeed"`
}

func (h *apiHandler) adminUpdateCommentAuthor(w http.ResponseWriter, r *http.Request) {
	var input updateCommentAuthorInput
	if err := decodeJSON(r, &input); err != nil {
		WriteError(w, http.StatusUnprocessableEntity, apierror.ValidationError, "Invalid comment author input.")
		return
	}
	update, err := parseCommentAuthorUpdate(input)
	if err != nil {
		WriteError(w, http.StatusUnprocessableEntity, apierror.ValidationError, err.Error())
		return
	}
	err = h.mutations.UpdateCommentAuthor(mutationRequest(r), chi.URLParam(r, "id"), update)
	if errors.Is(err, sql.ErrNoRows) {
		WriteError(w, http.StatusNotFound, apierror.CommentNotFound, "Comment was not found.")
		return
	}
	if errors.Is(err, store.ErrCommentDeleted) {
		WriteError(w, http.StatusUnprocessableEntity, apierror.CommentDeleted, "Deleted comments cannot be edited.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.CommentUpdateFailed, "Comment could not be updated.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func parseCommentAuthorUpdate(input updateCommentAuthorInput) (store.CommentAuthorUpdate, error) {
	update := store.CommentAuthorUpdate{}
	if len(input.AuthorURL) > 0 {
		update.HasAuthorURL = true
		if strings.TrimSpace(string(input.AuthorURL)) != "null" {
			var value string
			if err := json.Unmarshal(input.AuthorURL, &value); err != nil {
				return update, errors.New("authorUrl must be a string or null.")
			}
			value = strings.TrimSpace(value)
			if len(value) > 200 {
				return update, errors.New("authorUrl is too long.")
			}
			if value != "" {
				update.AuthorURL = &value
			}
		}
	}
	if len(input.AuthorName) > 0 {
		if strings.TrimSpace(string(input.AuthorName)) == "null" {
			return update, errors.New("authorName must be a string.")
		}
		var value string
		if err := json.Unmarshal(input.AuthorName, &value); err != nil {
			return update, errors.New("authorName must be a string.")
		}
		value = strings.TrimSpace(value)
		if value == "" {
			value = "Anonymous"
		}
		if len([]rune(value)) > 80 {
			return update, errors.New("authorName is too long.")
		}
		update.AuthorName = &value
	}
	if len(input.AvatarSeed) > 0 {
		if strings.TrimSpace(string(input.AvatarSeed)) == "null" {
			return update, errors.New("avatarSeed must be a string.")
		}
		var value string
		if err := json.Unmarshal(input.AvatarSeed, &value); err != nil {
			return update, errors.New("avatarSeed must be a string.")
		}
		value = strings.TrimSpace(value)
		if len([]rune(value)) > 64 {
			return update, errors.New("avatarSeed is too long.")
		}
		update.AvatarSeed = &value
	}
	return update, nil
}

func (h *apiHandler) setCommentDeleted(w http.ResponseWriter, r *http.Request, deleted bool) {
	err := h.mutations.SetCommentDeleted(mutationRequest(r), chi.URLParam(r, "id"), deleted)
	if err != nil {
		WriteError(w, http.StatusNotFound, apierror.CommentNotFound, "Comment was not found.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func parseAdminCommentListOptions(r *http.Request) (store.AdminCommentListOptions, error) {
	query := r.URL.Query()
	options := store.AdminCommentListOptions{Page: 1, PageSize: 20}
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
	options.ContentID = strings.TrimSpace(query.Get("contentId"))
	options.Query = strings.TrimSpace(query.Get("q"))
	if len(options.Query) > 200 {
		return options, errInvalid("q is too long")
	}
	options.Focus = strings.TrimSpace(query.Get("focus"))
	if len(options.Focus) > 64 {
		return options, errInvalid("focus is too long")
	}
	return options, nil
}
