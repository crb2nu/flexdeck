package handlers

import (
	"encoding/json"
	"net/http"
	"time"
)

type HealthResponse struct {
	OK       bool               `json:"ok"`
	Service  string             `json:"service"`
	Time     string             `json:"time"`
	Features map[string]Feature `json:"features"`
}

type Feature struct {
	Enabled  bool   `json:"enabled"`
	URL      string `json:"url,omitempty"`
	ReadOnly bool   `json:"readOnly,omitempty"`
}

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	resp := HealthResponse{
		OK:      true,
		Service: "flexdeck",
		Time:    time.Now().UTC().Format(time.RFC3339),
		Features: map[string]Feature{
			"k8s": {
				Enabled:  !h.cfg.K8s.Disabled,
				ReadOnly: h.cfg.K8s.ReadOnly,
			},
			"prometheus": {
				Enabled: !h.cfg.Prom.Disabled,
				URL:     h.cfg.Prom.URL,
			},
			"loki": {
				Enabled: !h.cfg.Loki.Disabled,
				URL:     h.cfg.Loki.URL,
			},
			"vllm": {
				Enabled: !h.cfg.VLLM.Disabled,
				URL:     h.cfg.VLLM.URL,
			},
			"cache": {
				Enabled: h.cfg.Cache.HFPath != "" || h.cfg.Cache.CivitAIPath != "",
			},
			"litellm": {
				Enabled: !h.cfg.LiteLLM.Disabled,
				URL:     h.cfg.LiteLLM.URL,
			},
			"redis": {
				Enabled: !h.cfg.Redis.Disabled,
			},
			"langfuse": {
				Enabled: !h.cfg.Langfuse.Disabled,
				URL:     h.cfg.Langfuse.URL,
			},
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
