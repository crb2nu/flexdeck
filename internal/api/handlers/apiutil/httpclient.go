package apiutil

import (
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
func ProxyRequest(w http.ResponseWriter, targetURL string) {
	resp, err := DefaultClient.Get(targetURL)
	if err != nil {
		RespondError(w, http.StatusBadGateway, "PROXY_ERROR", err.Error())
		return
	}
	defer resp.Body.Close()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}
