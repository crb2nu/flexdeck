package handlers

import "net/http"

// HUDCapabilitiesResponse advertises whether FlexDeck can pass through to Loom HUD
// and whether the direct upstream HUD entrypoint is available.
type HUDCapabilitiesResponse struct {
	Available          bool   `json:"available"`
	PassthroughEnabled bool   `json:"passthroughEnabled"`
	DirectEntryEnabled bool   `json:"directEntryEnabled"`
	DirectURL          string `json:"directUrl,omitempty"`
	Reason             string `json:"reason,omitempty"`
}

// HUDCapabilities returns the stable HUD capability contract for the frontend.
func (h *Handler) HUDCapabilities(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, h.hudCapabilities())
}

func (h *Handler) hudCapabilities() HUDCapabilitiesResponse {
	directURL := h.loomHUDDirectURL()
	passthroughEnabled := h.loomHUDPassthroughEnabled()
	directEntryEnabled := h.loomHUDDirectEntryEnabled()
	available := passthroughEnabled || directEntryEnabled

	resp := HUDCapabilitiesResponse{
		Available:          available,
		PassthroughEnabled: passthroughEnabled,
		DirectEntryEnabled: directEntryEnabled,
		DirectURL:          directURL,
	}

	if available {
		return resp
	}

	switch {
	case h == nil || h.cfg == nil:
		resp.Reason = "loom hud is unavailable"
	case h.cfg.LoomHUD.Disabled:
		resp.Reason = "loom hud is disabled"
	case h.loomHUDURL() == "" && directURL == "":
		resp.Reason = "loom hud url is not configured"
	default:
		resp.Reason = "loom hud is unavailable"
	}

	return resp
}
