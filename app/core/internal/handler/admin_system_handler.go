package handler

import (
	"net/http"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/manifold-space/manifold/app/core/internal/apierror"
	"github.com/manifold-space/manifold/app/core/internal/model"
)

func (h *apiHandler) adminStats(w http.ResponseWriter, r *http.Request) {
	stats, ok := h.statsCache.Get()
	if !ok {
		var err error
		stats, err = h.store.Stats(r.Context())
		if err != nil {
			WriteError(w, http.StatusInternalServerError, apierror.StatsUnavailable, "Stats are unavailable.")
			return
		}
		h.statsCache.Set(stats)
	}
	WriteJSON(w, http.StatusOK, struct {
		Content model.Stats `json:"content"`
	}{Content: stats})
}

func (h *apiHandler) adminOverview(w http.ResponseWriter, r *http.Request) {
	overview, ok := h.overviewCache.Get()
	if !ok {
		var err error
		overview, err = h.store.Overview(r.Context())
		if err != nil {
			WriteError(w, http.StatusInternalServerError, apierror.OverviewUnavailable, "Overview is unavailable.")
			return
		}
		h.overviewCache.Set(overview)
	}
	WriteJSON(w, http.StatusOK, overview)
}

func (h *apiHandler) adminAnalyticsViews(w http.ResponseWriter, r *http.Request) {
	if err := rejectUnknownQuery(r.URL.Query(), "days"); err != nil {
		WriteError(w, http.StatusBadRequest, apierror.InvalidQuery, err.Error())
		return
	}
	days := 0
	if rawDays := strings.TrimSpace(r.URL.Query().Get("days")); rawDays != "" {
		value, err := strconv.Atoi(rawDays)
		if err != nil || value < 1 {
			WriteError(w, http.StatusBadRequest, apierror.InvalidQuery, "days must be a positive integer")
			return
		}
		days = value
	}
	views, err := h.store.AnalyticsViews(r.Context(), days)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.AnalyticsUnavailable, "Analytics are unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, views)
}

func (h *apiHandler) adminSystem(w http.ResponseWriter, r *http.Request) {
	sizeBytes, err := h.store.DatabaseSizeBytes(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.SystemUnavailable, "System status is unavailable.")
		return
	}
	auditEventCount, err := h.store.AuditEventCount(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.SystemUnavailable, "System status is unavailable.")
		return
	}
	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)
	resources, rssBytes := systemResources(h.cfg.DatabasePath)
	WriteJSON(w, http.StatusOK, model.SystemStatus{
		Version:         coreVersion,
		StartedAt:       processStartedAt.Format(time.RFC3339),
		UptimeSeconds:   int64(time.Since(processStartedAt).Seconds()),
		Database:        model.SystemDatabase{SizeBytes: sizeBytes},
		Caches:          model.SystemCaches{ContentEntries: h.contentCache.Len()},
		Runtime:         model.SystemRuntime{HeapAllocBytes: memStats.HeapAlloc, NumGoroutine: runtime.NumGoroutine(), SysRSSBytes: rssBytes},
		Resources:       resources,
		Host:            systemHost(),
		AuditEventCount: auditEventCount,
	})
}

func (h *apiHandler) adminAudit(w http.ResponseWriter, r *http.Request) {
	if err := rejectUnknownQuery(r.URL.Query(), "page", "pageSize", "q"); err != nil {
		WriteError(w, http.StatusBadRequest, apierror.InvalidQuery, err.Error())
		return
	}
	page := 1
	if rawPage := strings.TrimSpace(r.URL.Query().Get("page")); rawPage != "" {
		value, err := strconv.Atoi(rawPage)
		if err != nil || value < 1 {
			WriteError(w, http.StatusBadRequest, apierror.InvalidQuery, "page must be a positive integer")
			return
		}
		page = value
	}
	pageSize := 10
	if rawPageSize := strings.TrimSpace(r.URL.Query().Get("pageSize")); rawPageSize != "" {
		value, err := strconv.Atoi(rawPageSize)
		if err != nil || value < 1 || value > 50 {
			WriteError(w, http.StatusBadRequest, apierror.InvalidQuery, "pageSize must be between 1 and 50")
			return
		}
		pageSize = value
	}
	needle := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(needle) > 200 {
		WriteError(w, http.StatusBadRequest, apierror.InvalidQuery, "q is too long")
		return
	}
	events, total, err := h.store.ListAuditEvents(r.Context(), page, pageSize, needle)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, apierror.AuditUnavailable, "Audit events are unavailable.")
		return
	}
	WriteJSON(w, http.StatusOK, model.AuditEventList{Events: events, Pagination: paginationFor(page, pageSize, total)})
}
