package litellm

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClient_Health(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer ts.Close()

	client := NewClient(ts.URL, "test-key")
	ok, err := client.Health(context.Background())
	if err != nil || !ok {
		t.Errorf("expected health ok, got %v, err: %v", ok, err)
	}
}

func TestClient_ListModels(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if _, err := fmt.Fprint(w, `{"data": [{"id": "gpt-4"}, {"id": "claude-3"}]}`); err != nil {
			t.Errorf("write response: %v", err)
		}
	}))
	defer ts.Close()

	client := NewClient(ts.URL, "")
	models, err := client.ListModels(context.Background())
	if err != nil {
		t.Fatalf("ListModels failed: %v", err)
	}

	if len(models) != 2 || models[0] != "gpt-4" || models[1] != "claude-3" {
		t.Errorf("unexpected models: %v", models)
	}
}

func TestClient_ScrapeMetrics(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := fmt.Fprint(w, `
# HELP litellm_total_tokens_metric Total number of tokens processed
# TYPE litellm_total_tokens_metric counter
litellm_total_tokens_metric{model="gpt-4"} 1500.0
litellm_total_tokens_metric{requested_model="claude-3"} 2500.0
`); err != nil {
			t.Errorf("write response: %v", err)
		}
	}))
	defer ts.Close()

	client := NewClient(ts.URL, "")
	metrics, err := client.ScrapeMetrics(context.Background())
	if err != nil {
		t.Fatalf("ScrapeMetrics failed: %v", err)
	}

	if len(metrics) != 2 {
		t.Fatalf("expected 2 metrics, got %d", len(metrics))
	}

	foundGPT4 := false
	for _, m := range metrics {
		if m.Model == "gpt-4" {
			foundGPT4 = true
			if m.TotalTokens != 1500 {
				t.Errorf("gpt-4 expected 1500 tokens, got %f", m.TotalTokens)
			}
		}
	}
	if !foundGPT4 {
		t.Errorf("gpt-4 metric not found")
	}
}
