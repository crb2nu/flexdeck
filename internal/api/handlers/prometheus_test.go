package handlers

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/flexinfer/flexdeck/internal/cache"
	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/redis/go-redis/v9"
)

func newPromCache(t *testing.T) *cache.Cache {
	t.Helper()

	server, err := miniredis.Run()
	if err != nil {
		t.Fatalf("failed to start miniredis: %v", err)
	}
	t.Cleanup(server.Close)

	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() {
		if closeErr := client.Close(); closeErr != nil {
			t.Fatalf("failed to close redis client: %v", closeErr)
		}
	})

	return cache.New(client, "flexdeck:test:")
}

func TestPrometheusHandlers(t *testing.T) {
	var healthyCalls atomic.Int32
	var queryCalls atomic.Int32
	var queryRangeCalls atomic.Int32

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.Contains(r.URL.Path, "/healthy"):
			healthyCalls.Add(1)
			w.WriteHeader(http.StatusOK)
		case strings.Contains(r.URL.Path, "/query_range"):
			queryRangeCalls.Add(1)
			_, _ = fmt.Fprintf(w, `{"status":"success","data":{"resultType":"matrix","result":[],"query":"%s"}}`, r.URL.RawQuery)
		case strings.Contains(r.URL.Path, "/query"):
			queryCalls.Add(1)
			_, _ = fmt.Fprintf(w, `{"status":"success","data":{"resultType":"vector","result":[],"query":"%s"}}`, r.URL.RawQuery)
		default:
			http.NotFound(w, r)
		}
	}))
	defer ts.Close()

	cfg := &config.Config{}
	cfg.Prom.URL = ts.URL
	h := &Handler{cfg: cfg, cache: newPromCache(t)}

	t.Run("PromHealth", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/prom/health", nil)
		rr := httptest.NewRecorder()
		h.PromHealth(rr, req)

		if rr.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rr.Code)
		}
		if healthyCalls.Load() != 1 {
			t.Fatalf("expected a single health call, got %d", healthyCalls.Load())
		}
	})

	t.Run("PromQueryUsesCacheWithinSameBucket", func(t *testing.T) {
		req1 := httptest.NewRequest(http.MethodGet, "/api/prom/query?query=up", nil)
		rr1 := httptest.NewRecorder()
		h.PromQuery(rr1, req1)

		req2 := httptest.NewRequest(http.MethodGet, "/api/prom/query?query=up", nil)
		rr2 := httptest.NewRecorder()
		h.PromQuery(rr2, req2)

		if rr1.Code != http.StatusOK || rr2.Code != http.StatusOK {
			t.Fatalf("expected 200 responses, got %d and %d", rr1.Code, rr2.Code)
		}
		if queryCalls.Load() != 1 {
			t.Fatalf("expected query upstream call to be cached, got %d", queryCalls.Load())
		}
	})

	t.Run("PromQueryRangeNormalizesToStepBuckets", func(t *testing.T) {
		req1 := httptest.NewRequest(http.MethodGet, "/api/prom/query_range?query=up&start=119&end=239&step=60", nil)
		rr1 := httptest.NewRecorder()
		h.PromQueryRange(rr1, req1)

		req2 := httptest.NewRequest(http.MethodGet, "/api/prom/query_range?query=up&start=100&end=220&step=1m", nil)
		rr2 := httptest.NewRecorder()
		h.PromQueryRange(rr2, req2)

		if rr1.Code != http.StatusOK || rr2.Code != http.StatusOK {
			t.Fatalf("expected 200 responses, got %d and %d", rr1.Code, rr2.Code)
		}
		if queryRangeCalls.Load() != 1 {
			t.Fatalf("expected query_range upstream call to be cached, got %d", queryRangeCalls.Load())
		}
	})

	t.Run("PromDisabled", func(t *testing.T) {
		hDisabled := &Handler{cfg: &config.Config{}}
		hDisabled.cfg.Prom.Disabled = true

		req := httptest.NewRequest(http.MethodGet, "/api/prom/health", nil)
		rr := httptest.NewRecorder()
		hDisabled.PromHealth(rr, req)

		if rr.Code != http.StatusServiceUnavailable {
			t.Fatalf("expected 503 for disabled prometheus, got %d", rr.Code)
		}
	})
}
