package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

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

func TestGrafanaDashboards_HTMLResponseRejected(t *testing.T) {
	t.Parallel()

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`<!doctype html><html><body>grafana login</body></html>`))
	}))
	defer ts.Close()

	h := &Handler{
		cfg: &config.Config{
			Grafana: config.GrafanaConfig{
				URL:      ts.URL,
				Token:    "",
				Disabled: false,
			},
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/grafana/dashboards", nil)
	rr := httptest.NewRecorder()
	h.GrafanaDashboards(rr, req)

	if rr.Code != http.StatusBadGateway {
		t.Fatalf("expected status 502, got %d: %s", rr.Code, rr.Body.String())
	}

	var payload map[string]string
	if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode response payload: %v", err)
	}

	errMsg := payload["error"]
	if !strings.Contains(errMsg, "HTML instead of JSON") {
		t.Fatalf("expected HTML error message, got %q", errMsg)
	}
	if strings.Contains(strings.ToLower(errMsg), "<html") {
		t.Fatalf("expected sanitized error message, got %q", errMsg)
	}
}

func TestGrafanaDashboardDetailAndDatasourcesProxyUpstream(t *testing.T) {
	t.Parallel()

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer grafana-token" {
			t.Errorf("expected bearer token, got %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/dashboards/uid/gpu":
			_, _ = w.Write([]byte(`{"dashboard":{"uid":"gpu","title":"GPU"}}`))
		case "/api/datasources":
			_, _ = w.Write([]byte(`[{"uid":"prom","type":"prometheus"}]`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer ts.Close()

	h := &Handler{
		cfg: &config.Config{
			Grafana: config.GrafanaConfig{
				URL:   ts.URL,
				Token: "grafana-token",
			},
		},
	}

	t.Run("dashboard detail", func(t *testing.T) {
		req := requestWithGrafanaParams(http.MethodGet, "/api/grafana/dashboards/gpu", map[string]string{"uid": "gpu"})
		rr := httptest.NewRecorder()
		h.GrafanaDashboardDetail(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d: %s", rr.Code, rr.Body.String())
		}
		if !strings.Contains(rr.Body.String(), `"uid":"gpu"`) {
			t.Fatalf("expected dashboard detail payload, got %s", rr.Body.String())
		}
	})

	t.Run("datasources", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/grafana/datasources", nil)
		rr := httptest.NewRecorder()
		h.GrafanaDatasources(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d: %s", rr.Code, rr.Body.String())
		}
		if !strings.Contains(rr.Body.String(), `"uid":"prom"`) {
			t.Fatalf("expected datasource payload, got %s", rr.Body.String())
		}
	})
}

func requestWithGrafanaParams(method, target string, params map[string]string) *http.Request {
	req := httptest.NewRequest(method, target, nil)
	routeCtx := chi.NewRouteContext()
	for key, value := range params {
		routeCtx.URLParams.Add(key, value)
	}
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx))
}
