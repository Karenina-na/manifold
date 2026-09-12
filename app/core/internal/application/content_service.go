package application

import (
	"context"

	"github.com/manifold-space/manifold/app/core/internal/chain"
	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

func (s *Service) CreateContent(ctx context.Context, request Request, input model.ContentInput) (model.Content, error) {
	content, err := s.store.CreateContent(ctx, input)
	if err != nil {
		return model.Content{}, err
	}
	s.audit(request, "content.created", "content", content.ID, map[string]string{"kind": string(content.Kind)})
	if payload, label, ref, metadata, err := ContentPayload(content); err == nil {
		s.anchor(ctx, request, chain.SourceContent, payload, label, ref, metadata)
	}
	s.invalidateContent(content.Slug)
	return content, nil
}

func (s *Service) UpdateContent(ctx context.Context, request Request, current model.Content, input store.ContentUpdate) (model.Content, error) {
	if err := s.store.UpdateContent(ctx, current.ID, input); err != nil {
		return model.Content{}, err
	}
	updated, err := s.store.GetContentByID(ctx, current.ID, true)
	if err != nil {
		return model.Content{}, err
	}
	s.audit(request, "content.updated", "content", current.ID, nil)
	if payload, label, ref, metadata, err := ContentPayload(updated); err == nil {
		s.anchor(ctx, request, chain.SourceContent, payload, label, ref, metadata)
	}
	s.invalidateContent(current.Slug, updated.Slug)
	return updated, nil
}

func (s *Service) SetContentStatus(ctx context.Context, request Request, current model.Content, status model.ContentStatus) (model.Content, error) {
	if err := s.store.SetContentStatus(ctx, current.ID, status); err != nil {
		return model.Content{}, err
	}
	updated, err := s.store.GetContentByID(ctx, current.ID, true)
	if err != nil {
		return model.Content{}, err
	}
	s.audit(request, "content."+statusEvent(status), "content", current.ID, nil)
	if payload, label, ref, metadata, err := ContentPayload(updated); err == nil {
		s.anchor(ctx, request, chain.SourceContent, payload, label, ref, metadata)
	}
	s.invalidateContent(current.Slug, updated.Slug)
	return updated, nil
}

func statusEvent(status model.ContentStatus) string {
	switch status {
	case model.StatusPublished:
		return "published"
	case model.StatusDraft:
		return "draft"
	default:
		return "deleted"
	}
}

func (s *Service) DeleteContent(ctx context.Context, request Request, current model.Content) error {
	deleted, err := s.store.DeleteContent(ctx, current.ID)
	if err != nil {
		return err
	}
	s.audit(request, "content.deleted", "content", current.ID, nil)
	if payload, label, ref, metadata, err := ContentPayload(deleted); err == nil {
		s.anchor(ctx, request, chain.SourceContent, payload, label, ref, metadata)
	}
	s.invalidateContent(current.Slug)
	return nil
}

func (s *Service) RestoreContent(ctx context.Context, request Request, id string) (model.Content, error) {
	content, err := s.store.RestoreContent(ctx, id)
	if err != nil {
		return model.Content{}, err
	}
	s.audit(request, "content.restored", "content", content.ID, nil)
	if payload, label, ref, metadata, err := ContentPayload(content); err == nil {
		s.anchor(ctx, request, chain.SourceContent, payload, label, ref, metadata)
	}
	s.invalidateContent(content.Slug)
	return content, nil
}
