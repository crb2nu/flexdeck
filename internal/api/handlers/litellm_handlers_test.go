package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/flexinfer/flexdeck/internal/litellm"
)

func TestLiteLLMHealthUsesClientProbes(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("expected bearer token, got %q", r.Header.Get("Authorization"))
		}
		switch r.URL.Path {
		case "/health":
			http.Error(w, "not ready", http.StatusServiceUnavailable)
		case "/health/readiness":
			w.WriteHeader(http.StatusOK)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	h := &Handler{
		cfg:     &config.Config{LiteLLM: config.LiteLLMConfig{URL: server.URL, APIKey: "test-key"}},
		litellm: litellm.NewClient(server.URL, "test-key"),
	}
	req := httptest.NewRequest(http.MethodGet, "/api/litellm/health", nil)
	w := httptest.NewRecorder()

	h.LiteLLMHealth(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var got struct {
		Healthy bool `json:"healthy"`
	}
	if err := json.NewDecoder(w.Body).Decode(&got); err != nil {
		t.Fatalf("decode health response: %v", err)
	}
	if !got.Healthy {
		t.Fatalf("expected healthy response, got %+v", got)
	}
}

func TestLiteLLMModelsReturnsAdminModelInfo(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/model/info" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"data":[{"model_name":"llama","litellm_params":{"model":"openai/llama"},"model_info":{"mode":"chat"}}]}`)
	}))
	defer server.Close()

	h := &Handler{
		cfg:     &config.Config{LiteLLM: config.LiteLLMConfig{URL: server.URL}},
		litellm: litellm.NewClient(server.URL, ""),
	}
	req := httptest.NewRequest(http.MethodGet, "/api/litellm/models", nil)
	w := httptest.NewRecorder()

	h.LiteLLMModels(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"model_name":"llama"`) {
		t.Fatalf("expected model info payload, got %s", w.Body.String())
	}
}

func TestLiteLLMRouterAggregatesHealthModelsAndInfo(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/health":
			w.WriteHeader(http.StatusOK)
		case "/v1/models":
			_, _ = fmt.Fprint(w, `{"data":[{"id":"llama"},{"id":""},{"id":"mistral"}]}`)
		case "/model/info":
			_, _ = fmt.Fprint(w, `{"data":[{"model_name":"llama"},{"model_name":"mistral"}]}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	h := &Handler{
		cfg:     &config.Config{LiteLLM: config.LiteLLMConfig{URL: server.URL}},
		litellm: litellm.NewClient(server.URL, ""),
	}
	req := httptest.NewRequest(http.MethodGet, "/api/litellm/router", nil)
	w := httptest.NewRecorder()

	h.LiteLLMRouter(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var got struct {
		Healthy   bool             `json:"healthy"`
		Models    []string         `json:"models"`
		ModelInfo []map[string]any `json:"modelInfo"`
	}
	if err := json.NewDecoder(w.Body).Decode(&got); err != nil {
		t.Fatalf("decode router response: %v", err)
	}
	if !got.Healthy {
		t.Fatalf("expected router healthy, got %+v", got)
	}
	if len(got.Models) != 2 || got.Models[0] != "llama" || got.Models[1] != "mistral" {
		t.Fatalf("unexpected models: %+v", got.Models)
	}
	if len(got.ModelInfo) != 2 || got.ModelInfo[0]["model_name"] != "llama" {
		t.Fatalf("unexpected model info: %+v", got.ModelInfo)
	}
}
