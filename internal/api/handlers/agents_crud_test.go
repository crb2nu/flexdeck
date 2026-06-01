package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/flexinfer/flexdeck/internal/agents"
	"github.com/flexinfer/flexdeck/internal/config"
)

// newAgentsTestHandler builds a Handler backed by a fresh, temp-dir-backed agents
// registry. When disabled is true the agents feature is turned off so the
// feature-gated handlers exercise their unavailable paths. hudClient and
// agentsProxy are intentionally left nil so no live external dependency is hit.
func newAgentsTestHandler(t *testing.T, disabled bool) *Handler {
	t.Helper()

	cfg := &config.Config{
		Agents: config.AgentsConfig{
			Disabled:     disabled,
			RegistryPath: filepath.Join(t.TempDir(), "agents.json"),
		},
	}

	reg, err := agents.NewRegistry(cfg.Agents)
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}

	return &Handler{cfg: cfg, agentsRegistry: reg}
}

// requestWithID returns an *http.Request carrying the chi "id" URL param so
// handlers that call chi.URLParam(r, "id") resolve it without a full router.
func requestWithID(method, target, id string, body []byte) *http.Request {
	var req *http.Request
	if body != nil {
		req = httptest.NewRequest(method, target, bytes.NewReader(body))
	} else {
		req = httptest.NewRequest(method, target, nil)
	}
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", id)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return b
}

func decodeBody(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v (body=%s)", err, w.Body.String())
	}
	return resp
}

func seedAgent(t *testing.T, h *Handler, id string) {
	t.Helper()
	if err := h.agentsRegistry.Register(&agents.Agent{
		ID:   id,
		Name: id + "-name",
		URL:  "http://example.test/" + id,
		Type: agents.AgentTypeLangGraph,
	}); err != nil {
		t.Fatalf("seed agent %s: %v", id, err)
	}
}

func TestAgentsList(t *testing.T) {
	t.Run("empty registry", func(t *testing.T) {
		h := newAgentsTestHandler(t, false)
		req := httptest.NewRequest(http.MethodGet, "/api/agents", nil)
		w := httptest.NewRecorder()

		h.AgentsList(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}
		resp := decodeBody(t, w)
		// An empty registry yields a nil slice, which marshals to JSON null;
		// a populated one yields an array. Accept either shape with zero items.
		switch v := resp["agents"].(type) {
		case nil:
			// ok: no agents
		case []any:
			if len(v) != 0 {
				t.Fatalf("expected empty list, got %d", len(v))
			}
		default:
			t.Fatalf("expected null or array for agents, got %T", resp["agents"])
		}
	})

	t.Run("populated registry", func(t *testing.T) {
		h := newAgentsTestHandler(t, false)
		seedAgent(t, h, "alpha")
		seedAgent(t, h, "beta")

		req := httptest.NewRequest(http.MethodGet, "/api/agents", nil)
		w := httptest.NewRecorder()

		h.AgentsList(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}
		resp := decodeBody(t, w)
		if list, _ := resp["agents"].([]any); len(list) != 2 {
			t.Fatalf("expected 2 agents, got %d", len(list))
		}
	})
}

func TestAgentsGet(t *testing.T) {
	h := newAgentsTestHandler(t, false)
	seedAgent(t, h, "alpha")

	t.Run("found", func(t *testing.T) {
		w := httptest.NewRecorder()
		h.AgentsGet(w, requestWithID(http.MethodGet, "/api/agents/alpha", "alpha", nil))

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}
		if resp := decodeBody(t, w); resp["id"] != "alpha" {
			t.Fatalf("expected id alpha, got %v", resp["id"])
		}
	})

	t.Run("not found", func(t *testing.T) {
		w := httptest.NewRecorder()
		h.AgentsGet(w, requestWithID(http.MethodGet, "/api/agents/ghost", "ghost", nil))

		if w.Code != http.StatusNotFound {
			t.Fatalf("expected 404, got %d", w.Code)
		}
	})
}

func TestAgentsCreate(t *testing.T) {
	t.Run("feature disabled", func(t *testing.T) {
		h := newAgentsTestHandler(t, true)
		w := httptest.NewRecorder()
		body := mustJSON(t, agents.Agent{ID: "x", Name: "x", URL: "http://x"})
		h.AgentsCreate(w, httptest.NewRequest(http.MethodPost, "/api/agents", bytes.NewReader(body)))

		if w.Code != http.StatusServiceUnavailable {
			t.Fatalf("expected 503, got %d", w.Code)
		}
	})

	t.Run("invalid body", func(t *testing.T) {
		h := newAgentsTestHandler(t, false)
		w := httptest.NewRecorder()
		h.AgentsCreate(w, httptest.NewRequest(http.MethodPost, "/api/agents", bytes.NewReader([]byte("{not json"))))

		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", w.Code)
		}
	})

	t.Run("missing required fields", func(t *testing.T) {
		h := newAgentsTestHandler(t, false)
		w := httptest.NewRecorder()
		body := mustJSON(t, agents.Agent{ID: "x"}) // no name/url
		h.AgentsCreate(w, httptest.NewRequest(http.MethodPost, "/api/agents", bytes.NewReader(body)))

		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", w.Code)
		}
	})

	t.Run("duplicate id conflict", func(t *testing.T) {
		h := newAgentsTestHandler(t, false)
		seedAgent(t, h, "dup")
		w := httptest.NewRecorder()
		body := mustJSON(t, agents.Agent{ID: "dup", Name: "dup", URL: "http://dup"})
		h.AgentsCreate(w, httptest.NewRequest(http.MethodPost, "/api/agents", bytes.NewReader(body)))

		if w.Code != http.StatusConflict {
			t.Fatalf("expected 409, got %d", w.Code)
		}
	})

	t.Run("success defaults type", func(t *testing.T) {
		h := newAgentsTestHandler(t, false)
		w := httptest.NewRecorder()
		body := mustJSON(t, agents.Agent{ID: "new", Name: "new", URL: "http://new"})
		h.AgentsCreate(w, httptest.NewRequest(http.MethodPost, "/api/agents", bytes.NewReader(body)))

		if w.Code != http.StatusCreated {
			t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
		}
		if resp := decodeBody(t, w); resp["type"] != string(agents.AgentTypeLangGraph) {
			t.Fatalf("expected default type %q, got %v", agents.AgentTypeLangGraph, resp["type"])
		}
		if _, err := h.agentsRegistry.Get("new"); err != nil {
			t.Fatalf("expected agent persisted in registry: %v", err)
		}
	})
}

func TestAgentsUpdate(t *testing.T) {
	t.Run("feature disabled", func(t *testing.T) {
		h := newAgentsTestHandler(t, true)
		w := httptest.NewRecorder()
		body := mustJSON(t, agents.Agent{Name: "n", URL: "http://n"})
		h.AgentsUpdate(w, requestWithID(http.MethodPut, "/api/agents/x", "x", body))

		if w.Code != http.StatusServiceUnavailable {
			t.Fatalf("expected 503, got %d", w.Code)
		}
	})

	t.Run("invalid body", func(t *testing.T) {
		h := newAgentsTestHandler(t, false)
		w := httptest.NewRecorder()
		h.AgentsUpdate(w, requestWithID(http.MethodPut, "/api/agents/x", "x", []byte("{bad")))

		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", w.Code)
		}
	})

	t.Run("not found", func(t *testing.T) {
		h := newAgentsTestHandler(t, false)
		w := httptest.NewRecorder()
		body := mustJSON(t, agents.Agent{Name: "n", URL: "http://n"})
		h.AgentsUpdate(w, requestWithID(http.MethodPut, "/api/agents/ghost", "ghost", body))

		if w.Code != http.StatusNotFound {
			t.Fatalf("expected 404, got %d", w.Code)
		}
	})

	t.Run("success", func(t *testing.T) {
		h := newAgentsTestHandler(t, false)
		seedAgent(t, h, "alpha")
		w := httptest.NewRecorder()
		body := mustJSON(t, agents.Agent{Name: "alpha-renamed", URL: "http://alpha2", Type: agents.AgentTypeLangGraph})
		h.AgentsUpdate(w, requestWithID(http.MethodPut, "/api/agents/alpha", "alpha", body))

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}
		got, err := h.agentsRegistry.Get("alpha")
		if err != nil {
			t.Fatalf("get updated agent: %v", err)
		}
		if got.Name != "alpha-renamed" {
			t.Fatalf("expected updated name, got %q", got.Name)
		}
	})
}

func TestAgentsDelete(t *testing.T) {
	t.Run("feature disabled", func(t *testing.T) {
		h := newAgentsTestHandler(t, true)
		w := httptest.NewRecorder()
		h.AgentsDelete(w, requestWithID(http.MethodDelete, "/api/agents/x", "x", nil))

		if w.Code != http.StatusServiceUnavailable {
			t.Fatalf("expected 503, got %d", w.Code)
		}
	})

	t.Run("not found", func(t *testing.T) {
		h := newAgentsTestHandler(t, false)
		w := httptest.NewRecorder()
		h.AgentsDelete(w, requestWithID(http.MethodDelete, "/api/agents/ghost", "ghost", nil))

		if w.Code != http.StatusNotFound {
			t.Fatalf("expected 404, got %d", w.Code)
		}
	})

	t.Run("success", func(t *testing.T) {
		h := newAgentsTestHandler(t, false)
		seedAgent(t, h, "alpha")
		w := httptest.NewRecorder()
		h.AgentsDelete(w, requestWithID(http.MethodDelete, "/api/agents/alpha", "alpha", nil))

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}
		if resp := decodeBody(t, w); resp["deleted"] != "alpha" {
			t.Fatalf("expected deleted=alpha, got %v", resp["deleted"])
		}
		if _, err := h.agentsRegistry.Get("alpha"); err == nil {
			t.Fatal("expected agent to be removed from registry")
		}
	})
}

func TestAgentsGraph(t *testing.T) {
	t.Run("empty registry yields empty graph", func(t *testing.T) {
		h := newAgentsTestHandler(t, false)
		w := httptest.NewRecorder()
		h.AgentsGraph(w, httptest.NewRequest(http.MethodGet, "/api/agents/graph", nil))

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}
		resp := decodeBody(t, w)
		if nodes, _ := resp["nodes"].([]any); len(nodes) != 0 {
			t.Fatalf("expected 0 nodes, got %d", len(nodes))
		}
		if edges, _ := resp["edges"].([]any); len(edges) != 0 {
			t.Fatalf("expected 0 edges, got %d", len(edges))
		}
	})

	t.Run("depends_on metadata produces an edge", func(t *testing.T) {
		h := newAgentsTestHandler(t, false)
		if err := h.agentsRegistry.Register(&agents.Agent{
			ID: "x", Name: "x", URL: "http://x", Type: agents.AgentTypeLangGraph,
			Metadata: map[string]any{"depends_on": []string{"y"}},
		}); err != nil {
			t.Fatalf("register x: %v", err)
		}
		seedAgent(t, h, "y")

		w := httptest.NewRecorder()
		h.AgentsGraph(w, httptest.NewRequest(http.MethodGet, "/api/agents/graph", nil))

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}
		resp := decodeBody(t, w)
		if nodes, _ := resp["nodes"].([]any); len(nodes) != 2 {
			t.Fatalf("expected 2 nodes, got %d", len(nodes))
		}
		edges, _ := resp["edges"].([]any)
		if len(edges) != 1 {
			t.Fatalf("expected 1 edge, got %d", len(edges))
		}
		edge, _ := edges[0].(map[string]any)
		if edge["source"] != "x" || edge["target"] != "y" {
			t.Fatalf("expected edge x->y, got %v->%v", edge["source"], edge["target"])
		}
	})

	t.Run("edge to unknown dependency is dropped", func(t *testing.T) {
		h := newAgentsTestHandler(t, false)
		if err := h.agentsRegistry.Register(&agents.Agent{
			ID: "x", Name: "x", URL: "http://x", Type: agents.AgentTypeLangGraph,
			Metadata: map[string]any{"depends_on": []string{"missing"}},
		}); err != nil {
			t.Fatalf("register x: %v", err)
		}

		w := httptest.NewRecorder()
		h.AgentsGraph(w, httptest.NewRequest(http.MethodGet, "/api/agents/graph", nil))

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}
		if edges, _ := decodeBody(t, w)["edges"].([]any); len(edges) != 0 {
			t.Fatalf("expected unknown-target edge dropped, got %d edges", len(edges))
		}
	})
}

func TestExternalAgentsFrameworks_Disabled(t *testing.T) {
	h := newAgentsTestHandler(t, true)
	w := httptest.NewRecorder()
	h.ExternalAgentsFrameworks(w, httptest.NewRequest(http.MethodGet, "/api/agents/external/frameworks", nil))

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", w.Code)
	}
}

func TestAgentsHealth_EmptyRegistry(t *testing.T) {
	h := newAgentsTestHandler(t, false)
	w := httptest.NewRecorder()

	h.AgentsHealth(w, httptest.NewRequest(http.MethodGet, "/api/agents/health", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	resp := decodeBody(t, w)
	health, ok := resp["health"].(map[string]any)
	if !ok {
		t.Fatalf("expected health object, got %T", resp["health"])
	}
	if len(health) != 0 {
		t.Fatalf("expected empty health map for empty registry, got %d", len(health))
	}
}

// The feature-gated proxy/health handlers must refuse work when the feature is
// disabled (or the proxy dependency is absent) instead of dereferencing a nil
// dependency.
func TestAgentsProxyHandlers_DisabledReturn503(t *testing.T) {
	h := newAgentsTestHandler(t, true)

	cases := []struct {
		name   string
		invoke func(w http.ResponseWriter)
	}{
		{"check health", func(w http.ResponseWriter) {
			h.AgentsCheckHealth(w, requestWithID(http.MethodGet, "/api/agents/x/health", "x", nil))
		}},
		{"test", func(w http.ResponseWriter) {
			h.AgentsTest(w, requestWithID(http.MethodPost, "/api/agents/x/test", "x", mustJSON(t, map[string]any{"input": map[string]any{}})))
		}},
		{"invoke", func(w http.ResponseWriter) {
			h.AgentsInvoke(w, requestWithID(http.MethodPost, "/api/agents/x/invoke", "x", mustJSON(t, map[string]any{})))
		}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			tc.invoke(w)
			if w.Code != http.StatusServiceUnavailable {
				t.Fatalf("expected 503, got %d", w.Code)
			}
		})
	}
}
