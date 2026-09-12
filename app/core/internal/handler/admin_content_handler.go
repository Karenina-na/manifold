package handler

import (
	"database/sql"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/manifold-space/manifold/app/core/internal/apierror"
	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

func (h *apiHandler) adminListContent(w http.ResponseWriter, r *http.Request) {
	options, err := parseContentListOptions(r, true)
	if err != nil {
		WriteError(w, http.StatusBadRequest, apierror.InvalidQuery, err.Error())
		return
	}
	result, err := h.store.ListContent(true, options)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.ContentUnavailable, "Content is unavailable.")
		return
	}
	items := make([]model.AdminContent, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, model.ToAdminContent(item))
	}
	WriteJSON(w, http.StatusOK, collection(items, model.Pagination{Page: result.Page, PageSize: result.PageSize, TotalItems: result.TotalItems, TotalPages: result.TotalPages}))
}

func (h *apiHandler) adminGetContent(w http.ResponseWriter, r *http.Request) {
	h.writeAdminContent(w, r)
}

func (h *apiHandler) writeAdminContent(w http.ResponseWriter, r *http.Request) {
	content, err := h.store.GetContentByID(chi.URLParam(r, "id"), true)
	if err != nil {
		WriteError(w, http.StatusNotFound, apierror.ContentNotFound, "Content was not found.")
		return
	}
	WriteJSON(w, http.StatusOK, model.ToAdminContent(content))
}

// resolveAdminContent loads the target row for admin mutations (all statuses
// except DELETED, which only restore can touch).
func (h *apiHandler) resolveAdminContent(w http.ResponseWriter, r *http.Request) (model.Content, bool) {
	content, err := h.store.GetContentByID(chi.URLParam(r, "id"), true)
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

func (h *apiHandler) adminCreateContent(w http.ResponseWriter, r *http.Request) {
	input, err := h.decodeContentInput(w, r)
	if err != nil {
		if !errors.Is(err, errBodyTooLarge) {
			WriteError(w, http.StatusUnprocessableEntity, apierror.ValidationError, err.Error())
		}
		return
	}
	if err := validateContentSemantics(input.Kind, input.Title, input.Slug); err != nil {
		WriteError(w, http.StatusUnprocessableEntity, apierror.ValidationError, err.Error())
		return
	}
	if err := validateMetadataInput(input.Kind, input.EditorialMetadata); err != nil {
		WriteError(w, http.StatusUnprocessableEntity, apierror.ValidationError, err.Error())
		return
	}
	created, err := h.mutations.CreateContent(mutationRequest(r), input)
	if errors.Is(err, store.ErrSlugTaken) {
		WriteError(w, http.StatusConflict, apierror.SlugTaken, "Another piece already uses this slug.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.ContentCreateFailed, "Content could not be created.")
		return
	}
	WriteJSON(w, http.StatusCreated, model.ToAdminContent(created))
}

func (h *apiHandler) adminUpdateContent(w http.ResponseWriter, r *http.Request) {
	input, err := h.decodeContentUpdateInput(w, r)
	if err != nil {
		if !errors.Is(err, errBodyTooLarge) {
			WriteError(w, http.StatusUnprocessableEntity, apierror.ValidationError, "Invalid content input.")
		}
		return
	}
	current, ok := h.resolveAdminContent(w, r)
	if !ok {
		return
	}
	if err := validateContentSemantics(*input.Kind, input.Title, *input.Slug); err != nil {
		WriteError(w, http.StatusUnprocessableEntity, apierror.ValidationError, err.Error())
		return
	}
	updated, err := h.mutations.UpdateContent(mutationRequest(r), current, input)
	if errors.Is(err, store.ErrContentNotFound) {
		WriteError(w, http.StatusNotFound, apierror.ContentNotFound, "Content was not found.")
		return
	}
	if errors.Is(err, store.ErrSlugTaken) {
		WriteError(w, http.StatusConflict, apierror.SlugTaken, "Another piece already uses this slug.")
		return
	}
	if errors.Is(err, store.ErrVersionConflict) {
		WriteError(w, http.StatusConflict, apierror.VersionConflict, "Content was updated elsewhere.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.ContentUpdateFailed, "Content could not be updated.")
		return
	}
	WriteJSON(w, http.StatusOK, model.ToAdminContent(updated))
}

func (h *apiHandler) adminPublishContent(w http.ResponseWriter, r *http.Request) {
	h.setContentStatus(w, r, model.StatusPublished)
}

func (h *apiHandler) adminUnpublishContent(w http.ResponseWriter, r *http.Request) {
	h.setContentStatus(w, r, model.StatusDraft)
}

func (h *apiHandler) setContentStatus(w http.ResponseWriter, r *http.Request, status model.ContentStatus) {
	current, ok := h.resolveAdminContent(w, r)
	if !ok {
		return
	}
	updated, err := h.mutations.SetContentStatus(mutationRequest(r), current, status)
	if err != nil {
		WriteError(w, http.StatusNotFound, apierror.ContentNotFound, "Content was not found.")
		return
	}
	WriteJSON(w, http.StatusOK, model.ToAdminContent(updated))
}

func (h *apiHandler) adminDeleteContent(w http.ResponseWriter, r *http.Request) {
	current, ok := h.resolveAdminContent(w, r)
	if !ok {
		return
	}
	if err := h.mutations.DeleteContent(mutationRequest(r), current); err != nil {
		WriteError(w, http.StatusNotFound, apierror.ContentNotFound, "Content was not found.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *apiHandler) adminRestoreContent(w http.ResponseWriter, r *http.Request) {
	restored, err := h.mutations.RestoreContent(mutationRequest(r), chi.URLParam(r, "id"))
	if errors.Is(err, store.ErrContentNotFound) {
		WriteError(w, http.StatusNotFound, apierror.ContentNotFound, "Content was not found.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.ContentRestoreFailed, "Content could not be restored.")
		return
	}
	WriteJSON(w, http.StatusOK, model.ToAdminContent(restored))
}
