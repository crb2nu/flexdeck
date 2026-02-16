package middleware

import (
	"bytes"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/flexinfer/flexdeck/internal/audit"
	"github.com/flexinfer/flexdeck/internal/rbac"
)

// responseWriter wraps http.ResponseWriter to capture the status code.
type responseWriter struct {
	http.ResponseWriter
	status int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

// AuditLogger logs mutation operations for audit purposes.
type AuditLogger struct {
	logger *slog.Logger
	store  *audit.Store
}

// NewAuditLogger creates a new AuditLogger with optional Redis persistence.
func NewAuditLogger(logger *slog.Logger, store *audit.Store) *AuditLogger {
	if logger == nil {
		logger = slog.Default()
	}
	return &AuditLogger{logger: logger, store: store}
}

// Log returns middleware that logs the specified action.
func (a *AuditLogger) Log(action string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()

			// Capture truncated request body for mutations
			var bodySnippet string
			if r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodDelete {
				bodySnippet = captureBody(r, 4096)
			}

			// Wrap response writer to capture status
			rw := &responseWriter{ResponseWriter: w, status: http.StatusOK}

			next.ServeHTTP(rw, r)

			duration := time.Since(start).Milliseconds()

			a.logger.Info("audit",
				"action", action,
				"method", r.Method,
				"path", r.URL.Path,
				"status", rw.status,
				"duration_ms", duration,
				"remote_addr", r.RemoteAddr,
				"user_agent", r.UserAgent(),
			)

			// Persist to Redis if store is available
			if a.store != nil {
				entry := audit.Entry{
					Timestamp:  time.Now().UTC().Format(time.RFC3339Nano),
					Action:     action,
					Method:     r.Method,
					Path:       r.URL.Path,
					Status:     rw.status,
					DurationMs: duration,
					RemoteAddr: r.RemoteAddr,
					UserAgent:  r.UserAgent(),
					Body:       bodySnippet,
				}

				// Attach RBAC user if available
				if user := rbac.UserFromContext(r.Context()); user != nil {
					entry.UserID = user.ID
					entry.Username = user.Username
					entry.Role = string(user.Role)
				}

				go func() {
					if err := a.store.Record(r.Context(), entry); err != nil {
						a.logger.Warn("audit: failed to persist entry", "error", err)
					}
				}()
			}
		})
	}
}

// LogFunc is a convenience function for creating audit middleware without instantiating AuditLogger.
func LogFunc(action string) func(http.Handler) http.Handler {
	return NewAuditLogger(nil, nil).Log(action)
}

// captureBody reads and restores up to maxBytes of the request body,
// stripping sensitive fields from the snippet.
func captureBody(r *http.Request, maxBytes int64) string {
	if r.Body == nil {
		return ""
	}
	limited := io.LimitReader(r.Body, maxBytes)
	buf, err := io.ReadAll(limited)
	if err != nil {
		return ""
	}
	// Restore the body for downstream handlers
	r.Body = io.NopCloser(io.MultiReader(bytes.NewReader(buf), r.Body))

	snippet := string(buf)
	// Strip sensitive fields (best-effort)
	for _, field := range []string{"token", "password", "secret"} {
		if strings.Contains(strings.ToLower(snippet), field) {
			snippet = "[redacted: contains sensitive field]"
			break
		}
	}
	return snippet
}
