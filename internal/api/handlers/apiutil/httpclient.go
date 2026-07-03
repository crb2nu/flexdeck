package apiutil

import (
	"context"
	"io"
	"net/http"
	"time"
)

var (
	// DefaultClient is for general API requests (30s timeout).
	DefaultClient = &http.Client{
		Timeout: 30 * time.Second,
		Transport: &http.Transport{
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 10,
			IdleConnTimeout:     90 * time.Second,
		},
	}

	// ShortClient is for health checks and quick requests (5s timeout).
	ShortClient = &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			MaxIdleConns:        50,
			MaxIdleConnsPerHost: 5,
			IdleConnTimeout:     60 * time.Second,
		},
	}

	// LongClient is for potentially slow operations (60s timeout).
	LongClient = &http.Client{
		Timeout: 60 * time.Second,
		Transport: &http.Transport{
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 10,
			IdleConnTimeout:     90 * time.Second,
		},
	}
)

// ProxyRequest proxies a GET request to the target URL and writes the response.
// The outbound request is bound to ctx so it is canceled if the caller
// disconnects.
func ProxyRequest(ctx context.Context, w http.ResponseWriter, targetURL string) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		RespondError(w, http.StatusBadGateway, "PROXY_ERROR", err.Error())
		return
	}

	resp, err := DefaultClient.Do(req)
	if err != nil {
		RespondError(w, http.StatusBadGateway, "PROXY_ERROR", err.Error())
		return
	}
	defer func() { _ = resp.Body.Close() }()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}
