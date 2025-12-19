package apiutil

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// APIError represents a structured error in API responses.
type APIError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Response is the standard envelope for all API responses.
type Response struct {
	Data  any       `json:"data,omitempty"`
	Error *APIError `json:"error,omitempty"`
}

// RespondJSON writes a JSON response with proper headers.
func RespondJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}

// RespondError writes a structured error response.
func RespondError(w http.ResponseWriter, status int, code, message string) {
	RespondJSON(w, status, Response{
		Error: &APIError{Code: code, Message: message},
	})
}

// RespondData writes a data response wrapped in the standard envelope.
func RespondData(w http.ResponseWriter, data any) {
	RespondJSON(w, http.StatusOK, Response{Data: data})
}

// RespondRaw writes raw data (for proxied responses or compatibility).
func RespondRaw(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		slog.Error("failed to encode JSON response", "error", err)
	}
}
