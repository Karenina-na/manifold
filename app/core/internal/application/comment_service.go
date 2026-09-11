package application

import (
	"github.com/manifold-space/manifold/app/core/internal/chain"
	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

type CommentInput struct {
	AuthorName, Body, AvatarSeed, AuthorProvider, AuthorAvatarURL string
	AuthorURL, ReplyToID                                          *string
}

func (s *Service) CreateComment(request Request, content model.Content, input CommentInput) (model.Comment, error) {
	comment, err := s.store.CreateComment(content.ID, input.AuthorName, input.AuthorURL, input.Body, input.ReplyToID, input.AvatarSeed, input.AuthorProvider, input.AuthorAvatarURL)
	if err != nil {
		return model.Comment{}, err
	}
	s.audit(request, "comment.created", "comment", comment.ID, map[string]string{"contentId": content.ID})
	if payload, label, ref, metadata, err := CommentPayload(comment, "created"); err == nil {
		s.anchor(request, chain.SourceComment, payload, label, ref, metadata)
	}
	s.invalidateContent(content.Slug)
	return comment, nil
}

func (s *Service) SetCommentHidden(request Request, id string, hidden bool) error {
	var contentID string
	var err error
	action := "hidden"
	if hidden {
		contentID, err = s.store.HideComment(id)
	} else {
		contentID, err = s.store.UnhideComment(id)
		action = "unhidden"
	}
	if err != nil {
		return err
	}
	s.afterCommentChange(request, id, contentID, action)
	return nil
}

func (s *Service) SetCommentDeleted(request Request, id string, deleted bool) error {
	var contentID string
	var err error
	action := "deleted"
	if deleted {
		contentID, err = s.store.SoftDeleteComment(id)
	} else {
		contentID, err = s.store.RestoreComment(id)
		action = "restored"
	}
	if err != nil {
		return err
	}
	s.afterCommentChange(request, id, contentID, action)
	return nil
}

func (s *Service) UpdateCommentAuthor(request Request, id string, update store.CommentAuthorUpdate) error {
	contentID, err := s.store.UpdateCommentAuthor(id, update)
	if err != nil {
		return err
	}
	s.audit(request, "comment.updated", "comment", id, nil)
	s.anchorComment(request, id, "author-updated")
	s.invalidateCommentContent(contentID)
	return nil
}

func (s *Service) afterCommentChange(request Request, id, contentID, action string) {
	s.audit(request, "comment."+action, "comment", id, nil)
	s.anchorComment(request, id, action)
	s.invalidateCommentContent(contentID)
}

func (s *Service) anchorComment(request Request, id, action string) {
	comment, err := s.store.GetCommentByID(id)
	if err != nil {
		return
	}
	if payload, label, ref, metadata, err := CommentPayload(comment.Comment, action); err == nil {
		s.anchor(request, chain.SourceComment, payload, label, ref, metadata)
	}
}

func (s *Service) invalidateCommentContent(contentID string) {
	if content, err := s.store.GetContentByID(contentID, true); err == nil {
		s.invalidateContent(content.Slug)
	} else {
		s.overviewCache.Purge()
	}
}
