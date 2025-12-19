package middleware

import (
	"log/slog"
	"net/http"
	"time"
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
}

// NewAuditLogger creates a new AuditLogger.
func NewAuditLogger(logger *slog.Logger) *AuditLogger {
	if logger == nil {
		logger = slog.Default()
	}
	return &AuditLogger{logger: logger}
}

// Log returns middleware that logs the specified action.
func (a *AuditLogger) Log(action string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()

			// Wrap response writer to capture status
			rw := &responseWriter{ResponseWriter: w, status: http.StatusOK}

			next.ServeHTTP(rw, r)

			a.logger.Info("audit",
				"action", action,
				"method", r.Method,
				"path", r.URL.Path,
				"status", rw.status,
				"duration_ms", time.Since(start).Milliseconds(),
				"remote_addr", r.RemoteAddr,
				"user_agent", r.UserAgent(),
			)
		})
	}
}

// LogFunc is a convenience function for creating audit middleware without instantiating AuditLogger.
func LogFunc(action string) func(http.Handler) http.Handler {
	return NewAuditLogger(nil).Log(action)
}
