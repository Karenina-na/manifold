package handler

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/manifold-space/manifold/app/core/internal/apierror"
	"github.com/manifold-space/manifold/app/core/internal/model"
)

func (h *apiHandler) adminSite(w http.ResponseWriter, r *http.Request) {
	config, err := h.store.GetSiteConfig(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.SiteUnavailable, "Site configuration is unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, config)
}

func (h *apiHandler) adminUpdateSite(w http.ResponseWriter, r *http.Request) {
	var raw struct {
		Title           *string                     `json:"title"`
		Description     *string                     `json:"description"`
		Footer          *string                     `json:"footer"`
		Social          *[]model.SiteNavigationItem `json:"social"`
		CommentsEnabled *bool                       `json:"commentsEnabled"`
		Navigation      *[]model.SiteNavigationItem `json:"navigation"`
		Sections        *[]string                   `json:"sections"`
	}
	if err := decodeJSON(w, r, &raw); err != nil || raw.Title == nil || raw.Description == nil || raw.Footer == nil || raw.Social == nil || raw.CommentsEnabled == nil || raw.Navigation == nil || raw.Sections == nil {
		if !errors.Is(err, errBodyTooLarge) {
			WriteError(w, http.StatusUnprocessableEntity, apierror.ValidationError, "Title, navigation, and sections are required.")
		}
		return
	}
	input := model.SiteConfig{Title: *raw.Title, Description: *raw.Description, Footer: *raw.Footer, Social: *raw.Social, CommentsEnabled: *raw.CommentsEnabled, Navigation: *raw.Navigation, Sections: *raw.Sections}
	if h.validate.Struct(input) != nil {
		WriteError(w, http.StatusUnprocessableEntity, apierror.ValidationError, "Title, navigation, and sections are required.")
		return
	}
	if err := h.mutations.UpdateSite(r.Context(), mutationRequest(r), input); err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.SiteUpdateFailed, "Site configuration could not be updated.")
		return
	}
	h.adminSite(w, r)
}

func (h *apiHandler) adminThoughtConfig(w http.ResponseWriter, r *http.Request) {
	config, err := h.store.GetThoughtConfig(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.ThoughtConfigUnavailable, "Thought configuration is unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, config)
}

func (h *apiHandler) adminUpdateThoughtConfig(w http.ResponseWriter, r *http.Request) {
	var input struct {
		PinnedIds *[]string `json:"pinnedIds"`
	}
	if err := decodeJSON(w, r, &input); err != nil || input.PinnedIds == nil {
		if !errors.Is(err, errBodyTooLarge) {
			WriteError(w, http.StatusUnprocessableEntity, apierror.ValidationError, "pinnedIds is required.")
		}
		return
	}
	if err := h.validatePinnedIds(r.Context(), *input.PinnedIds, model.ContentKindThought); err != nil {
		WriteError(w, http.StatusUnprocessableEntity, apierror.ValidationError, err.Error())
		return
	}
	if err := h.mutations.SetPinnedIDs(r.Context(), mutationRequest(r), model.ContentKindThought, *input.PinnedIds); err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.ThoughtConfigUpdateFailed, "Thought configuration could not be updated.")
		return
	}
	h.adminThoughtConfig(w, r)
}

func (h *apiHandler) adminWritingConfig(w http.ResponseWriter, r *http.Request) {
	config, err := h.store.GetWritingConfig(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.WritingConfigUnavailable, "Writing configuration is unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, config)
}

func (h *apiHandler) adminUpdateWritingConfig(w http.ResponseWriter, r *http.Request) {
	var input struct {
		PinnedIds *[]string `json:"pinnedIds"`
	}
	if err := decodeJSON(w, r, &input); err != nil || input.PinnedIds == nil {
		if !errors.Is(err, errBodyTooLarge) {
			WriteError(w, http.StatusUnprocessableEntity, apierror.ValidationError, "pinnedIds is required.")
		}
		return
	}
	if err := h.validatePinnedIds(r.Context(), *input.PinnedIds, model.ContentKindArticle); err != nil {
		WriteError(w, http.StatusUnprocessableEntity, apierror.ValidationError, err.Error())
		return
	}
	if err := h.mutations.SetPinnedIDs(r.Context(), mutationRequest(r), model.ContentKindArticle, *input.PinnedIds); err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.WritingConfigUpdateFailed, "Writing configuration could not be updated.")
		return
	}
	h.adminWritingConfig(w, r)
}

// validatePinnedIds enforces the admin pin contract: every id must reference
// currently-published content of the expected kind, with no duplicates.
// The pins table is a whole-set replacement, so the empty slice clears pins.
func (h *apiHandler) validatePinnedIds(ctx context.Context, ids []string, kind model.ContentKind) error {
	label := "Thought"
	if kind == model.ContentKindArticle {
		label = "Writing"
	}
	seen := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			return errors.New("pinnedIds must contain content IDs, not empty strings")
		}
		if len(id) > 160 {
			return errors.New("pinnedIds entries are too long")
		}
		if _, exists := seen[id]; exists {
			return errors.New("pinnedIds contains duplicates")
		}
		seen[id] = struct{}{}
		content, err := h.store.GetContentByID(ctx, id, false)
		if err != nil || content.Kind != kind {
			return errors.New("Featured " + label + " must reference published " + strings.ToLower(label) + " content.")
		}
	}
	return nil
}
