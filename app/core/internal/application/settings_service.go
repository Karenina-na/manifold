package application

import (
	"github.com/manifold-space/manifold/app/core/internal/chain"
	"github.com/manifold-space/manifold/app/core/internal/model"
)

func (s *Service) UpdateProfile(request Request, profile model.Profile) error {
	if err := s.store.UpdateProfile(profile); err != nil {
		return err
	}
	s.audit(request, "profile.updated", "profile", "profile_1", nil)
	if payload, label, ref, metadata, err := ProfilePayload(profile); err == nil {
		s.anchor(request, chain.SourceProfile, payload, label, ref, metadata)
	}
	return nil
}

func (s *Service) UpdateSite(request Request, config model.SiteConfig) error {
	if err := s.store.UpdateSiteConfig(config); err != nil {
		return err
	}
	s.audit(request, "site.updated", "site", "site_1", nil)
	if payload, label, ref, metadata, err := SitePayload(config); err == nil {
		s.anchor(request, chain.SourceSite, payload, label, ref, metadata)
	}
	return nil
}

func (s *Service) SetPinnedIDs(request Request, kind model.ContentKind, ids []string) error {
	if err := s.store.SetPinnedIds(kind, ids); err != nil {
		return err
	}
	resourceType, resourceID, eventName := "thoughts_config", "thoughts_1", "thoughts.config.updated"
	if kind == model.ContentKindArticle {
		resourceType, resourceID, eventName = "writings_config", "writings_1", "writings.config.updated"
	}
	s.audit(request, eventName, resourceType, resourceID, nil)
	if payload, label, ref, metadata, err := PinsPayload(kind, ids); err == nil {
		s.anchor(request, chain.SourceSite, payload, label, ref, metadata)
	}
	return nil
}
