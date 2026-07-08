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
	Reason             string `json:"reason,omitempty"`
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
			"audit":         h.auditFeature(),
			"multi_cluster": h.multiClusterFeature(),
			// loom_control_plane_mutations dark-launches the slice-6 control
			// layer. Default off: the Mills view only reveals its admin control
			// buttons (pause/resume/escalate/kill-switch) when this is true.
			"loom_control_plane_mutations": h.loomMillsMutationFeature(),
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

func (h *Handler) auditFeature() Feature {
	feature := Feature{
		Enabled: h.auditAvailable(),
		Mode:    "enabled",
	}
	if feature.Enabled {
		return feature
	}
	if h == nil || h.cfg == nil {
		feature.Mode = "unconfigured"
		feature.Reason = "FlexDeck handler is not configured"
		return feature
	}
	if h.cfg.Audit.Disabled {
		feature.Mode = "disabled"
		feature.Reason = "AUDIT_DISABLED is true"
		return feature
	}
	if h.auditStore == nil {
		feature.Mode = "missing_store"
		feature.Reason = "Audit store is not configured"
		return feature
	}
	feature.Mode = "blocked"
	feature.Reason = "Audit logs are not ready"
	return feature
}

func (h *Handler) multiClusterFeature() Feature {
	feature := Feature{
		Enabled: h.multiClusterAvailable(),
		Mode:    "enabled",
	}
	if feature.Enabled {
		return feature
	}
	if h == nil || h.cfg == nil {
		feature.Mode = "unconfigured"
		feature.Reason = "FlexDeck handler is not configured"
		return feature
	}
	if h.cfg.MultiCluster.Disabled {
		feature.Mode = "disabled"
		feature.Reason = "MULTICLUSTER_DISABLED is true"
		return feature
	}
	if h.clusterRegistry == nil {
		feature.Mode = "missing_registry"
		feature.Reason = "Cluster registry is not configured"
		return feature
	}
	feature.Mode = "blocked"
	feature.Reason = "Multi-cluster is not ready"
	return feature
}

func (h *Handler) loomMillsMutationFeature() Feature {
	feature := Feature{
		Enabled: h.loomMillsMutationsEnabled(),
		Mode:    "enabled",
	}
	if feature.Enabled {
		return feature
	}
	if h == nil || h.cfg == nil {
		feature.Mode = "unconfigured"
		feature.Reason = "FlexDeck handler is not configured"
		return feature
	}
	if h.cfg.Mills.Disabled || !h.loomMillsEnabled() {
		feature.Mode = "operator_disabled"
		feature.Reason = "Mills operator is disabled or unconfigured"
		return feature
	}
	if !h.cfg.Mills.MutationsEnabled {
		feature.Mode = "dark_launch"
		feature.Reason = "LOOM_MILLS_MUTATIONS_ENABLED is false"
		return feature
	}
	if strings.TrimSpace(h.cfg.Mills.AdminToken) == "" || h.millsClient == nil || !h.millsClient.CanMutate() {
		feature.Mode = "missing_admin_token"
		feature.Reason = "LOOM_MILLS_ADMIN_TOKEN is not configured"
		return feature
	}
	feature.Mode = "blocked"
	feature.Reason = "Mills mutations are not ready"
	return feature
}
