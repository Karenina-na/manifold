package handler

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

// Browsers must never render server-stored SVG: it can carry script payloads
// that execute on the public site even after Markdown sanitization.
var allowedMediaMimes = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
	"image/webp": true,
	"image/gif":  true,
	"image/avif": true,
}

func (h *apiHandler) adminUploadMedia(w http.ResponseWriter, r *http.Request) {
	filename := store.SanitizeMediaFilename(r.URL.Query().Get("filename"))
	if filename == "" {
		filename = "upload"
	}
	limit := h.cfg.MediaMaxBytes
	if limit <= 0 {
		limit = 5 << 20
	}
	body := http.MaxBytesReader(w, r.Body, limit)
	data, err := io.ReadAll(body)
	if err != nil {
		var maxError *http.MaxBytesError
		if errors.As(err, &maxError) {
			WriteError(w, http.StatusRequestEntityTooLarge, "MEDIA_TOO_LARGE", "Media exceeds the configured size limit.")
			return
		}
		WriteError(w, http.StatusBadRequest, "MEDIA_UNREADABLE", "Media body could not be read.")
		return
	}
	if len(data) == 0 {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "Media body is empty.")
		return
	}
	mime := http.DetectContentType(data)
	if !allowedMediaMimes[mime] {
		WriteError(w, http.StatusUnsupportedMediaType, "MEDIA_TYPE_UNSUPPORTED", "Only PNG, JPEG, WebP, GIF and AVIF images are accepted.")
		return
	}
	digest := sha256.Sum256(data)
	shaHex := hex.EncodeToString(digest[:])
	media, created, err := h.store.InsertMedia(mime, filename, shaHex, data)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "MEDIA_UNAVAILABLE", "Media could not be stored.")
		return
	}
	media.URL = h.mediaURL(r, media.ID)
	if created {
		h.audit(r, "media.uploaded", "media", media.ID, map[string]string{"mime": media.Mime, "size": strconv.FormatInt(media.Size, 10), "sha256": shaHex})
	}
	WriteJSON(w, http.StatusCreated, media)
}

func (h *apiHandler) adminListMedia(w http.ResponseWriter, r *http.Request) {
	page, pageSize, needle, ok := parseMediaQuery(w, r)
	if !ok {
		return
	}
	items, total, err := h.store.ListMedia(page, pageSize, needle)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "MEDIA_UNAVAILABLE", "Media list is unavailable.")
		return
	}
	for index := range items {
		items[index].URL = h.mediaURL(r, items[index].ID)
	}
	totalPages := (total + pageSize - 1) / pageSize
	if totalPages < 1 {
		totalPages = 1
	}
	if page > totalPages {
		page = totalPages
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": items, "pagination": model.PagePagination{Page: page, PageSize: pageSize, TotalItems: total, TotalPages: totalPages}})
}

func (h *apiHandler) adminDeleteMedia(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.store.DeleteMedia(id); err != nil {
		if errors.Is(err, store.ErrMediaNotFound) {
			WriteError(w, http.StatusNotFound, "MEDIA_NOT_FOUND", "Media was not found.")
			return
		}
		WriteError(w, http.StatusInternalServerError, "MEDIA_DELETE_FAILED", "Media could not be deleted.")
		return
	}
	h.audit(r, "media.deleted", "media", id, nil)
	w.WriteHeader(http.StatusNoContent)
}

func (h *apiHandler) getMedia(w http.ResponseWriter, r *http.Request) {
	media, data, err := h.store.GetMedia(chi.URLParam(r, "id"))
	if err != nil {
		if errors.Is(err, store.ErrMediaNotFound) {
			WriteError(w, http.StatusNotFound, "MEDIA_NOT_FOUND", "Media was not found.")
			return
		}
		WriteError(w, http.StatusInternalServerError, "MEDIA_UNAVAILABLE", "Media is unavailable.")
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

func (h *apiHandler) mediaURL(r *http.Request, id string) string {
	base := strings.TrimSuffix(h.cfg.PublicURL, "/")
	if base == "" {
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}
		base = scheme + "://" + r.Host
	}
	return base + "/api/v1/media/" + id
}

func parseMediaQuery(w http.ResponseWriter, r *http.Request) (page, pageSize int, needle string, ok bool) {
	page = 1
	if rawPage := strings.TrimSpace(r.URL.Query().Get("page")); rawPage != "" {
		value, err := strconv.Atoi(rawPage)
		if err != nil || value < 1 {
			WriteError(w, http.StatusBadRequest, "INVALID_QUERY", "page must be a positive integer")
			return 0, 0, "", false
		}
		page = value
	}
	pageSize = 20
	if rawPageSize := strings.TrimSpace(r.URL.Query().Get("pageSize")); rawPageSize != "" {
		value, err := strconv.Atoi(rawPageSize)
		if err != nil || value < 1 || value > 50 {
			WriteError(w, http.StatusBadRequest, "INVALID_QUERY", "pageSize must be between 1 and 50")
			return 0, 0, "", false
		}
		pageSize = value
	}
	needle = strings.TrimSpace(r.URL.Query().Get("q"))
	if len(needle) > 200 {
		WriteError(w, http.StatusBadRequest, "INVALID_QUERY", "q is too long")
		return 0, 0, "", false
	}
	return page, pageSize, needle, true
}
