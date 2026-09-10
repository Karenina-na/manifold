package handler

import (
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

func (h *apiHandler) listContent(w http.ResponseWriter, r *http.Request) {
	options, err := parseContentListOptions(r, false)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_QUERY", err.Error())
		return
	}
	result, err := h.store.ListContent(false, options)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "CONTENT_UNAVAILABLE", "Content is unavailable.")
		return
	}
	items := make([]model.PublicContent, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, model.ToPublicContent(item))
	}
	WriteJSON(w, http.StatusOK, collection(items, model.Pagination{Page: result.Page, PageSize: result.PageSize, TotalItems: result.TotalItems, TotalPages: result.TotalPages}))
}

func (h *apiHandler) tags(w http.ResponseWriter, r *http.Request) {
	if err := rejectUnknownQuery(r.URL.Query(), "kind"); err != nil {
		WriteError(w, http.StatusBadRequest, "INVALID_QUERY", err.Error())
		return
	}
	kind := model.ContentKind(strings.TrimSpace(r.URL.Query().Get("kind")))
	if kind != "" && kind != model.ContentKindThought && kind != model.ContentKindArticle {
		WriteError(w, http.StatusBadRequest, "INVALID_QUERY", "kind is invalid")
		return
	}
	tags, err := h.store.Tags(kind)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "TAGS_UNAVAILABLE", "Tags are unavailable.")
		return
	}
	pageSize := len(tags)
	if pageSize < 1 {
		pageSize = 1
	}
	WriteJSON(w, http.StatusOK, collection(tags, model.Pagination{Page: 1, PageSize: pageSize, TotalItems: len(tags), TotalPages: 1}))
}

func (h *apiHandler) getContent(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	content, ok := h.contentCache.Get(slug)
	if !ok {
		var err error
		content, err = h.store.GetContentBySlug(slug, false)
		if errors.Is(err, store.ErrContentNotFound) || errors.Is(err, sql.ErrNoRows) {
			WriteError(w, http.StatusNotFound, "CONTENT_NOT_FOUND", "Content was not found.")
			return
		}
		if err != nil {
			WriteError(w, http.StatusInternalServerError, "CONTENT_UNAVAILABLE", "Content is unavailable.")
			return
		}
	}
	if r.URL.Query().Get("trackView") != "false" {
		viewerID := ""
		if id, err := visitorID(r, false); err == nil {
			viewerID = id
		}
		// The SDK relays the browser's original Referer as a query param
		// because server-side fetch does not forward headers; fall back to
		// the direct Referer for same-origin callers.
		source := strings.TrimSpace(r.URL.Query().Get("referrer"))
		if source == "" {
			source = r.Referer()
		}
		viewCount, err := h.store.RecordContentView(content.ID, viewerID, referrerOrigin(source))
		if err != nil {
			slog.Error("content_view_count_failed", "contentId", content.ID, "error", err)
		} else {
			content.ViewCount = viewCount
			h.overviewCache.Purge()
		}
	}
	h.contentCache.Set(slug, content)
	h.audit(r, "content.viewed", "content", content.ID, nil)
	detail := model.ToPublicDetail(content)
	// ContentDetail carries the anchoring summary: latest content-source
	// certificate for this row, null before any write is anchored.
	detail.LatestAnchor = h.latestAnchorFor(content.ID)
	WriteJSON(w, http.StatusOK, detail)
}

// latestAnchorFor projects the newest content certificate into the public
// detail shape; nil ledger or no certificate → nil (omitted as null in JSON).
func (h *apiHandler) latestAnchorFor(contentID string) *model.AnchorSummary {
	if h.ledger == nil {
		return nil
	}
	anchor, err := h.ledger.LatestContentAnchor(contentID)
	if err != nil {
		return nil
	}
	summary := &model.AnchorSummary{AnchorID: anchor.ID, SubjectHash: anchor.SubjectHash}
	if anchor.BlockID == "" {
		summary.Status = "pending"
	} else {
		summary.Status = "anchored"
		summary.BlockID = &anchor.BlockID
	}
	return summary
}

// referrerOrigin reduces a Referer header to scheme://host so analytics
// grouping stays stable across page paths; unparseable values are truncated.
func referrerOrigin(header string) string {
	value := strings.TrimSpace(header)
	if value == "" {
		return ""
	}
	if parsed, err := url.Parse(value); err == nil && parsed.Host != "" {
		return parsed.Scheme + "://" + parsed.Host
	}
	if len(value) > 256 {
		value = value[:256]
	}
	return value
}

func visitorID(r *http.Request, required bool) (string, error) {
	value := strings.TrimSpace(r.Header.Get("X-Visitor-ID"))
	if value == "" && !required {
		return "", nil
	}
	if len(value) < 8 || len(value) > 128 {
		return "", errors.New("visitor id length is invalid")
	}
	for _, char := range value {
		if (char < 'a' || char > 'z') && (char < 'A' || char > 'Z') && (char < '0' || char > '9') && char != '-' && char != '_' {
			return "", errors.New("visitor id contains invalid characters")
		}
	}
	return value, nil
}

func (h *apiHandler) stats(w http.ResponseWriter, _ *http.Request) {
	if stats, ok := h.statsCache.Get(); ok {
		WriteJSON(w, http.StatusOK, stats)
		return
	}
	stats, err := h.store.Stats()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "STATS_UNAVAILABLE", "Stats are unavailable.")
		return
	}
	h.statsCache.Set(stats)
	WriteJSON(w, http.StatusOK, stats)
}

func (h *apiHandler) presence(w http.ResponseWriter, r *http.Request) {
	visitorID, err := visitorID(r, true)
	if err != nil {
		WriteError(w, http.StatusBadRequest, "VISITOR_ID_INVALID", "Visitor ID is required and invalid.")
		return
	}
	activeVisitors, err := h.store.TouchPresence(visitorID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "PRESENCE_UNAVAILABLE", "Presence is unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, model.PresenceStatus{ActiveVisitors: activeVisitors, ObservedAt: time.Now().UTC().Format(time.RFC3339)})
}

func parseContentListOptions(r *http.Request, includeDrafts bool) (store.ContentListOptions, error) {
	query := r.URL.Query()
	allowed := []string{"kind", "tag", "q", "page", "pageSize", "sort", "aiAssisted"}
	if includeDrafts {
		allowed = append(allowed, "status", "pinned")
	}
	if err := rejectUnknownQuery(query, allowed...); err != nil {
		return store.ContentListOptions{}, err
	}
	options := store.ContentListOptions{Page: 1, PageSize: 20}
	if rawPage := strings.TrimSpace(query.Get("page")); rawPage != "" {
		page, err := strconv.Atoi(rawPage)
		if err != nil || page < 1 {
			return options, fmt.Errorf("page must be a positive integer")
		}
		options.Page = page
	}
	if rawPageSize := strings.TrimSpace(query.Get("pageSize")); rawPageSize != "" {
		pageSize, err := strconv.Atoi(rawPageSize)
		if err != nil || pageSize < 1 {
			return options, fmt.Errorf("pageSize must be a positive integer")
		}
		if pageSize > 100 {
			pageSize = 100
		}
		options.PageSize = pageSize
	}
	if rawSort := strings.TrimSpace(query.Get("sort")); rawSort != "" {
		switch rawSort {
		case "newest", "oldest", "updated":
			options.Sort = rawSort
		default:
			return options, fmt.Errorf("sort is invalid")
		}
	}
	if rawAiAssisted := strings.TrimSpace(query.Get("aiAssisted")); rawAiAssisted != "" {
		value, err := strconv.ParseBool(rawAiAssisted)
		if err != nil {
			return options, fmt.Errorf("aiAssisted must be a boolean")
		}
		options.AiAssisted = &value
	}
	for _, rawValue := range query["kind"] {
		for _, rawKind := range strings.Split(rawValue, ",") {
			rawKind = strings.TrimSpace(rawKind)
			if rawKind == "" {
				continue
			}
			kind := model.ContentKind(rawKind)
			switch kind {
			case model.ContentKindArticle, model.ContentKindThought:
				options.Kinds = append(options.Kinds, kind)
			default:
				return options, fmt.Errorf("kind is invalid")
			}
		}
	}
	tags, err := parseTagFilters(query["tag"])
	if err != nil {
		return options, err
	}
	options.Tags = tags
	if options.Query = strings.TrimSpace(query.Get("q")); len(options.Query) > 200 {
		return options, fmt.Errorf("q is too long")
	}
	if rawStatus := strings.TrimSpace(query.Get("status")); rawStatus != "" {
		if !includeDrafts || (rawStatus != "DRAFT" && rawStatus != "PUBLISHED" && rawStatus != "DELETED") {
			return options, fmt.Errorf("status is invalid")
		}
		options.Status = model.ContentStatus(rawStatus)
	}
	if rawPinned := strings.TrimSpace(query.Get("pinned")); rawPinned != "" {
		if !includeDrafts {
			return options, fmt.Errorf("pinned is invalid")
		}
		value, err := strconv.ParseBool(rawPinned)
		if err != nil {
			return options, fmt.Errorf("pinned must be a boolean")
		}
		options.PinnedIDsOnly = value
	}
	return options, nil
}

func rejectUnknownQuery(query url.Values, allowed ...string) error {
	set := make(map[string]struct{}, len(allowed))
	for _, key := range allowed {
		set[key] = struct{}{}
	}
	for key := range query {
		if _, ok := set[key]; !ok {
			return fmt.Errorf("query parameter %s is not supported", key)
		}
	}
	return nil
}

func parseTagFilters(rawValues []string) ([]string, error) {
	tags := make([]string, 0, len(rawValues))
	seen := make(map[string]struct{}, len(rawValues))
	for _, rawValue := range rawValues {
		for _, rawTag := range strings.Split(rawValue, ",") {
			tag := strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(rawTag)), " "))
			if tag == "" {
				continue
			}
			if len(tag) > 80 {
				return nil, fmt.Errorf("tag is too long")
			}
			if _, exists := seen[tag]; exists {
				continue
			}
			seen[tag] = struct{}{}
			tags = append(tags, tag)
			if len(tags) > 10 {
				return nil, fmt.Errorf("too many tags")
			}
		}
	}
	if len(tags) == 0 {
		return nil, nil
	}
	return tags, nil
}
