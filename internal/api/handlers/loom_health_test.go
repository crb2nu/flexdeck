package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/flexinfer/flexdeck/internal/loomupstream"
	"github.com/flexinfer/flexdeck/internal/qdrant"
)

func TestCollectLoomHealthAllUp(t *testing.T) {
	mills := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/mills/status" {
			_, _ = w.Write([]byte(`{"autonomy_ready":true}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer mills.Close()

	fd := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v2/board/summary" {
			_, _ = w.Write([]byte(`{"wait_minutes_today":0,"blocked_now_count":0}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer fd.Close()

	h := &Handler{
		cfg: &config.Config{
			LoomHUD:    config.LoomHUDConfig{URL: "http://hud.example"},
			Mills:      config.MillsConfig{URL: mills.URL},
			Flightdeck: config.FlightdeckConfig{URL: fd.URL},
		},
		qdrant: &fakeQdrant{byCollection: map[string][]qdrant.Point{
			qdrantPlansCollection: make([]qdrant.Point, 1),
		}},
		millsClient:      loomupstream.NewMillsClient(mills.URL, "", mills.Client()),
		flightdeckClient: loomupstream.NewFlightdeckClient(fd.URL, "", fd.Client()),
	}

	res := h.collectLoomHealth(context.Background())
	sources, ok := res["sources"].(map[string]loomSourceHealth)
	if !ok {
		t.Fatalf("sources missing or wrong type: %#v", res["sources"])
	}

	for _, name := range []string{"hud", "plans", "mills", "flightdeck"} {
		if !sources[name].Enabled || !sources[name].Available {
			t.Errorf("%s expected enabled+available, got %+v", name, sources[name])
		}
	}
}

func TestCollectLoomHealthDegraded(t *testing.T) {
	h := &Handler{
		cfg: &config.Config{
			LoomHUD:    config.LoomHUDConfig{Disabled: true},
			Mills:      config.MillsConfig{Disabled: true},
			Flightdeck: config.FlightdeckConfig{Disabled: true},
		},
		qdrant: &fakeQdrant{errCollections: map[string]bool{
			qdrantPlansCollection: true,
		}},
		millsClient: loomupstream.NewMillsClient("", "", nil),
	}

	res := h.collectLoomHealth(context.Background())
	sources := res["sources"].(map[string]loomSourceHealth)

	if sources["hud"].Enabled {
		t.Errorf("hud should be disabled, got %+v", sources["hud"])
	}
	if sources["mills"].Enabled {
		t.Errorf("mills should be disabled, got %+v", sources["mills"])
	}
	if sources["flightdeck"].Enabled {
		t.Errorf("flightdeck should be disabled, got %+v", sources["flightdeck"])
	}
	// Plans probe ran but Qdrant errored — enabled, not available, detail set.
	if !sources["plans"].Enabled || sources["plans"].Available || sources["plans"].Detail == "" {
		t.Errorf("plans expected enabled+unavailable+detail, got %+v", sources["plans"])
	}
}
