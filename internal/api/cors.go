package api

import (
	"net/http"
)

func corsMiddleware(allowedOrigins []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			allowOrigin := ""

			// Check if origin is allowed
			for _, o := range allowedOrigins {
				if o == "*" {
					allowOrigin = "*"
					break
				}
				if o == origin {
					allowOrigin = origin
					break
				}
			}

			if allowOrigin != "" {
				w.Header().Set("Access-Control-Allow-Origin", allowOrigin)
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Accept, Authorization, Content-Type, X-CSRF-Token")
				// Only allow credentials with specific origins, not wildcard (per CORS spec)
				if allowOrigin != "*" {
					w.Header().Set("Access-Control-Allow-Credentials", "true")
				}
				// Cache preflight response for 24 hours
				w.Header().Set("Access-Control-Max-Age", "86400")
			}

			// Handle preflight requests
			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
