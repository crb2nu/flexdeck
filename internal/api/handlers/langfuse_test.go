package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/flexinfer/flexdeck/internal/config"
)

func TestLangfuseDataRequestsUseSeparateClientFromHealthChecks(t *testing.T) {
	previousDataClient := langfuseDataClient
	previousHealthClient := langfuseHealthClient
	defer func() {
		langfuseDataClient = previousDataClient
		langfuseHealthClient = previousHealthClient
	}()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(50 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"data":[]}`))
	}))
	defer server.Close()

	langfuseDataClient = &http.Client{Timeout: 150 * time.Millisecond}
	langfuseHealthClient = &http.Client{Timeout: 10 * time.Millisecond}

	handler := &Handler{
		cfg: &config.Config{
			Langfuse: config.LangfuseConfig{URL: server.URL},
		},
	}

	if _, _, err := handler.langfuseRequest(context.Background(), "/api/public/metrics/daily"); err != nil {
		t.Fatalf("expected langfuseRequest to succeed with the data client, got %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/api/langfuse/health", nil)
	recorder := httptest.NewRecorder()
	handler.LangfuseHealth(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected LangfuseHealth to return 200, got %d", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), `"healthy":false`) {
		t.Fatalf("expected LangfuseHealth to reflect the short-timeout failure, got %s", recorder.Body.String())
	}
}
