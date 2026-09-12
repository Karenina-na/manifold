package handler

import (
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"strings"
)

func validSHA256Hex(value string) bool {
	if len(value) != 64 {
		return false
	}
	_, err := hex.DecodeString(strings.ToLower(value))
	return err == nil
}

func parsePageParams(r *http.Request, page, pageSize *int) error {
	if raw := strings.TrimSpace(r.URL.Query().Get("page")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 {
			return errors.New("page must be a positive integer")
		}
		*page = value
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("pageSize")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 {
			return errors.New("pageSize must be a positive integer")
		}
		if value > 100 {
			value = 100
		}
		*pageSize = value
	}
	return nil
}
