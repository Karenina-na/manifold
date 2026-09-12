package handler

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/manifold-space/manifold/app/core/internal/apierror"
	"github.com/manifold-space/manifold/app/core/internal/auth"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

type loginInput struct {
	Username string `json:"username" validate:"required,max=80"`
	Password string `json:"password" validate:"required,min=8,max=200"`
}

func (h *apiHandler) login(w http.ResponseWriter, r *http.Request) {
	var input loginInput
	if err := decodeJSON(r, &input); err != nil || h.validate.Struct(input) != nil {
		WriteError(w, http.StatusUnprocessableEntity, apierror.ValidationError, "Username and password are required.")
		return
	}
	token, err := h.auth.Login(input.Username, input.Password)
	if err != nil {
		h.audit(r, "admin.session.failed", "session", input.Username, map[string]string{"ip": clientAddress(r, trustedProxyNetworks(h.cfg.TrustedProxyCIDRs))})
		WriteError(w, http.StatusUnauthorized, apierror.InvalidCredentials, "Username or password is incorrect.")
		return
	}
	if claims, err := h.auth.Parse(token); err == nil {
		h.mutations.RecordAuthChange(mutationRequest(r), input.Username, "login", claims.ID)
	}
	WriteJSON(w, http.StatusOK, map[string]any{"accessToken": token, "tokenType": "Bearer", "expiresIn": auth.SessionTTLSeconds, "user": map[string]string{"username": input.Username, "role": "admin"}})
}

func (h *apiHandler) adminLogoutSession(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.ID == "" {
		WriteError(w, http.StatusUnauthorized, apierror.Unauthorized, "A valid session is required.")
		return
	}
	if err := h.store.RevokeSession(claims.ID, time.Now().UTC()); err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.SessionRevokeFailed, "Session could not be revoked.")
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
		WriteError(w, http.StatusUnauthorized, apierror.Unauthorized, "A valid session is required.")
		return
	}
	targetID := chi.URLParam(r, "id")
	target, err := h.store.GetSession(targetID)
	if errors.Is(err, store.ErrSessionNotFound) {
		WriteError(w, http.StatusNotFound, apierror.SessionNotFound, "Session was not found.")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.SessionsUnavailable, "Sessions are unavailable.")
		return
	}
	// Sessions are scoped to the signed-in admin; a foreign session id is
	// indistinguishable from a missing one.
	if target.Subject != claims.Subject {
		WriteError(w, http.StatusNotFound, apierror.SessionNotFound, "Session was not found.")
		return
	}
	if err := h.store.RevokeSession(targetID, time.Now().UTC()); err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.SessionRevokeFailed, "Session could not be revoked.")
		return
	}
	h.mutations.RecordAuthChange(mutationRequest(r), claims.Subject, "logout", targetID)
	w.WriteHeader(http.StatusNoContent)
}

func (h *apiHandler) adminLogoutSessions(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Subject == "" {
		WriteError(w, http.StatusUnauthorized, apierror.Unauthorized, "A valid session is required.")
		return
	}
	if err := h.store.RevokeSessions(claims.Subject, claims.ID, time.Now().UTC()); err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.SessionRevokeFailed, "Sessions could not be revoked.")
		return
	}
	h.mutations.RecordAuthChange(mutationRequest(r), claims.Subject, "logout-all", claims.ID)
	w.WriteHeader(http.StatusNoContent)
}

func (h *apiHandler) adminListSessions(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Subject == "" {
		WriteError(w, http.StatusUnauthorized, apierror.Unauthorized, "A valid session is required.")
		return
	}
	rows, err := h.store.AdminSessions(claims.Subject)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.SessionsUnavailable, "Sessions could not be listed.")
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
		WriteError(w, http.StatusUnprocessableEntity, apierror.ValidationError, "currentPassword and newPassword are required; newPassword must be at least 8 characters.")
		return
	}
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		WriteError(w, http.StatusUnauthorized, apierror.Unauthorized, "A valid session is required.")
		return
	}
	if err := h.auth.UpdateCredential(claims.Subject, input.CurrentPassword, input.NewPassword, claims.ID); err != nil {
		if errors.Is(err, auth.ErrInvalidCredentials) {
			WriteError(w, http.StatusUnauthorized, apierror.InvalidCredentials, "Current password is incorrect.")
			return
		}
		WriteError(w, http.StatusInternalServerError, apierror.PasswordChangeFailed, "Password could not be updated.")
		return
	}
	h.mutations.RecordAuthChange(mutationRequest(r), claims.Subject, "password-changed", claims.ID)
	w.WriteHeader(http.StatusNoContent)
}
