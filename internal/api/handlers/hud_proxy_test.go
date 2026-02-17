package handlers

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/go-chi/chi/v5"
)

func TestHUDClaimsAndWorkflowCancelProxy(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/claims":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[{"agentId":"codex","filePath":"internal/api/router.go"}]`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/workflows/wf-1/cancel":
			w.Header().Set("Content-Type", "application/json")
			body := new(bytes.Buffer)
			_, _ = body.ReadFrom(r.Body)
			if !strings.Contains(body.String(), "operator-stop") {
				http.Error(w, "missing comment", http.StatusBadRequest)
				return
			}
			_, _ = w.Write([]byte(`{"ok":true}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	h := &Handler{
		cfg: &config.Config{
			LoomHUD: config.LoomHUDConfig{URL: upstream.URL},
		},
	}

	router := chi.NewRouter()
	router.Get("/api/hud/claims", h.HUDClaims)
	router.Post("/api/hud/workflows/{id}/cancel", h.HUDWorkflowCancel)

	t.Run("claims", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/hud/claims", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), `"agentId":"codex"`) {
			t.Fatalf("unexpected claims payload: %s", rec.Body.String())
		}
	})

	t.Run("cancel", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/hud/workflows/wf-1/cancel", strings.NewReader(`{"comment":"operator-stop"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), `"ok":true`) {
			t.Fatalf("unexpected cancel payload: %s", rec.Body.String())
		}
	})
}
