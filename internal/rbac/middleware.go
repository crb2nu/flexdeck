package rbac

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/flexinfer/flexdeck/internal/trustednetwork"
)

type contextKey string

const userContextKey contextKey = "rbac_user"

// UserFromContext returns the RBAC user stored in the request context.
func UserFromContext(ctx context.Context) *User {
	u, _ := ctx.Value(userContextKey).(*User)
	return u
}

// ContextWithUser stores the RBAC user in the context.
func ContextWithUser(ctx context.Context, user *User) context.Context {
	return context.WithValue(ctx, userContextKey, user)
}

// Middleware authenticates requests via the RBAC registry.
// When RBAC is disabled it delegates to the fallback handler (existing auth).
type Middleware struct {
	registry     *Registry
	cookieName   string
	cookieSecure bool
	cookieTTL    time.Duration
	trustedNets  trustednetwork.Allowlist
}

// NewMiddleware creates RBAC middleware.
func NewMiddleware(registry *Registry, cookieName string, cookieSecure bool, cookieTTL time.Duration, trustedCIDRs string) *Middleware {
	return &Middleware{
		registry:     registry,
		cookieName:   cookieName,
		cookieSecure: cookieSecure,
		cookieTTL:    cookieTTL,
		trustedNets:  trustednetwork.Parse(trustedCIDRs),
	}
}

// Handler authenticates the request, stores the user in context, and sets the auth cookie.
func (m *Middleware) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if m.trustedNets.Contains(r) {
			user := &User{ID: "trusted-network", Username: "Trusted network", Role: RoleAdmin, AuthVia: "network"}
			ctx := ContextWithUser(r.Context(), user)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		token := extractToken(r, m.cookieName)
		if token == "" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		user, err := m.registry.Authenticate(token)
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		// Set auth cookie for browser sessions
		http.SetCookie(w, &http.Cookie{
			Name:     m.cookieName,
			Value:    token,
			Path:     "/",
			MaxAge:   int(m.cookieTTL.Seconds()),
			HttpOnly: true,
			Secure:   m.cookieSecure,
			SameSite: http.SameSiteLaxMode,
		})

		ctx := ContextWithUser(r.Context(), user)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequirePermission returns middleware that checks the context user for a permission.
func RequirePermission(perm Permission) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user := UserFromContext(r.Context())
			if !HasPermission(user, perm) {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func extractToken(r *http.Request, cookieName string) string {
	authHeader := r.Header.Get("Authorization")
	if strings.HasPrefix(authHeader, "Bearer ") {
		return strings.TrimPrefix(authHeader, "Bearer ")
	}

	cookie, err := r.Cookie(cookieName)
	if err == nil && cookie.Value != "" {
		return cookie.Value
	}

	return ""
}
