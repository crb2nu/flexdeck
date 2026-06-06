package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/flexinfer/flexdeck/internal/config"
)

func TestModelCacheHandlersReturnUnavailableWhenK8sMissing(t *testing.T) {
	h := &Handler{cfg: &config.Config{}}

	handlers := map[string]http.HandlerFunc{
		"list":    h.ModelCacheList,
		"get":     h.ModelCacheGet,
		"watch":   h.ModelCacheWatchSSE,
		"podLogs": h.ModelCachePodLogs,
	}

	for name, fn := range handlers {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/modelcache/"+name, nil)
			w := httptest.NewRecorder()
			fn(w, req)
			if w.Code != http.StatusServiceUnavailable {
				t.Fatalf("expected 503 with no k8s client, got %d", w.Code)
			}
		})
	}
}
