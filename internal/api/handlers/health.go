package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/flexinfer/flexdeck/internal/cache"
)

type HealthResponse struct {
	OK         bool               `json:"ok"`
	Service    string             `json:"service"`
	Time       string             `json:"time"`
	Features   map[string]Feature `json:"features"`
	CacheStats *cache.Stats       `json:"cache,omitempty"`
}

type Feature struct {
	Enabled            bool   `json:"enabled"`
	URL                string `json:"url,omitempty"`
	DirectURL          string `json:"directUrl,omitempty"`
	PassthroughEnabled bool   `json:"passthroughEnabled,omitempty"`
	DirectEntryEnabled bool   `json:"directEntryEnabled,omitempty"`
	ReadOnly           bool   `json:"readOnly,omitempty"`
	Mode               string `json:"mode,omitempty"`
}

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	hudURL := h.loomHUDURL()
	hudDirectURL := h.loomHUDDirectURL()
	hudPassthroughEnabled := h.loomHUDPassthroughEnabled()
	hudDirectEntryEnabled := h.loomHUDDirectEntryEnabled()
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
			"grafana": {
				Enabled: !h.cfg.Grafana.Disabled,
				URL:     h.cfg.Grafana.URL,
			},
			"alertmanager": {
				Enabled: !h.cfg.Alertmanager.Disabled,
				URL:     h.cfg.Alertmanager.URL,
			},
			"flexinfer_proxy": {
				Enabled: !h.cfg.FlexInferProxy.Disabled && h.cfg.FlexInferProxy.URL != "",
				URL:     h.cfg.FlexInferProxy.URL,
				Mode:    h.cfg.FlexInferProxy.ManagementMode,
			},
			"loom_hud": {
				Enabled:            hudPassthroughEnabled,
				URL:                hudURL,
				DirectURL:          hudDirectURL,
				PassthroughEnabled: hudPassthroughEnabled,
				DirectEntryEnabled: hudDirectEntryEnabled,
			},
			"loom_hud_push": {
				Enabled: !h.cfg.LoomHUD.Disabled && h.hudPushStore != nil,
			},
			"rbac": {
				Enabled: h.rbacAvailable(),
			},
			"audit": {
				Enabled: h.auditAvailable(),
			},
			"multi_cluster": {
				Enabled: h.multiClusterAvailable(),
			},
			// loom_control_plane_mutations dark-launches the slice-6 control
			// layer. Default off: the Mills view only reveals its admin control
			// buttons (pause/resume/escalate/kill-switch) when this is true.
			"loom_control_plane_mutations": {
				Enabled: h.loomMillsMutationsEnabled(),
			},
			"modelcache": {
				Enabled: !h.cfg.K8s.Disabled,
			},
		},
	}

	if h.cache != nil {
		stats := h.cache.Stats()
		resp.CacheStats = &stats
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

func (h *Handler) loomHUDURL() string {
	if h == nil || h.cfg == nil {
		return ""
	}
	return strings.TrimSpace(h.cfg.LoomHUD.URL)
}

func (h *Handler) loomHUDDirectURL() string {
	if h == nil || h.cfg == nil {
		return ""
	}
	if directURL := strings.TrimSpace(h.cfg.LoomHUD.DirectURL); directURL != "" {
		return directURL
	}
	return h.loomHUDURL()
}

func (h *Handler) loomHUDPassthroughEnabled() bool {
	if h == nil || h.cfg == nil {
		return false
	}
	return !h.cfg.LoomHUD.Disabled && h.loomHUDURL() != ""
}

func (h *Handler) loomHUDDirectEntryEnabled() bool {
	if h == nil || h.cfg == nil {
		return false
	}
	return !h.cfg.LoomHUD.Disabled && h.loomHUDDirectURL() != ""
}

func (h *Handler) rbacAvailable() bool {
	return h != nil && h.cfg != nil && !h.cfg.RBAC.Disabled && h.rbacRegistry != nil
}

func (h *Handler) auditAvailable() bool {
	return h != nil && h.cfg != nil && !h.cfg.Audit.Disabled && h.auditStore != nil
}

func (h *Handler) multiClusterAvailable() bool {
	return h != nil && h.cfg != nil && !h.cfg.MultiCluster.Disabled && h.clusterRegistry != nil
}
