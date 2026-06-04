package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAgentsUsage(t *testing.T) {
	t.Run("disabled", func(t *testing.T) {
		h := newAgentsTestHandler(t, true)
		w := httptest.NewRecorder()

		h.AgentsUsage(w, requestWithID(http.MethodGet, "/api/agents/alpha/usage", "alpha", nil))

		if w.Code != http.StatusServiceUnavailable {
			t.Fatalf("expected 503, got %d", w.Code)
		}
	})

	t.Run("returns zero usage before first request", func(t *testing.T) {
		h := newAgentsTestHandler(t, false)
		seedAgent(t, h, "alpha")
		w := httptest.NewRecorder()

		h.AgentsUsage(w, requestWithID(http.MethodGet, "/api/agents/alpha/usage", "alpha", nil))

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}
		resp := decodeBody(t, w)
		if resp["agent_id"] != "alpha" || resp["request_count"] != float64(0) {
			t.Fatalf("expected zero usage for alpha, got %+v", resp)
		}
	})

	t.Run("returns recorded usage", func(t *testing.T) {
		h := newAgentsTestHandler(t, false)
		seedAgent(t, h, "alpha")
		h.agentsRegistry.RecordUsage("alpha", 42, 250)
		w := httptest.NewRecorder()

		h.AgentsUsage(w, requestWithID(http.MethodGet, "/api/agents/alpha/usage", "alpha", nil))

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}
		resp := decodeBody(t, w)
		if resp["request_count"] != float64(1) || resp["total_tokens"] != float64(42) || resp["total_latency_ms"] != float64(250) {
			t.Fatalf("expected recorded usage counters, got %+v", resp)
		}
	})
}

func TestAgentsStream_DisabledReturnsPlainText503(t *testing.T) {
	h := newAgentsTestHandler(t, true)
	w := httptest.NewRecorder()

	h.AgentsStream(w, requestWithID(http.MethodPost, "/api/agents/alpha/stream", "alpha", mustJSON(t, map[string]any{})))

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "agents feature disabled") {
		t.Fatalf("expected disabled error body, got %q", w.Body.String())
	}
}

func TestAgentBuilderDisabledHandlers(t *testing.T) {
	h := newAgentsTestHandler(t, true)

	t.Run("chat", func(t *testing.T) {
		w := httptest.NewRecorder()
		h.AgentBuilderChat(w, httptest.NewRequest(http.MethodPost, "/api/agents/builder/chat", strings.NewReader(`{"query":"hello"}`)))

		if w.Code != http.StatusServiceUnavailable {
			t.Fatalf("expected 503, got %d", w.Code)
		}
	})

	t.Run("info", func(t *testing.T) {
		w := httptest.NewRecorder()
		h.AgentBuilderInfo(w, httptest.NewRequest(http.MethodGet, "/api/agents/builder/info", nil))

		if w.Code != http.StatusServiceUnavailable {
			t.Fatalf("expected 503, got %d", w.Code)
		}
	})
}
