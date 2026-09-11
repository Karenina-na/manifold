package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/manifold-space/manifold/app/core/internal/auth"
	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

type loginInput struct {
	Username string `json:"username" validate:"required,max=80"`
	Password string `json:"password" validate:"required,min=8,max=200"`
}

func (h *apiHandler) login(w http.ResponseWriter, r *http.Request) {
	var input loginInput
	if err := decodeJSON(r, &input); err != nil || h.validate.Struct(input) != nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "Username and password are required.")
		return
	}
	token, err := h.auth.Login(input.Username, input.Password)
	if err != nil {
		h.audit(r, "admin.session.failed", "session", input.Username, map[string]string{"ip": clientAddress(r, trustedProxyNetworks(h.cfg.TrustedProxyCIDRs))})
		WriteError(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Username or password is incorrect.")
		return
	}
	if claims, err := h.auth.Parse(token); err == nil {
		h.mutations.RecordAuthChange(mutationRequest(r), input.Username, "login", claims.ID)
	}
	WriteJSON(w, http.StatusOK, map[string]any{"accessToken": token, "tokenType": "Bearer", "expiresIn": auth.SessionTTLSeconds, "user": map[string]string{"username": input.Username, "role": "admin"}})
}

func (h *apiHandler) profile(w http.ResponseWriter, _ *http.Request) {
	profile, err := h.store.GetProfile()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "PROFILE_UNAVAILABLE", "Profile is unavailable.")
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
		WriteError(w, http.StatusInternalServerError, "SITE_UNAVAILABLE", "Site configuration is unavailable.")
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
	if err := decodeJSON(r, &input); err != nil || input.DisplayName == nil || strings.TrimSpace(*input.DisplayName) == "" || input.Handle == nil || input.Headline == nil || input.Bio == nil || input.AvatarURL == nil || input.Location == nil || input.Organization == nil || input.WebsiteURL == nil || len(input.ResumeURL) == 0 || input.Interests == nil || input.Education == nil || input.Experience == nil || input.Series == nil || input.Contacts == nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "Display name is required.")
		return
	}
	var resumeURL *string
	if string(input.ResumeURL) != "null" {
		var value string
		if err := json.Unmarshal(input.ResumeURL, &value); err != nil {
			WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "resumeUrl must be a string or null.")
			return
		}
		resumeURL = &value
	}
	profile := model.Profile{ID: "profile_1", DisplayName: *input.DisplayName, Handle: *input.Handle, Headline: *input.Headline, Bio: *input.Bio, AvatarURL: *input.AvatarURL, Location: *input.Location, Organization: *input.Organization, WebsiteURL: *input.WebsiteURL, ResumeURL: resumeURL, Interests: *input.Interests, Education: *input.Education, Experience: *input.Experience, Series: *input.Series, Contacts: *input.Contacts}
	if err := h.mutations.UpdateProfile(mutationRequest(r), profile); err != nil {
		WriteError(w, http.StatusInternalServerError, "PROFILE_UPDATE_FAILED", "Profile could not be updated.")
		return
	}
	h.profile(w, r)
}

func (h *apiHandler) adminLogoutSession(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.ID == "" {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "A valid session is required.")
		return
	}
	if err := h.store.RevokeSession(claims.ID, time.Now().UTC()); err != nil {
		WriteError(w, http.StatusInternalServerError, "SESSION_REVOKE_FAILED", "Session could not be revoked.")
		return
	}
	h.mutations.RecordAuthChange(mutationRequest(r), claims.Subject, "logout", claims.ID)
	w.WriteHeader(http.StatusNoContent)
}

// adminLogoutSessionByID revokes one specific session of the signed-in admin,
// addressed by id from the Active sessions list. Revoking the current session
// behaves like the plain logout: the caller's token dies immediately.
func (h *apiHandler) adminLogoutSessionByID(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Subject == "" {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "A valid session is required.")
		return
	}
	targetID := chi.URLParam(r, "id")
	target, err := h.store.GetSession(targetID)
	if errors.Is(err, store.ErrSessionNotFound) {
		WriteError(w, http.StatusNotFound, "SESSION_NOT_FOUND", "Session was not found.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "SESSIONS_UNAVAILABLE", "Sessions are unavailable.")
		return
	}
	// Sessions are scoped to the signed-in admin; a foreign session id is
	// indistinguishable from a missing one.
	if target.Subject != claims.Subject {
		WriteError(w, http.StatusNotFound, "SESSION_NOT_FOUND", "Session was not found.")
		return
	}
	if err := h.store.RevokeSession(targetID, time.Now().UTC()); err != nil {
		WriteError(w, http.StatusInternalServerError, "SESSION_REVOKE_FAILED", "Session could not be revoked.")
		return
	}
	h.mutations.RecordAuthChange(mutationRequest(r), claims.Subject, "logout", targetID)
	w.WriteHeader(http.StatusNoContent)
}

func (h *apiHandler) adminLogoutSessions(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Subject == "" {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "A valid session is required.")
		return
	}
	if err := h.store.RevokeSessions(claims.Subject, claims.ID, time.Now().UTC()); err != nil {
		WriteError(w, http.StatusInternalServerError, "SESSION_REVOKE_FAILED", "Sessions could not be revoked.")
		return
	}
	h.mutations.RecordAuthChange(mutationRequest(r), claims.Subject, "logout-all", claims.ID)
	w.WriteHeader(http.StatusNoContent)
}

func (h *apiHandler) adminListSessions(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Subject == "" {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "A valid session is required.")
		return
	}
	rows, err := h.store.AdminSessions(claims.Subject)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "SESSIONS_UNAVAILABLE", "Sessions could not be listed.")
		return
	}
	type sessionView struct {
		ID        string  `json:"id"`
		CreatedAt string  `json:"createdAt"`
		ExpiresAt string  `json:"expiresAt"`
		RevokedAt *string `json:"revokedAt"`
		Active    bool    `json:"active"`
		Current   bool    `json:"current"`
	}
	now := time.Now().UTC()
	views := make([]sessionView, 0, len(rows))
	for _, row := range rows {
		var revokedAt *string
		if row.RevokedAt != nil {
			value := row.RevokedAt.Format(time.RFC3339)
			revokedAt = &value
		}
		views = append(views, sessionView{
			ID:        row.ID,
			CreatedAt: row.CreatedAt.Format(time.RFC3339),
			ExpiresAt: row.ExpiresAt.Format(time.RFC3339),
			RevokedAt: revokedAt,
			Active:    row.RevokedAt == nil && now.Before(row.ExpiresAt),
			Current:   row.ID == claims.ID,
		})
	}
	WriteJSON(w, http.StatusOK, map[string]any{"sessions": views})
}

type changePasswordInput struct {
	CurrentPassword string `json:"currentPassword" validate:"required,min=1,max=200"`
	NewPassword     string `json:"newPassword" validate:"required,min=8,max=200"`
}

func (h *apiHandler) adminChangePassword(w http.ResponseWriter, r *http.Request) {
	var input changePasswordInput
	if err := decodeJSON(r, &input); err != nil || h.validate.Struct(input) != nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "currentPassword and newPassword are required; newPassword must be at least 8 characters.")
		return
	}
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "A valid session is required.")
		return
	}
	if err := h.auth.UpdateCredential(claims.Subject, input.CurrentPassword, input.NewPassword, claims.ID); err != nil {
		if errors.Is(err, auth.ErrInvalidCredentials) {
			WriteError(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Current password is incorrect.")
			return
		}
		WriteError(w, http.StatusInternalServerError, "PASSWORD_CHANGE_FAILED", "Password could not be updated.")
		return
	}
	h.mutations.RecordAuthChange(mutationRequest(r), claims.Subject, "password-changed", claims.ID)
	w.WriteHeader(http.StatusNoContent)
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
	var raw struct {
		Title           *string                     `json:"title"`
		Description     *string                     `json:"description"`
		Footer          *string                     `json:"footer"`
		Social          *[]model.SiteNavigationItem `json:"social"`
		CommentsEnabled *bool                       `json:"commentsEnabled"`
		Navigation      *[]model.SiteNavigationItem `json:"navigation"`
		Sections        *[]string                   `json:"sections"`
	}
	if err := decodeJSON(r, &raw); err != nil || raw.Title == nil || raw.Description == nil || raw.Footer == nil || raw.Social == nil || raw.CommentsEnabled == nil || raw.Navigation == nil || raw.Sections == nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "Title, navigation, and sections are required.")
		return
	}
	input := model.SiteConfig{Title: *raw.Title, Description: *raw.Description, Footer: *raw.Footer, Social: *raw.Social, CommentsEnabled: *raw.CommentsEnabled, Navigation: *raw.Navigation, Sections: *raw.Sections}
	if h.validate.Struct(input) != nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "Title, navigation, and sections are required.")
		return
	}
	if err := h.mutations.UpdateSite(mutationRequest(r), input); err != nil {
		WriteError(w, http.StatusInternalServerError, "SITE_UPDATE_FAILED", "Site configuration could not be updated.")
		return
	}
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
		PinnedIds *[]string `json:"pinnedIds"`
	}
	if err := decodeJSON(r, &input); err != nil || input.PinnedIds == nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "pinnedIds is required.")
		return
	}
	if err := h.validatePinnedIds(*input.PinnedIds, model.ContentKindThought); err != nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", err.Error())
		return
	}
	if err := h.mutations.SetPinnedIDs(mutationRequest(r), model.ContentKindThought, *input.PinnedIds); err != nil {
		WriteError(w, http.StatusInternalServerError, "THOUGHT_CONFIG_UPDATE_FAILED", "Thought configuration could not be updated.")
		return
	}
	h.adminThoughtConfig(w, r)
}

func (h *apiHandler) adminWritingConfig(w http.ResponseWriter, _ *http.Request) {
	config, err := h.store.GetWritingConfig()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "WRITING_CONFIG_UNAVAILABLE", "Writing configuration is unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, config)
}

func (h *apiHandler) adminUpdateWritingConfig(w http.ResponseWriter, r *http.Request) {
	var input struct {
		PinnedIds *[]string `json:"pinnedIds"`
	}
	if err := decodeJSON(r, &input); err != nil || input.PinnedIds == nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "pinnedIds is required.")
		return
	}
	if err := h.validatePinnedIds(*input.PinnedIds, model.ContentKindArticle); err != nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", err.Error())
		return
	}
	if err := h.mutations.SetPinnedIDs(mutationRequest(r), model.ContentKindArticle, *input.PinnedIds); err != nil {
		WriteError(w, http.StatusInternalServerError, "WRITING_CONFIG_UPDATE_FAILED", "Writing configuration could not be updated.")
		return
	}
	h.adminWritingConfig(w, r)
}

// validatePinnedIds enforces the admin pin contract: every id must reference
// currently-published content of the expected kind, with no duplicates.
// The pins table is a whole-set replacement, so the empty slice clears pins.
func (h *apiHandler) validatePinnedIds(ids []string, kind model.ContentKind) error {
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
		content, err := h.store.GetContentByID(id, false)
		if err != nil || content.Kind != kind {
			return errors.New("Featured " + label + " must reference published " + strings.ToLower(label) + " content.")
		}
	}
	return nil
}
