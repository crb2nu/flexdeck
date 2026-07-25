package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/flexinfer/flexdeck/internal/config"
)

func TestMiddleware_Handler(t *testing.T) {
	tests := []struct {
		name              string
		token             string
		authHeader        string
		cookieValue       string
		trustedCIDRs      string
		trustedProxyCIDRs string
		remoteAddr        string
		xRealIP           string
		expectedStatus    int
		expectedCookie    bool
	}{
		{
			name:           "No token configured (bypass)",
			token:          "",
			expectedStatus: http.StatusOK,
		},
		{
			name:           "Valid Bearer token",
			token:          "secret-token",
			authHeader:     "Bearer secret-token",
			expectedStatus: http.StatusOK,
			expectedCookie: true,
		},
		{
			name:           "Invalid Bearer token",
			token:          "secret-token",
			authHeader:     "Bearer wrong-token",
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:           "Valid Cookie",
			token:          "secret-token",
			cookieValue:    "secret-token",
			expectedStatus: http.StatusOK,
			expectedCookie: true,
		},
		{
			name:           "Invalid Cookie",
			token:          "secret-token",
			cookieValue:    "wrong-token",
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:              "Trusted network bypass via ingress",
			token:             "secret-token",
			trustedCIDRs:      "192.168.50.0/24",
			trustedProxyCIDRs: "10.42.0.0/16",
			remoteAddr:        "10.42.0.8:8080",
			xRealIP:           "192.168.50.153",
			expectedStatus:    http.StatusOK,
		},
		{
			name:              "Direct LAN peer is trusted without headers",
			token:             "secret-token",
			trustedCIDRs:      "192.168.50.0/24",
			trustedProxyCIDRs: "10.42.0.0/16",
			remoteAddr:        "192.168.50.153:44321",
			expectedStatus:    http.StatusOK,
		},
		{
			name:              "Pod network is not trusted",
			token:             "secret-token",
			trustedCIDRs:      "192.168.50.0/24",
			trustedProxyCIDRs: "10.42.0.0/16",
			remoteAddr:        "10.42.0.8:8080",
			xRealIP:           "10.42.12.8",
			expectedStatus:    http.StatusUnauthorized,
		},
		{
			name:              "Spoofed header from untrusted peer is rejected",
			token:             "secret-token",
			trustedCIDRs:      "192.168.50.0/24",
			trustedProxyCIDRs: "10.42.0.0/16",
			remoteAddr:        "203.0.113.9:31234",
			xRealIP:           "192.168.50.153",
			expectedStatus:    http.StatusUnauthorized,
		},
		{
			name:           "Spoofed header without proxy allowlist is rejected",
			token:          "secret-token",
			trustedCIDRs:   "192.168.50.0/24",
			remoteAddr:     "10.42.0.8:8080",
			xRealIP:        "192.168.50.153",
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:           "Missing auth",
			token:          "secret-token",
			expectedStatus: http.StatusUnauthorized,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := &config.Config{
				Token:             tt.token,
				TokenCookie:       "auth_token",
				TokenCookieTTL:    1 * time.Hour,
				CookieSecure:      false,
				TrustedCIDRs:      tt.trustedCIDRs,
				TrustedProxyCIDRs: tt.trustedProxyCIDRs,
			}
			m := NewMiddleware(cfg)

			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
			})

			handler := m.Handler(next)

			req := httptest.NewRequest(http.MethodGet, "/", nil)
			if tt.remoteAddr != "" {
				req.RemoteAddr = tt.remoteAddr
			}
			if tt.authHeader != "" {
				req.Header.Set("Authorization", tt.authHeader)
			}
			if tt.xRealIP != "" {
				req.Header.Set("X-Real-IP", tt.xRealIP)
			}
			if tt.cookieValue != "" {
				req.AddCookie(&http.Cookie{Name: "auth_token", Value: tt.cookieValue})
			}

			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)

			if rr.Code != tt.expectedStatus {
				t.Errorf("expected status %d, got %d", tt.expectedStatus, rr.Code)
			}

			// Check if cookie was set on success
			if tt.expectedCookie {
				cookies := rr.Result().Cookies()
				found := false
				for _, c := range cookies {
					if c.Name == "auth_token" && c.Value == tt.token {
						found = true
						break
					}
				}
				if !found {
					t.Errorf("expected cookie 'auth_token' to be set")
				}
			}
		})
	}
}
