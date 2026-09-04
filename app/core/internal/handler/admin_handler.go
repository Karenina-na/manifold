package handler

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"runtime"
	"strconv"
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
	h.audit(r, "admin.session.created", "session", input.Username, nil)
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
// settings plus the featured content for each kind.
type SiteCompositionResponse struct {
	model.SiteConfig
	FeaturedThought *model.PublicContent `json:"featuredThought"`
	FeaturedWriting *model.PublicContent `json:"featuredWriting"`
}

func (h *apiHandler) site(w http.ResponseWriter, _ *http.Request) {
	config, err := h.store.GetSiteConfig()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "SITE_UNAVAILABLE", "Site configuration is unavailable.")
		return
	}
	response := SiteCompositionResponse{SiteConfig: config, FeaturedThought: nil, FeaturedWriting: nil}
	if featured, err := h.store.FeaturedContent(model.ContentKindThought); err == nil && featured != nil {
		public := model.ToPublicContent(*featured)
		response.FeaturedThought = &public
	}
	if featured, err := h.store.FeaturedContent(model.ContentKindArticle); err == nil && featured != nil {
		public := model.ToPublicContent(*featured)
		response.FeaturedWriting = &public
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
	if err := h.store.UpdateProfile(profile); err != nil {
		WriteError(w, http.StatusInternalServerError, "PROFILE_UPDATE_FAILED", "Profile could not be updated.")
		return
	}
	h.audit(r, "profile.updated", "profile", "profile_1", nil)
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
	h.audit(r, "admin.session.revoked", "session", claims.ID, nil)
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
	h.audit(r, "admin.sessions.revoked_all", "session", claims.Subject, nil)
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
	h.audit(r, "admin.password.changed", "password", claims.Subject, nil)
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
	if err := h.store.UpdateSiteConfig(input); err != nil {
		WriteError(w, http.StatusInternalServerError, "SITE_UPDATE_FAILED", "Site configuration could not be updated.")
		return
	}
	h.audit(r, "site.updated", "site", "site_1", nil)
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
		FeaturedThoughtID json.RawMessage `json:"featuredThoughtId"`
	}
	if err := decodeJSON(r, &input); err != nil || len(input.FeaturedThoughtID) == 0 {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "featuredThoughtId is required and may be null.")
		return
	}
	featuredThoughtID, err := h.decodePinnedContentID(input.FeaturedThoughtID, model.ContentKindThought)
	if err != nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", err.Error())
		return
	}
	if err := h.store.UpdateThoughtConfig(featuredThoughtID); err != nil {
		WriteError(w, http.StatusInternalServerError, "THOUGHT_CONFIG_UPDATE_FAILED", "Thought configuration could not be updated.")
		return
	}
	h.audit(r, "thoughts.config.updated", "thoughts_config", "thoughts_1", nil)
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
		FeaturedWritingID json.RawMessage `json:"featuredWritingId"`
	}
	if err := decodeJSON(r, &input); err != nil || len(input.FeaturedWritingID) == 0 {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "featuredWritingId is required and may be null.")
		return
	}
	featuredWritingID, err := h.decodePinnedContentID(input.FeaturedWritingID, model.ContentKindArticle)
	if err != nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", err.Error())
		return
	}
	if err := h.store.UpdateWritingConfig(featuredWritingID); err != nil {
		WriteError(w, http.StatusInternalServerError, "WRITING_CONFIG_UPDATE_FAILED", "Writing configuration could not be updated.")
		return
	}
	h.audit(r, "writings.config.updated", "writings_config", "writings_1", nil)
	h.adminWritingConfig(w, r)
}

// decodePinnedContentID validates a pin reference: null clears the pin and a
// non-empty value must point at published content of the expected kind.
func (h *apiHandler) decodePinnedContentID(raw json.RawMessage, kind model.ContentKind) (*string, error) {
	if string(raw) == "null" {
		return nil, nil
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil || strings.TrimSpace(value) == "" || len(value) > 160 {
		return nil, errors.New("featured id must be a content ID or null")
	}
	value = strings.TrimSpace(value)
	content, err := h.store.GetContentByID(value, false)
	if err != nil || content.Kind != kind {
		label := "Thought"
		if kind == model.ContentKindArticle {
			label = "Writing"
		}
		return nil, errors.New("Featured " + label + " must reference published " + strings.ToLower(label) + " content.")
	}
	return &value, nil
}

func (h *apiHandler) adminListContent(w http.ResponseWriter, r *http.Request) {
	options, err := parseContentListOptions(r, true)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_QUERY", err.Error())
		return
	}
	result, err := h.store.ListContent(true, options)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CONTENT_UNAVAILABLE", "Content is unavailable.")
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
		WriteError(w, http.StatusNotFound, "CONTENT_NOT_FOUND", "Content was not found.")
		return
	}
	WriteJSON(w, http.StatusOK, model.ToAdminContent(content))
}

// resolveAdminContent loads the target row for admin mutations (all statuses
// except DELETED, which only restore can touch).
func (h *apiHandler) resolveAdminContent(w http.ResponseWriter, r *http.Request) (model.Content, bool) {
	content, err := h.store.GetContentByID(chi.URLParam(r, "id"), true)
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

func (h *apiHandler) adminCreateContent(w http.ResponseWriter, r *http.Request) {
	input, err := h.decodeContentInput(r)
	if err != nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", err.Error())
		return
	}
	if err := validateContentSemantics(input.Kind, input.Title, input.Slug); err != nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", err.Error())
		return
	}
	if err := validateMetadataInput(input.Kind, input.EditorialMetadata); err != nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", err.Error())
		return
	}
	created, err := h.store.CreateContent(input)
	if errors.Is(err, store.ErrSlugTaken) {
		WriteError(w, http.StatusConflict, "SLUG_TAKEN", "Another piece already uses this slug.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CONTENT_CREATE_FAILED", "Content could not be created.")
		return
	}
	h.audit(r, "content.created", "content", created.ID, map[string]string{"kind": string(created.Kind)})
	h.statsCache.Purge()
	h.overviewCache.Purge()
	WriteJSON(w, http.StatusCreated, model.ToAdminContent(created))
}

func (h *apiHandler) adminUpdateContent(w http.ResponseWriter, r *http.Request) {
	input, err := h.decodeContentUpdateInput(r)
	if err != nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "Invalid content input.")
		return
	}
	current, ok := h.resolveAdminContent(w, r)
	if !ok {
		return
	}
	if err := validateContentSemantics(*input.Kind, input.Title, *input.Slug); err != nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", err.Error())
		return
	}
	err = h.store.UpdateContent(current.ID, input)
	if errors.Is(err, store.ErrContentNotFound) {
		WriteError(w, http.StatusNotFound, "CONTENT_NOT_FOUND", "Content was not found.")
		return
	}
	if errors.Is(err, store.ErrSlugTaken) {
		WriteError(w, http.StatusConflict, "SLUG_TAKEN", "Another piece already uses this slug.")
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
	h.audit(r, "content.updated", "content", current.ID, nil)
	h.invalidateContentBySlug(current.Slug)
	if input.Slug != nil && *input.Slug != current.Slug {
		h.contentCache.Remove(current.Slug)
	}
	h.writeAdminContent(w, r)
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
	if err := h.store.SetContentStatus(current.ID, status); err != nil {
		WriteError(w, http.StatusNotFound, "CONTENT_NOT_FOUND", "Content was not found.")
		return
	}
	h.audit(r, "content."+strings.ToLower(string(status)), "content", current.ID, nil)
	h.invalidateContentBySlug(current.Slug)
	h.contentCache.Remove(current.Slug)
	h.writeAdminContent(w, r)
}

func (h *apiHandler) adminDeleteContent(w http.ResponseWriter, r *http.Request) {
	current, ok := h.resolveAdminContent(w, r)
	if !ok {
		return
	}
	if err := h.store.DeleteContent(current.ID); err != nil {
		WriteError(w, http.StatusNotFound, "CONTENT_NOT_FOUND", "Content was not found.")
		return
	}
	h.audit(r, "content.deleted", "content", current.ID, nil)
	h.statsCache.Purge()
	h.overviewCache.Purge()
	h.contentCache.Remove(current.Slug)
	w.WriteHeader(http.StatusNoContent)
}

func (h *apiHandler) adminRestoreContent(w http.ResponseWriter, r *http.Request) {
	restored, err := h.store.RestoreContent(chi.URLParam(r, "id"))
	if errors.Is(err, store.ErrContentNotFound) {
		WriteError(w, http.StatusNotFound, "CONTENT_NOT_FOUND", "Content was not found.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CONTENT_RESTORE_FAILED", "Content could not be restored.")
		return
	}
	h.audit(r, "content.restored", "content", restored.ID, nil)
	h.statsCache.Purge()
	h.overviewCache.Purge()
	h.contentCache.Remove(restored.Slug)
	WriteJSON(w, http.StatusOK, model.ToAdminContent(restored))
}

func (h *apiHandler) adminCreateComment(w http.ResponseWriter, r *http.Request) {
	content, err := h.store.GetContentByID(chi.URLParam(r, "id"), true)
	if errors.Is(err, store.ErrContentNotFound) || errors.Is(err, sql.ErrNoRows) {
		WriteError(w, http.StatusNotFound, "CONTENT_NOT_FOUND", "Content was not found.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CONTENT_UNAVAILABLE", "Content is unavailable.")
		return
	}
	// Admin replies bypass the public comments toggle by design.
	h.createCommentOnContent(w, r, content)
}

func (h *apiHandler) adminListComments(w http.ResponseWriter, r *http.Request) {
	options, err := parseAdminCommentListOptions(r)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_QUERY", err.Error())
		return
	}
	if options.ContentID != "" {
		if _, err := h.store.GetContentByID(options.ContentID, true); errors.Is(err, store.ErrContentNotFound) {
			WriteError(w, http.StatusNotFound, "CONTENT_NOT_FOUND", "Content was not found.")
			return
		} else if err != nil {
			WriteError(w, http.StatusInternalServerError, "CONTENT_UNAVAILABLE", "Content is unavailable.")
			return
		}
	}
	result, err := h.store.ListAdminComments(options)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "COMMENTS_UNAVAILABLE", "Comments are unavailable.")
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
	var (
		contentID string
		err       error
	)
	if hidden {
		contentID, err = h.store.HideComment(chi.URLParam(r, "id"))
	} else {
		contentID, err = h.store.UnhideComment(chi.URLParam(r, "id"))
	}
	if errors.Is(err, sql.ErrNoRows) {
		WriteError(w, http.StatusNotFound, "COMMENT_NOT_FOUND", "Comment was not found.")
		return
	}
	if errors.Is(err, store.ErrCommentDeleted) {
		WriteError(w, http.StatusUnprocessableEntity, "COMMENT_DELETED", "Deleted comments cannot be moderated.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "COMMENT_UPDATE_FAILED", "Comment could not be updated.")
		return
	}
	event := "comment.hidden"
	if !hidden {
		event = "comment.unhidden"
	}
	h.audit(r, event, "comment", chi.URLParam(r, "id"), nil)
	h.invalidateCommentContent(contentID)
	h.overviewCache.Purge()
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
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "Invalid comment author input.")
		return
	}
	update, err := parseCommentAuthorUpdate(input)
	if err != nil {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", err.Error())
		return
	}
	contentID, err := h.store.UpdateCommentAuthor(chi.URLParam(r, "id"), update)
	if errors.Is(err, sql.ErrNoRows) {
		WriteError(w, http.StatusNotFound, "COMMENT_NOT_FOUND", "Comment was not found.")
		return
	}
	if errors.Is(err, store.ErrCommentDeleted) {
		WriteError(w, http.StatusUnprocessableEntity, "COMMENT_DELETED", "Deleted comments cannot be edited.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "COMMENT_UPDATE_FAILED", "Comment could not be updated.")
		return
	}
	h.audit(r, "comment.updated", "comment", chi.URLParam(r, "id"), nil)
	h.invalidateCommentContent(contentID)
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
	var (
		contentID string
		err       error
	)
	if deleted {
		contentID, err = h.store.SoftDeleteComment(chi.URLParam(r, "id"))
	} else {
		contentID, err = h.store.RestoreComment(chi.URLParam(r, "id"))
	}
	if err != nil {
		WriteError(w, http.StatusNotFound, "COMMENT_NOT_FOUND", "Comment was not found.")
		return
	}
	event := "comment.deleted"
	if !deleted {
		event = "comment.restored"
	}
	h.audit(r, event, "comment", chi.URLParam(r, "id"), nil)
	h.invalidateCommentContent(contentID)
	h.overviewCache.Purge()
	w.WriteHeader(http.StatusNoContent)
}

func (h *apiHandler) invalidateCommentContent(contentID string) {
	if content, err := h.store.GetContentByID(contentID, true); err == nil {
		h.invalidateContentBySlug(content.Slug)
		h.contentCache.Remove(content.Slug)
	}
}

func (h *apiHandler) adminStats(w http.ResponseWriter, _ *http.Request) {
	stats, ok := h.statsCache.Get()
	if !ok {
		var err error
		stats, err = h.store.Stats()
		if err != nil {
			WriteError(w, http.StatusInternalServerError, "STATS_UNAVAILABLE", "Stats are unavailable.")
			return
		}
		h.statsCache.Set(stats)
	}
	WriteJSON(w, http.StatusOK, struct {
		Content model.Stats `json:"content"`
	}{Content: stats})
}

func (h *apiHandler) adminOverview(w http.ResponseWriter, _ *http.Request) {
	overview, ok := h.overviewCache.Get()
	if !ok {
		var err error
		overview, err = h.store.Overview()
		if err != nil {
			WriteError(w, http.StatusInternalServerError, "OVERVIEW_UNAVAILABLE", "Overview is unavailable.")
			return
		}
		h.overviewCache.Set(overview)
	}
	WriteJSON(w, http.StatusOK, overview)
}

func (h *apiHandler) adminAnalyticsViews(w http.ResponseWriter, r *http.Request) {
	if err := rejectUnknownQuery(r.URL.Query(), "days"); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_QUERY", err.Error())
		return
	}
	days := 0
	if rawDays := strings.TrimSpace(r.URL.Query().Get("days")); rawDays != "" {
		value, err := strconv.Atoi(rawDays)
		if err != nil || value < 1 {
			WriteError(w, http.StatusBadRequest, "INVALID_QUERY", "days must be a positive integer")
			return
		}
		days = value
	}
	views, err := h.store.AnalyticsViews(days)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "ANALYTICS_UNAVAILABLE", "Analytics are unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, views)
}

func (h *apiHandler) adminSystem(w http.ResponseWriter, _ *http.Request) {
	sizeBytes, err := h.store.DatabaseSizeBytes()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "SYSTEM_UNAVAILABLE", "System status is unavailable.")
		return
	}
	auditEventCount, err := h.store.AuditEventCount()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "SYSTEM_UNAVAILABLE", "System status is unavailable.")
		return
	}
	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)
	resources, rssBytes := systemResources(h.cfg.DatabasePath)
	WriteJSON(w, http.StatusOK, model.SystemStatus{
		Version:         coreVersion,
		StartedAt:       processStartedAt.Format(time.RFC3339),
		UptimeSeconds:   int64(time.Since(processStartedAt).Seconds()),
		Database:        model.SystemDatabase{SizeBytes: sizeBytes},
		Caches:          model.SystemCaches{ContentEntries: h.contentCache.Len()},
		Runtime:         model.SystemRuntime{HeapAllocBytes: memStats.HeapAlloc, NumGoroutine: runtime.NumGoroutine(), SysRSSBytes: rssBytes},
		Resources:       resources,
		Host:            systemHost(),
		AuditEventCount: auditEventCount,
	})
}

func (h *apiHandler) adminAudit(w http.ResponseWriter, r *http.Request) {
	if err := rejectUnknownQuery(r.URL.Query(), "page", "pageSize", "q"); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_QUERY", err.Error())
		return
	}
	page := 1
	if rawPage := strings.TrimSpace(r.URL.Query().Get("page")); rawPage != "" {
		value, err := strconv.Atoi(rawPage)
		if err != nil || value < 1 {
			WriteError(w, http.StatusBadRequest, "INVALID_QUERY", "page must be a positive integer")
			return
		}
		page = value
	}
	pageSize := 10
	if rawPageSize := strings.TrimSpace(r.URL.Query().Get("pageSize")); rawPageSize != "" {
		value, err := strconv.Atoi(rawPageSize)
		if err != nil || value < 1 || value > 50 {
			WriteError(w, http.StatusBadRequest, "INVALID_QUERY", "pageSize must be between 1 and 50")
			return
		}
		pageSize = value
	}
	needle := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(needle) > 200 {
		WriteError(w, http.StatusBadRequest, "INVALID_QUERY", "q is too long")
		return
	}
	events, total, err := h.store.ListAuditEvents(page, pageSize, needle)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "AUDIT_UNAVAILABLE", "Audit events are unavailable.")
		return
	}
	totalPages := (total + pageSize - 1) / pageSize
	if totalPages < 1 {
		totalPages = 1
	}
	if page > totalPages {
		page = totalPages
	}
	WriteJSON(w, http.StatusOK, model.AuditEventList{Events: events, Pagination: model.Pagination{Page: page, PageSize: pageSize, TotalItems: total, TotalPages: totalPages}})
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
