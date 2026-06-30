package loomupstream

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMillsClientGetAndHealthy(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/mills/status":
			_, _ = w.Write([]byte(`{"autonomy_ready":true}`))
		case "/api/mills/backlog":
			_, _ = w.Write([]byte(`[{"ID":"X"}]`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	c := NewMillsClient(srv.URL+"/", "", srv.Client())
	if !c.Enabled() {
		t.Fatal("expected enabled client")
	}
	raw, err := c.Get(context.Background(), "/api/mills/backlog")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if string(raw) != `[{"ID":"X"}]` {
		t.Fatalf("unexpected body: %s", raw)
	}
	if err := c.Healthy(context.Background()); err != nil {
		t.Fatalf("Healthy: %v", err)
	}
}

func TestMillsClientDisabled(t *testing.T) {
	c := NewMillsClient("  ", "", nil)
	if c.Enabled() {
		t.Fatal("expected disabled client for blank URL")
	}
	if _, err := c.Get(context.Background(), "/api/mills/status"); err == nil {
		t.Fatal("expected error from unconfigured client")
	}
}

func TestMillsClientNon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer srv.Close()

	c := NewMillsClient(srv.URL, "", srv.Client())
	if err := c.Healthy(context.Background()); err == nil {
		t.Fatal("expected error on non-200 status")
	}
}
