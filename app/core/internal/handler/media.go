package handler

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/manifold-space/manifold/app/core/internal/apierror"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

func (h *apiHandler) getMedia(w http.ResponseWriter, r *http.Request) {
	media, data, err := h.store.GetMedia(chi.URLParam(r, "id"))
	if err != nil {
		if errors.Is(err, store.ErrMediaNotFound) {
			WriteError(w, http.StatusNotFound, apierror.MediaNotFound, "Media was not found.")
			return
		}
		WriteError(w, http.StatusInternalServerError, apierror.MediaUnavailable, "Media is unavailable.")
		return
	}
	etag := `"` + media.SHA256 + `"`
	w.Header().Set("ETag", etag)
	if subtle.ConstantTimeCompare([]byte(etag), []byte(r.Header.Get("If-None-Match"))) == 1 {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	// Content-addressed uploads never change, so caches can keep them forever.
	w.Header().Set("Content-Type", media.Mime)
	w.Header().Set("Content-Length", strconv.FormatInt(int64(len(data)), 10))
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}
