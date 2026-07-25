package rbac

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/flexinfer/flexdeck/internal/config"
)

func TestMiddlewareTrustedNetwork(t *testing.T) {
	registry, err := NewRegistry(config.RBACConfig{
		UsersPath:  filepath.Join(t.TempDir(), "users.json"),
		AdminToken: "admin-token",
	})
	if err != nil {
		t.Fatalf("NewRegistry: %v", err)
	}

	m := NewMiddleware(registry, "auth_token", false, time.Hour, "192.168.50.0/24", "10.42.0.0/16")

	var seenUser *User
	handler := m.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenUser = UserFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	serve := func(remoteAddr, xRealIP, bearer string) *httptest.ResponseRecorder {
		seenUser = nil
		req := httptest.NewRequest(http.MethodGet, "/api/pods", nil)
		req.RemoteAddr = remoteAddr
		if xRealIP != "" {
			req.Header.Set("X-Real-IP", xRealIP)
		}
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		return rr
	}

	t.Run("ingress-forwarded LAN client gets network admin", func(t *testing.T) {
		rr := serve("10.42.0.8:8080", "192.168.50.153", "")
		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rr.Code)
		}
		if seenUser == nil || seenUser.AuthVia != "network" || seenUser.Role != RoleAdmin {
			t.Fatalf("expected trusted-network admin user, got %+v", seenUser)
		}
	})

	t.Run("spoofed header from untrusted peer is rejected", func(t *testing.T) {
		if rr := serve("203.0.113.9:31234", "192.168.50.153", ""); rr.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want 401", rr.Code)
		}
	})

	t.Run("valid token still authenticates", func(t *testing.T) {
		rr := serve("203.0.113.9:31234", "", "admin-token")
		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rr.Code)
		}
		if seenUser == nil || seenUser.Username != "admin" {
			t.Fatalf("expected bootstrapped admin, got %+v", seenUser)
		}
	})
}
