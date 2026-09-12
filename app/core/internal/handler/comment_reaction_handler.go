package handler

import (
	"github.com/manifold-space/manifold/app/core/internal/apierror"

	"net/http"
)

func (h *apiHandler) getLikes(w http.ResponseWriter, r *http.Request) {
	content, ok := h.resolvePublicContent(w, r)
	if !ok {
		return
	}
	visitorID, err := visitorID(r, false)
	if err != nil {
		WriteError(w, http.StatusBadRequest, apierror.VisitorIDInvalid, "Visitor ID is invalid.")
		return
	}
	summary, err := h.store.GetLikeSummary(content.ID, visitorID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.LikesUnavailable, "Likes are unavailable.")
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
		WriteError(w, http.StatusBadRequest, apierror.VisitorIDInvalid, "Visitor ID is required and invalid.")
		return
	}
	if err := h.mutations.SetLike(mutationRequest(r), content, visitorID, enabled); err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.LikeUpdateFailed, "Like could not be updated.")
		return
	}
	summary, err := h.store.GetLikeSummary(content.ID, visitorID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.LikesUnavailable, "Likes are unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, summary)
}
