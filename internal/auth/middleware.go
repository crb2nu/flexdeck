package auth

import (
	"crypto/subtle"
	"net/http"
	"strings"
	"time"

	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/flexinfer/flexdeck/internal/trustednetwork"
)

type Middleware struct {
	token        string
	cookieName   string
	cookieSecure bool
	cookieTTL    time.Duration
	trustedNets  trustednetwork.Allowlist
}

func NewMiddleware(cfg *config.Config) *Middleware {
	return &Middleware{
		token:        cfg.Token,
		cookieName:   cfg.TokenCookie,
		cookieSecure: cfg.CookieSecure,
		cookieTTL:    cfg.TokenCookieTTL,
		trustedNets:  trustednetwork.Parse(cfg.TrustedCIDRs),
	}
}

func (m *Middleware) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if m.token == "" {
			next.ServeHTTP(w, r)
			return
		}
		if m.trustedNets.Contains(r) {
			next.ServeHTTP(w, r)
			return
		}

		token := m.extractToken(r)
		if token == "" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		if !m.validateToken(token) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		m.setTokenCookie(w, token)
		next.ServeHTTP(w, r)
	})
}

func (m *Middleware) extractToken(r *http.Request) string {
	authHeader := r.Header.Get("Authorization")
	if strings.HasPrefix(authHeader, "Bearer ") {
		return strings.TrimPrefix(authHeader, "Bearer ")
	}

	cookie, err := r.Cookie(m.cookieName)
	if err == nil && cookie.Value != "" {
		return cookie.Value
	}

	return ""
}

func (m *Middleware) validateToken(token string) bool {
	return subtle.ConstantTimeCompare([]byte(token), []byte(m.token)) == 1
}

func (m *Middleware) setTokenCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     m.cookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(m.cookieTTL.Seconds()),
		HttpOnly: true,
		Secure:   m.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}
