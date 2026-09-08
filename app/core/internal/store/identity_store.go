package store

import (
	"github.com/manifold-space/manifold/app/core/internal/model"
)

// UpsertIdentity records a provider account after a successful OAuth exchange.
// The row is keyed by (provider, provider_id); display fields refresh on every
// sign-in while the id stays stable so visitor sessions keep resolving.
func (s *Store) UpsertIdentity(provider, providerID, displayName, avatarURL, email string) (model.Identity, error) {
	id := "identity_" + provider + "_" + providerID
	now := nowRFC3339()
	if _, err := s.DB.Exec(`INSERT INTO identities (id, provider, provider_id, display_name, avatar_url, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(provider, provider_id) DO UPDATE SET display_name = excluded.display_name, avatar_url = excluded.avatar_url, email = excluded.email, updated_at = excluded.updated_at`,
		id, provider, providerID, displayName, avatarURL, email, now, now); err != nil {
		return model.Identity{}, err
	}
	return model.Identity{ID: id, Provider: provider, ProviderID: providerID, DisplayName: displayName, AvatarURL: avatarURL, Email: email, CreatedAt: now, UpdatedAt: now}, nil
}

// GetIdentity loads one identity by id; sql.ErrNoRows when the row is gone.
func (s *Store) GetIdentity(id string) (model.Identity, error) {
	var identity model.Identity
	err := s.DB.QueryRow(`SELECT id, provider, provider_id, display_name, avatar_url, email, created_at, updated_at FROM identities WHERE id = ?`, id).Scan(
		&identity.ID, &identity.Provider, &identity.ProviderID, &identity.DisplayName, &identity.AvatarURL, &identity.Email, &identity.CreatedAt, &identity.UpdatedAt)
	if err != nil {
		return model.Identity{}, err
	}
	return identity, nil
}
