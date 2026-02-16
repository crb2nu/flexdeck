package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/flexinfer/flexdeck/internal/audit"
)

// AuditList returns paginated audit log entries.
func (h *Handler) AuditList(w http.ResponseWriter, r *http.Request) {
	if h.auditStore == nil {
		http.Error(w, "audit disabled", http.StatusServiceUnavailable)
		return
	}

	q := r.URL.Query()
	opts := audit.QueryOpts{
		Action: q.Get("action"),
		UserID: q.Get("user"),
	}

	if s := q.Get("since"); s != "" {
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			opts.Since = t
		}
	}
	if s := q.Get("until"); s != "" {
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			opts.Until = t
		}
	}
	if s := q.Get("offset"); s != "" {
		if n, err := strconv.ParseInt(s, 10, 64); err == nil {
			opts.Offset = n
		}
	}
	if s := q.Get("limit"); s != "" {
		if n, err := strconv.ParseInt(s, 10, 64); err == nil {
			opts.Limit = n
		}
	}

	entries, total, err := h.auditStore.Query(r.Context(), opts)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"entries": entries,
		"total":   total,
	})
}

// AuditStats returns aggregated audit statistics.
func (h *Handler) AuditStats(w http.ResponseWriter, r *http.Request) {
	if h.auditStore == nil {
		http.Error(w, "audit disabled", http.StatusServiceUnavailable)
		return
	}

	stats, err := h.auditStore.Stats(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}
