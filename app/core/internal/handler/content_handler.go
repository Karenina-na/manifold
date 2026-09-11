package handler

import (
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/manifold-space/manifold/app/core/internal/model"
	"github.com/manifold-space/manifold/app/core/internal/store"
)

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
