package application

import (
	"strconv"

	"github.com/manifold-space/manifold/app/core/internal/chain"
	"github.com/manifold-space/manifold/app/core/internal/model"
)

func (s *Service) InsertMedia(request Request, mime, filename, shaHex string, data []byte) (model.Media, bool, error) {
	media, created, err := s.store.InsertMedia(mime, filename, shaHex, data)
	if err != nil || !created {
		return media, created, err
	}
	s.audit(request, "media.uploaded", "media", media.ID, map[string]string{"mime": media.Mime, "size": strconv.FormatInt(media.Size, 10), "sha256": shaHex})
	if payload, label, ref, metadata, err := MediaUploadPayload(media.ID, media.Mime, media.Size, shaHex, media.Filename); err == nil {
		s.anchor(request, chain.SourceMedia, payload, label, ref, metadata)
	}
	return media, true, nil
}

func (s *Service) DeleteMedia(request Request, id string) error {
	if err := s.store.DeleteMedia(id); err != nil {
		return err
	}
	s.audit(request, "media.deleted", "media", id, nil)
	if payload, label, ref, metadata, err := MediaDeletePayload(id); err == nil {
		s.anchor(request, chain.SourceMedia, payload, label, ref, metadata)
	}
	return nil
}
