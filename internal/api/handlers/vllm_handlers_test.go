package handlers

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/flexinfer/flexdeck/internal/config"
)

func TestVLLMListAndGetModelsProxyUpstream(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/models":
			_, _ = fmt.Fprint(w, `{"data":[{"id":"llama"}]}`)
		case "/v1/models/llama-chat":
			_, _ = fmt.Fprint(w, `{"id":"llama-chat","owned_by":"flexinfer"}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	h := &Handler{cfg: &config.Config{VLLM: config.VLLMConfig{URL: server.URL}}}

	t.Run("list", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/vllm/models", nil)
		w := httptest.NewRecorder()
		h.VLLMListModels(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}
		if !strings.Contains(w.Body.String(), `"id":"llama"`) {
			t.Fatalf("expected model list, got %s", w.Body.String())
		}
	})

	t.Run("get", func(t *testing.T) {
		req := requestWithVLLMParams(http.MethodGet, "/api/vllm/models/llama-chat", nil, map[string]string{"model": "llama-chat"})
		w := httptest.NewRecorder()
		h.VLLMGetModel(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}
		if !strings.Contains(w.Body.String(), `"owned_by":"flexinfer"`) {
			t.Fatalf("expected model detail, got %s", w.Body.String())
		}
	})
}

func TestVLLMHealthReportsUpstreamStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	h := &Handler{cfg: &config.Config{VLLM: config.VLLMConfig{URL: server.URL}}}
	req := httptest.NewRequest(http.MethodGet, "/api/vllm/health", nil)
	w := httptest.NewRecorder()

	h.VLLMHealth(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"healthy":true`) || !strings.Contains(w.Body.String(), `"status":200`) {
		t.Fatalf("expected healthy status payload, got %s", w.Body.String())
	}
}

func TestVLLMCompletionProxiesForwardBodiesAndHeaders(t *testing.T) {
	seen := map[string]string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		seen[r.URL.Path] = string(body)
		if got := r.Header.Get("Content-Type"); got != "application/json" {
			t.Errorf("expected content-type forwarded, got %q", got)
		}
		if r.URL.Path == "/v1/chat/completions" && r.Header.Get("Authorization") != "Bearer user-token" {
			t.Errorf("expected authorization forwarded, got %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"path":%q}`, r.URL.Path)
	}))
	defer server.Close()

	h := &Handler{cfg: &config.Config{VLLM: config.VLLMConfig{URL: server.URL}}}

	chatReq := httptest.NewRequest(http.MethodPost, "/api/vllm/chat/completions", strings.NewReader(`{"messages":[]}`))
	chatReq.Header.Set("Content-Type", "application/json")
	chatReq.Header.Set("Authorization", "Bearer user-token")
	chatW := httptest.NewRecorder()
	h.VLLMChatCompletions(chatW, chatReq)
	if chatW.Code != http.StatusOK {
		t.Fatalf("expected chat 200, got %d: %s", chatW.Code, chatW.Body.String())
	}

	completionReq := httptest.NewRequest(http.MethodPost, "/api/vllm/completions", strings.NewReader(`{"prompt":"hi"}`))
	completionReq.Header.Set("Content-Type", "application/json")
	completionW := httptest.NewRecorder()
	h.VLLMCompletions(completionW, completionReq)
	if completionW.Code != http.StatusOK {
		t.Fatalf("expected completion 200, got %d: %s", completionW.Code, completionW.Body.String())
	}

	if seen["/v1/chat/completions"] != `{"messages":[]}` {
		t.Fatalf("chat body was not forwarded: %q", seen["/v1/chat/completions"])
	}
	if seen["/v1/completions"] != `{"prompt":"hi"}` {
		t.Fatalf("completion body was not forwarded: %q", seen["/v1/completions"])
	}
}

func TestVLLMHandlersDisabledAndMissingModel(t *testing.T) {
	h := &Handler{cfg: &config.Config{}}

	handlers := map[string]http.HandlerFunc{
		"listModels":      h.VLLMListModels,
		"chatCompletions": h.VLLMChatCompletions,
		"completions":     h.VLLMCompletions,
	}
	for name, fn := range handlers {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/vllm/"+name, nil)
			w := httptest.NewRecorder()
			fn(w, req)
			if w.Code != http.StatusServiceUnavailable {
				t.Fatalf("expected 503 when disabled, got %d", w.Code)
			}
		})
	}

	enabled := &Handler{cfg: &config.Config{VLLM: config.VLLMConfig{URL: "http://vllm.invalid"}}}
	req := httptest.NewRequest(http.MethodGet, "/api/vllm/models/", nil)
	w := httptest.NewRecorder()
	enabled.VLLMGetModel(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing model id, got %d", w.Code)
	}
}

func requestWithVLLMParams(method, target string, body []byte, params map[string]string) *http.Request {
	req := httptest.NewRequest(method, target, bytes.NewReader(body))
	routeCtx := chi.NewRouteContext()
	for key, value := range params {
		routeCtx.URLParams.Add(key, value)
	}
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx))
}
