package apiutil

import "net/http"

// K8sClient is an interface to check if K8s is available.
// Any type with a non-nil value satisfies this for guard purposes.
type K8sClient interface{}

// WithK8sGuard wraps a handler to check if K8s client is available.
func WithK8sGuard(k8s K8sClient, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if k8s == nil {
			RespondError(w, http.StatusServiceUnavailable, "K8S_DISABLED", "kubernetes integration is disabled")
			return
		}
		h(w, r)
	}
}

// WithFeatureGuard wraps a handler to check if a feature is enabled.
func WithFeatureGuard(disabled bool, feature string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if disabled {
			RespondError(w, http.StatusServiceUnavailable, "FEATURE_DISABLED", feature+" is disabled")
			return
		}
		h(w, r)
	}
}

// WithURLGuard wraps a handler to check if a service URL is configured.
func WithURLGuard(url string, service string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if url == "" {
			RespondError(w, http.StatusServiceUnavailable, "SERVICE_UNCONFIGURED", service+" URL is not configured")
			return
		}
		h(w, r)
	}
}

// WithConfigGuard combines disabled flag and URL check.
func WithConfigGuard(disabled bool, url string, service string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if disabled || url == "" {
			RespondError(w, http.StatusServiceUnavailable, "SERVICE_DISABLED", service+" is disabled or not configured")
			return
		}
		h(w, r)
	}
}
