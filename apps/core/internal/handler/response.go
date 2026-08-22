package handler

import (
	"encoding/json"
	"net/http"
	"time"
)

func WriteJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func Health(w http.ResponseWriter, _ *http.Request) {
	WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func Profile(w http.ResponseWriter, _ *http.Request) {
	WriteJSON(w, http.StatusOK, map[string]any{"name": "Manifold", "bio": "A living digital garden.", "location": "", "avatarUrl": "", "updatedAt": time.Now().UTC()})
}

func Entries(w http.ResponseWriter, _ *http.Request) {
	WriteJSON(w, http.StatusOK, map[string]any{"data": []any{}, "meta": map[string]int{"total": 0}})
}

func Now(w http.ResponseWriter, _ *http.Request) {
	WriteJSON(w, http.StatusOK, map[string]any{"title": "Building in public", "detail": "The space is taking shape.", "updatedAt": time.Now().UTC()})
}

