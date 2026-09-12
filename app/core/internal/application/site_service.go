package application

import (
	"context"

	"github.com/manifold-space/manifold/app/core/internal/chain"
	"github.com/manifold-space/manifold/app/core/internal/model"
)

func (s *Service) UpdateSite(ctx context.Context, request Request, config model.SiteConfig) error {
	if err := s.store.UpdateSiteConfig(ctx, config); err != nil {
		return err
	}
	s.audit(request, "site.updated", "site", "site_1", nil)
	if payload, label, ref, metadata, err := SitePayload(config); err == nil {
		s.anchor(ctx, request, chain.SourceSite, payload, label, ref, metadata)
	}
	return nil
}
