package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/flexinfer/flexdeck/internal/config"
)

func TestGrafanaDashboards_EmptyURL(t *testing.T) {
	t.Parallel()

	h := &Handler{
		cfg: &config.Config{
			Grafana: config.GrafanaConfig{
				URL:      "",
				Token:    "some-token",
				Disabled: false,
			},
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/grafana/dashboards", nil)
	rr := httptest.NewRecorder()
	h.GrafanaDashboards(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	var got []any
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(got) != 0 {
		t.Fatalf("expected empty list, got %d items", len(got))
	}
}

func TestGrafanaDashboards_Disabled(t *testing.T) {
	t.Parallel()

	h := &Handler{
		cfg: &config.Config{
			Grafana: config.GrafanaConfig{
				URL:      "http://grafana",
				Token:    "some-token",
				Disabled: true,
			},
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/grafana/dashboards", nil)
	rr := httptest.NewRecorder()
	h.GrafanaDashboards(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	var got []any
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(got) != 0 {
		t.Fatalf("expected empty list, got %d items", len(got))
	}
}

func TestGrafanaDashboards_Anonymous(t *testing.T) {
	t.Parallel()

	// Mock Grafana server
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			t.Errorf("expected no Authorization header for anonymous access")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"uid":"123", "title":"Dash"}]`))
	}))
	defer ts.Close()

	h := &Handler{
		cfg: &config.Config{
			Grafana: config.GrafanaConfig{
				URL:      ts.URL,
				Token:    "", // Empty token for anonymous access
				Disabled: false,
			},
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/grafana/dashboards", nil)
	rr := httptest.NewRecorder()
	h.GrafanaDashboards(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var got []map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(got) != 1 || got[0]["uid"] != "123" {
		t.Fatalf("expected 1 dashboard with uid 123, got %+v", got)
	}
}

func TestGrafanaDashboards_FallbackToAnonymousWhenTokenRejected(t *testing.T) {
	t.Parallel()

	requestCount := 0
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		authHeader := r.Header.Get("Authorization")
		if requestCount == 1 {
			if authHeader == "" {
				t.Fatalf("expected token-authenticated request first")
			}
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		if authHeader != "" {
			t.Fatalf("expected anonymous retry without Authorization header, got %q", authHeader)
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"uid":"fallback", "title":"Dash"}]`))
	}))
	defer ts.Close()

	h := &Handler{
		cfg: &config.Config{
			Grafana: config.GrafanaConfig{
				URL:      ts.URL,
				Token:    "bad-token",
				Disabled: false,
			},
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/grafana/dashboards", nil)
	rr := httptest.NewRecorder()
	h.GrafanaDashboards(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if requestCount != 2 {
		t.Fatalf("expected two requests (auth + anonymous retry), got %d", requestCount)
	}

	var got []map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(got) != 1 || got[0]["uid"] != "fallback" {
		t.Fatalf("expected fallback dashboard payload, got %+v", got)
	}
}
