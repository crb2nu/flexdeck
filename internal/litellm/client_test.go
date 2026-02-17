package litellm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestHealthUsesPrimaryEndpoint(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client := NewClient(server.URL, "")
	healthy, err := client.Health(context.Background())
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if !healthy {
		t.Fatalf("expected healthy=true")
	}
}

func TestHealthFallsBackToModelsEndpoint(t *testing.T) {
	t.Parallel()

	calledModels := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/health":
			w.WriteHeader(http.StatusGatewayTimeout)
		case "/health/readiness", "/health/liveliness":
			w.WriteHeader(http.StatusNotFound)
		case "/v1/models":
			calledModels = true
			w.WriteHeader(http.StatusOK)
		default:
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer server.Close()

	client := NewClient(server.URL, "")
	healthy, err := client.Health(context.Background())
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if !healthy {
		t.Fatalf("expected healthy=true")
	}
	if !calledModels {
		t.Fatalf("expected /v1/models fallback to be called")
	}
}

func TestHealthReturnsErrorWhenAllProbesFail(t *testing.T) {
	t.Parallel()

	client := NewClient("http://127.0.0.1:1", "")
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	healthy, err := client.Health(ctx)
	if err == nil {
		t.Fatalf("expected error when all probes fail")
	}
	if healthy {
		t.Fatalf("expected healthy=false")
	}
}
