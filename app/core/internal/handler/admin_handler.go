package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/manifold-space/manifold/app/core/internal/apierror"
	"github.com/manifold-space/manifold/app/core/internal/model"
)

func (h *apiHandler) profile(w http.ResponseWriter, _ *http.Request) {
	profile, err := h.store.GetProfile()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.ProfileUnavailable, "Profile is unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, profile)
}

// SiteCompositionResponse is the typed public site payload: the persisted
// settings plus the pinned content for each kind in pin order.
type SiteCompositionResponse struct {
	model.SiteConfig
	PinnedThoughts []model.PublicContent `json:"pinnedThoughts"`
	PinnedWritings []model.PublicContent `json:"pinnedWritings"`
}

func (h *apiHandler) site(w http.ResponseWriter, _ *http.Request) {
	config, err := h.store.GetSiteConfig()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.SiteUnavailable, "Site configuration is unavailable.")
		return
	}
	response := SiteCompositionResponse{SiteConfig: config, PinnedThoughts: []model.PublicContent{}, PinnedWritings: []model.PublicContent{}}
	if pinned, err := h.store.PinnedContent(model.ContentKindThought); err == nil {
		for _, item := range pinned {
			response.PinnedThoughts = append(response.PinnedThoughts, model.ToPublicContent(item))
		}
	}
	if pinned, err := h.store.PinnedContent(model.ContentKindArticle); err == nil {
		for _, item := range pinned {
			response.PinnedWritings = append(response.PinnedWritings, model.ToPublicContent(item))
		}
	}
	WriteJSON(w, http.StatusOK, response)
}

func (h *apiHandler) adminProfile(w http.ResponseWriter, _ *http.Request) {
	h.profile(w, nil)
}

func (h *apiHandler) adminUpdateProfile(w http.ResponseWriter, r *http.Request) {
	var input struct {
		DisplayName  *string                        `json:"displayName"`
		Handle       *string                        `json:"handle"`
		Headline     *string                        `json:"headline"`
		Bio          *string                        `json:"bio"`
		AvatarURL    *string                        `json:"avatarUrl"`
		Location     *string                        `json:"location"`
		Organization *string                        `json:"organization"`
		WebsiteURL   *string                        `json:"websiteUrl"`
		ResumeURL    json.RawMessage                `json:"resumeUrl"`
		Interests    *[]string                      `json:"interests"`
		Education    *[]model.ProfileEducationItem  `json:"education"`
		Experience   *[]model.ProfileExperienceItem `json:"experience"`
		Series       *[]model.ProfileSeriesItem     `json:"series"`
		Contacts     *[]model.ProfileContact        `json:"contacts"`
	}
	if err := decodeJSON(w, r, &input); err != nil || input.DisplayName == nil || strings.TrimSpace(*input.DisplayName) == "" || input.Handle == nil || input.Headline == nil || input.Bio == nil || input.AvatarURL == nil || input.Location == nil || input.Organization == nil || input.WebsiteURL == nil || len(input.ResumeURL) == 0 || input.Interests == nil || input.Education == nil || input.Experience == nil || input.Series == nil || input.Contacts == nil {
		if !errors.Is(err, errBodyTooLarge) {
			WriteError(w, http.StatusUnprocessableEntity, apierror.ValidationError, "Display name is required.")
		}
		return
	}
	var resumeURL *string
	if string(input.ResumeURL) != "null" {
		var value string
		if err := json.Unmarshal(input.ResumeURL, &value); err != nil {
			WriteError(w, http.StatusUnprocessableEntity, apierror.ValidationError, "resumeUrl must be a string or null.")
			return
		}
		resumeURL = &value
	}
	profile := model.Profile{ID: "profile_1", DisplayName: *input.DisplayName, Handle: *input.Handle, Headline: *input.Headline, Bio: *input.Bio, AvatarURL: *input.AvatarURL, Location: *input.Location, Organization: *input.Organization, WebsiteURL: *input.WebsiteURL, ResumeURL: resumeURL, Interests: *input.Interests, Education: *input.Education, Experience: *input.Experience, Series: *input.Series, Contacts: *input.Contacts}
	if err := h.mutations.UpdateProfile(mutationRequest(r), profile); err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.ProfileUpdateFailed, "Profile could not be updated.")
		return
	}
	h.profile(w, r)
}
