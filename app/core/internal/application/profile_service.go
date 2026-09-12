package application

import (
	"context"

	"github.com/manifold-space/manifold/app/core/internal/chain"
	"github.com/manifold-space/manifold/app/core/internal/model"
)

func (s *Service) UpdateProfile(ctx context.Context, request Request, profile model.Profile) error {
	if err := s.store.UpdateProfile(ctx, profile); err != nil {
		return err
	}
	s.audit(request, "profile.updated", "profile", "profile_1", nil)
	if payload, label, ref, metadata, err := ProfilePayload(profile); err == nil {
		s.anchor(ctx, request, chain.SourceProfile, payload, label, ref, metadata)
	}
	return nil
}
