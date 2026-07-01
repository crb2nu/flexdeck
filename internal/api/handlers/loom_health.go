package handlers

import (
	"context"
	"net/http"
	"sync"
	"time"
)

// LoomHealth aggregates per-source availability for the unified Loom control
// plane (Fleet/HUD, Plans, Mills, Flightdeck). Each source is probed in parallel
// with a short timeout; the result is cached briefly so the UI can poll it
// cheaply. This is the slice-1 foundation endpoint that the section shell reads
// to show which surfaces are live.
func (h *Handler) LoomHealth(w http.ResponseWriter, r *http.Request) {
	h.cachedProxyJSON(w, r, "loom:health", 10*time.Second, "loom health", func() (any, error) {
		return h.collectLoomHealth(r.Context()), nil
	})
}

// loomSourceHealth describes one federated source's configured/reachable state.
type loomSourceHealth struct {
	Enabled   bool   `json:"enabled"`
	Available bool   `json:"available"`
	Detail    string `json:"detail,omitempty"`
}

func (h *Handler) collectLoomHealth(ctx context.Context) map[string]any {
	probeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	var (
		wg  sync.WaitGroup
		mu  sync.Mutex
		out = map[string]loomSourceHealth{}
	)
	set := func(name string, s loomSourceHealth) {
		mu.Lock()
		out[name] = s
		mu.Unlock()
	}

	// HUD — config-driven; live passthrough reachability is covered by the
	// existing /api/hud/* endpoints, so the health view reports configuration.
	hudEnabled := h.loomHUDPassthroughEnabled()
	set("hud", loomSourceHealth{Enabled: hudEnabled, Available: hudEnabled, Detail: h.loomHUDURL()})

	// Plans — live Qdrant reachability via a one-point scroll of the plans
	// collection (the same collection the Projects federation reads).
	wg.Add(1)
	go func() {
		defer wg.Done()
		s := loomSourceHealth{Enabled: true, Detail: qdrantPlansCollection}
		if pts, err := h.qdrant.Scroll(probeCtx, qdrantPlansCollection, nil, 1); err == nil {
			s.Available = true
			if len(pts) == 0 {
				s.Detail = qdrantPlansCollection + " (empty)"
			}
		} else {
			s.Detail = err.Error()
		}
		set("plans", s)
	}()

	// Mills — live /api/mills/status reachability against loom-mills-operator.
	wg.Add(1)
	go func() {
		defer wg.Done()
		enabled := h.loomMillsEnabled()
		s := loomSourceHealth{Enabled: enabled}
		if enabled {
			if err := h.millsClient.Healthy(probeCtx); err == nil {
				s.Available = true
			} else {
				s.Detail = err.Error()
			}
		}
		set("mills", s)
	}()

	// Flightdeck — live /api/v2/board/summary reachability (proves API + auth).
	wg.Add(1)
	go func() {
		defer wg.Done()
		enabled := h.loomFlightdeckEnabled()
		s := loomSourceHealth{Enabled: enabled}
		if enabled {
			if err := h.flightdeckClient.Healthy(probeCtx); err == nil {
				s.Available = true
			} else {
				s.Detail = err.Error()
			}
		}
		set("flightdeck", s)
	}()

	wg.Wait()
	return map[string]any{
		"sources":     out,
		"generatedAt": time.Now().UTC().Format(time.RFC3339),
	}
}

// loomMillsEnabled reports whether the mills operator is configured and not
// feature-flagged off.
func (h *Handler) loomMillsEnabled() bool {
	return h != nil && h.cfg != nil && !h.cfg.Mills.Disabled && h.millsClient.Enabled()
}

// loomFlightdeckEnabled reports whether flightdeck federation is configured.
func (h *Handler) loomFlightdeckEnabled() bool {
	return h != nil && h.cfg != nil && !h.cfg.Flightdeck.Disabled && h.flightdeckClient.Enabled()
}
