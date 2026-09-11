package handler

import (
	"crypto/sha256"
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
// that execute on the public site even after Markdown sanitization. PDFs are
// allowed so the profile resume upload can reuse the media store; the serving
// path emits no Content-Disposition header, so PDFs open inline in the
// browser's PDF viewer rather than a script context.
var allowedMediaMimes = map[string]bool{
	"image/png":       true,
	"image/jpeg":      true,
	"image/webp":      true,
	"image/gif":       true,
	"image/avif":      true,
	"application/pdf": true,
}

func (h *apiHandler) adminUploadMedia(w http.ResponseWriter, r *http.Request) {
	if err := rejectUnknownQuery(r.URL.Query(), "filename"); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_QUERY", err.Error())
		return
	}
	rawFilename := strings.TrimSpace(r.URL.Query().Get("filename"))
	if rawFilename == "" {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "filename is required.")
		return
	}
	filename := store.SanitizeMediaFilename(rawFilename)
	if filename == "" {
		WriteError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "filename is invalid.")
		return
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
		WriteError(w, http.StatusUnsupportedMediaType, "MEDIA_TYPE_UNSUPPORTED", "Only PNG, JPEG, WebP, GIF, AVIF images and PDF files are accepted.")
		return
	}
	digest := sha256.Sum256(data)
	shaHex := hex.EncodeToString(digest[:])
	media, _, err := h.mutations.InsertMedia(mutationRequest(r), mime, filename, shaHex, data)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "MEDIA_UNAVAILABLE", "Media could not be stored.")
		return
	}
	media.URL = h.mediaURL(r, media.ID)
	WriteJSON(w, http.StatusCreated, media)
}

func (h *apiHandler) adminListMedia(w http.ResponseWriter, r *http.Request) {
	if err := rejectUnknownQuery(r.URL.Query(), "page", "pageSize", "q"); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_QUERY", err.Error())
		return
	}
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
	WriteJSON(w, http.StatusOK, map[string]any{"data": items, "pagination": model.Pagination{Page: page, PageSize: pageSize, TotalItems: total, TotalPages: totalPages}})
}

func (h *apiHandler) adminDeleteMedia(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	refs, err := h.store.MediaReferences(id)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "MEDIA_UNAVAILABLE", "Media references could not be checked.")
		return
	}
	if len(refs) > 0 {
		WriteJSON(w, http.StatusConflict, map[string]any{"error": map[string]any{"code": "MEDIA_IN_USE", "message": "This media is referenced by published or draft content and cannot be deleted.", "details": map[string]any{"references": refs}}})
		return
	}
	if err := h.mutations.DeleteMedia(mutationRequest(r), id); err != nil {
		if errors.Is(err, store.ErrMediaNotFound) {
			WriteError(w, http.StatusNotFound, "MEDIA_NOT_FOUND", "Media was not found.")
			return
		}
		WriteError(w, http.StatusInternalServerError, "MEDIA_DELETE_FAILED", "Media could not be deleted.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// adminListMediaReferences returns the published or draft content that embeds
// this media URL. The store query already excludes deleted content, so unknown
// ids resolve to an empty list rather than an error.
func (h *apiHandler) adminListMediaReferences(w http.ResponseWriter, r *http.Request) {
	refs, err := h.store.MediaReferences(chi.URLParam(r, "id"))
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "MEDIA_UNAVAILABLE", "Media references could not be checked.")
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"references": refs})
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
