package handlers

import (
	"encoding/json"
	"net/http"
)

// DashboardSummary serves the pre-materialized cluster/node/pod resource summary.
// Returns 503 if the summary is stale or unavailable.
func (h *Handler) DashboardSummary(w http.ResponseWriter, r *http.Request) {
	if h.metricsStore == nil {
		http.Error(w, `{"error":"metrics store unavailable"}`, http.StatusServiceUnavailable)
		return
	}

	summary, err := h.metricsStore.GetDashboardSummaryWithRefresh(r.Context(), h.cfg.Prom.URL)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(summary)
}
