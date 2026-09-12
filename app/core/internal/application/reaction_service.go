package application

import (
	"context"

	"github.com/manifold-space/manifold/app/core/internal/chain"
	"github.com/manifold-space/manifold/app/core/internal/model"
)

func (s *Service) SetLike(ctx context.Context, request Request, content model.Content, visitorID string, enabled bool) error {
	action := "removed"
	var err error
	if enabled {
		err = s.store.SetLike(ctx, content.ID, visitorID)
		action = "added"
	} else {
		err = s.store.DeleteLike(ctx, content.ID, visitorID)
	}
	if err != nil {
		return err
	}
	s.audit(request, "content.like."+action, "content", content.ID, nil)
	if payload, label, ref, metadata, err := ReactionActionPayload(content.ID, visitorID, action); err == nil {
		s.anchor(ctx, request, chain.SourceReaction, payload, label, ref, metadata)
	}
	s.invalidateContent(content.Slug)
	return nil
}
