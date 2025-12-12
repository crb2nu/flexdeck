package handlers

import (
	"encoding/json"
	"net/http"
)

// UI Config handler
func (h *Handler) UIConfig(w http.ResponseWriter, r *http.Request) {
	// TODO: Load from UIConfigDir if available
	config := map[string]any{
		"title":  "FLEXDECK",
		"accent": "#00d9ff",
		"links":  []any{},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(config)
}
