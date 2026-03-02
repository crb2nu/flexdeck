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
		name           string
		token          string
		authHeader     string
		cookieValue    string
		expectedStatus int
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
		},
		{
			name:           "Invalid Cookie",
			token:          "secret-token",
			cookieValue:    "wrong-token",
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
				Token:          tt.token,
				TokenCookie:    "auth_token",
				TokenCookieTTL: 1 * time.Hour,
				CookieSecure:   false,
			}
			m := NewMiddleware(cfg)

			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
			})

			handler := m.Handler(next)

			req := httptest.NewRequest(http.MethodGet, "/", nil)
			if tt.authHeader != "" {
				req.Header.Set("Authorization", tt.authHeader)
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
			if tt.expectedStatus == http.StatusOK && tt.token != "" {
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
