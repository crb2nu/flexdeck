package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"time"

	"github.com/flexinfer/flexdeck/internal/api/handlers/apiutil"
	"github.com/flexinfer/flexdeck/internal/cache"
)

const (
	defaultTrafficWindow = "24h"
	trafficReportTTL     = 60 * time.Second
)

var trafficWindowRe = regexp.MustCompile(`^\d+[mhdw]$`)

type TrafficReport struct {
	GeneratedAt     string          `json:"generated_at"`
	Window          string          `json:"window"`
	Status          string          `json:"status"`
	Hosts           []TrafficHost   `json:"hosts"`
	TopPaths        []TrafficPath   `json:"top_paths"`
	TopPages        []TrafficPage   `json:"top_pages"`
	TrackingSignals []TrafficSignal `json:"tracking_signals"`
	Recommendations []string        `json:"recommendations"`
	Warnings        []string        `json:"warnings,omitempty"`
}

type TrafficHost struct {
	Host              string  `json:"host"`
	Requests          float64 `json:"requests"`
	RequestsPerSecond float64 `json:"requests_per_second"`
	FourXX            float64 `json:"four_xx"`
	FourXXPrev        float64 `json:"four_xx_prev"`
	FourXXChange      float64 `json:"four_xx_change"`
	FiveXX            float64 `json:"five_xx"`
	FiveXXPrev        float64 `json:"five_xx_prev"`
	FiveXXChange      float64 `json:"five_xx_change"`
	ErrorRate         float64 `json:"error_rate"`
	P95LatencyMs      float64 `json:"p95_latency_ms"`
}

type TrafficPath struct {
	Host     string  `json:"host"`
	Path     string  `json:"path"`
	Requests float64 `json:"requests"`
}

type TrafficPage struct {
	Page  string  `json:"page"`
	Views float64 `json:"views"`
}

type TrafficSignal struct {
	Name   string  `json:"name"`
	OK     bool    `json:"ok"`
	Value  float64 `json:"value"`
	Detail string  `json:"detail"`
}

type trafficPromSample struct {
	Metric map[string]string
	Value  float64
}

func (h *Handler) TrafficReport(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Prom.Disabled || h.cfg.Prom.URL == "" {
		apiutil.RespondError(w, http.StatusServiceUnavailable, "PROM_DISABLED", "prometheus is disabled")
		return
	}

	window := sanitizeTrafficWindow(r.URL.Query().Get("window"))
	cacheKey := "traffic:report:" + window

	if h.cache == nil {
		report := h.buildTrafficReport(r, window)
		respondJSON(w, http.StatusOK, report)
		return
	}

	data, err := h.cache.GetOrFetchWithOptions(
		r.Context(),
		cacheKey,
		cache.FetchOptions{
			TTL:                      trafficReportTTL,
			StaleTTL:                 5 * time.Minute,
			JitterFraction:           0.2,
			BackgroundRefreshTimeout: 10 * time.Second,
		},
		func(_ context.Context) (any, error) {
			return h.buildTrafficReport(r, window), nil
		},
	)
	if err != nil {
		apiutil.RespondError(w, http.StatusBadGateway, "TRAFFIC_REPORT_FAILED", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func (h *Handler) buildTrafficReport(r *http.Request, window string) TrafficReport {
	report := TrafficReport{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Window:      window,
		Status:      "ok",
	}

	query := func(name, promql string) []trafficPromSample {
		samples, err := h.queryTrafficPrometheus(r, promql)
		if err != nil {
			report.Warnings = append(report.Warnings, fmt.Sprintf("%s: %v", name, err))
			report.Status = "partial"
			return nil
		}
		return samples
	}

	hostTotals := query("host traffic totals", fmt.Sprintf(`topk(20, sum by (host) (increase(nginx_ingress_controller_requests{host!=""}[%s])))`, window))
	hostRPS := query("host request rate", `sum by (host) (rate(nginx_ingress_controller_requests{host!=""}[5m]))`)
	host4xx := query("host 4xx totals", fmt.Sprintf(`sum by (host) (increase(nginx_ingress_controller_requests{host!="",status=~"4.."}[%s]))`, window))
	host4xxPrev := query("host 4xx totals (previous window)", fmt.Sprintf(`sum by (host) (increase(nginx_ingress_controller_requests{host!="",status=~"4.."}[%s] offset %s))`, window, window))
	host5xx := query("host 5xx totals", fmt.Sprintf(`sum by (host) (increase(nginx_ingress_controller_requests{host!="",status=~"5.."}[%s]))`, window))
	host5xxPrev := query("host 5xx totals (previous window)", fmt.Sprintf(`sum by (host) (increase(nginx_ingress_controller_requests{host!="",status=~"5.."}[%s] offset %s))`, window, window))
	hostP95 := query("host p95 latency", `histogram_quantile(0.95, sum by (host, le) (rate(nginx_ingress_controller_request_duration_seconds_bucket{host!=""}[5m])))`)
	topPaths := query("top paths", fmt.Sprintf(`topk(20, sum by (host, path) (increase(nginx_ingress_controller_requests{host!="",path!=""}[%s])))`, window))
	topPages := query("site page views", fmt.Sprintf(`topk(20, sum by (page) (increase(flexinfer_page_views_total[%s])))`, window))
	pageViewSeries := query("page view metric presence", `count(flexinfer_page_views_total)`)
	appRequests := query("app request metric presence", `count(flexinfer_http_requests_total)`)
	upSamples := query("site scrape status", `up{namespace=~"flexinfer-site.*", service=~"(flexinfer-site|cody-site|umami)"}`)

	report.Hosts = buildTrafficHosts(hostTotals, hostRPS, host4xx, host4xxPrev, host5xx, host5xxPrev, hostP95)
	report.TopPaths = buildTrafficPaths(topPaths)
	report.TopPages = buildTrafficPages(topPages)
	report.TrackingSignals = buildTrafficSignals(pageViewSeries, appRequests, upSamples)
	report.Recommendations = buildTrafficRecommendations(report)

	return report
}

func sanitizeTrafficWindow(raw string) string {
	if raw == "" {
		return defaultTrafficWindow
	}
	if !trafficWindowRe.MatchString(raw) {
		return defaultTrafficWindow
	}
	return raw
}

func (h *Handler) queryTrafficPrometheus(r *http.Request, promql string) ([]trafficPromSample, error) {
	promURL := apiutil.NewURLBuilder(h.cfg.Prom.URL).
		RawPath("/api/v1/query").
		Param("query", promql).
		String()

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, promURL, nil)
	if err != nil {
		return nil, err
	}

	resp, err := apiutil.ShortClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("prometheus returned %d", resp.StatusCode)
	}

	var raw struct {
		Status string `json:"status"`
		Data   struct {
			Result []struct {
				Metric map[string]string  `json:"metric"`
				Value  [2]json.RawMessage `json:"value"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("prometheus unmarshal: %w", err)
	}
	if raw.Status != "success" {
		return nil, fmt.Errorf("prometheus status %q", raw.Status)
	}

	samples := make([]trafficPromSample, 0, len(raw.Data.Result))
	for _, result := range raw.Data.Result {
		samples = append(samples, trafficPromSample{
			Metric: result.Metric,
			Value:  parsePromValue(result.Value[1]),
		})
	}
	return samples, nil
}

func buildTrafficHosts(total, rps, fourXX, fourXXPrev, fiveXX, fiveXXPrev, p95 []trafficPromSample) []TrafficHost {
	hosts := make(map[string]*TrafficHost, len(total))
	getHost := func(host string) *TrafficHost {
		if host == "" {
			host = "unknown"
		}
		if existing, ok := hosts[host]; ok {
			return existing
		}
		next := &TrafficHost{Host: host}
		hosts[host] = next
		return next
	}

	for _, sample := range total {
		getHost(sample.Metric["host"]).Requests = sample.Value
	}
	for _, sample := range rps {
		getHost(sample.Metric["host"]).RequestsPerSecond = sample.Value
	}
	for _, sample := range fourXX {
		getHost(sample.Metric["host"]).FourXX = sample.Value
	}
	for _, sample := range fourXXPrev {
		getHost(sample.Metric["host"]).FourXXPrev = sample.Value
	}
	for _, sample := range fiveXX {
		getHost(sample.Metric["host"]).FiveXX = sample.Value
	}
	for _, sample := range fiveXXPrev {
		getHost(sample.Metric["host"]).FiveXXPrev = sample.Value
	}
	for _, sample := range p95 {
		getHost(sample.Metric["host"]).P95LatencyMs = sample.Value * 1000
	}

	out := make([]TrafficHost, 0, len(hosts))
	for _, host := range hosts {
		if host.Requests > 0 {
			host.ErrorRate = host.FiveXX / host.Requests
		}
		host.FourXXChange = host.FourXX - host.FourXXPrev
		host.FiveXXChange = host.FiveXX - host.FiveXXPrev
		out = append(out, *host)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Requests > out[j].Requests })
	return out
}

func buildTrafficPaths(samples []trafficPromSample) []TrafficPath {
	paths := make([]TrafficPath, 0, len(samples))
	for _, sample := range samples {
		path := sample.Metric["path"]
		if path == "" {
			path = "/"
		}
		paths = append(paths, TrafficPath{
			Host:     sample.Metric["host"],
			Path:     path,
			Requests: sample.Value,
		})
	}
	sort.Slice(paths, func(i, j int) bool { return paths[i].Requests > paths[j].Requests })
	return paths
}

func buildTrafficPages(samples []trafficPromSample) []TrafficPage {
	pages := make([]TrafficPage, 0, len(samples))
	for _, sample := range samples {
		pages = append(pages, TrafficPage{
			Page:  sample.Metric["page"],
			Views: sample.Value,
		})
	}
	sort.Slice(pages, func(i, j int) bool { return pages[i].Views > pages[j].Views })
	return pages
}

func buildTrafficSignals(pageViewSeries, appRequests, upSamples []trafficPromSample) []TrafficSignal {
	signals := []TrafficSignal{
		{
			Name:   "page view metric",
			OK:     sampleSum(pageViewSeries) > 0,
			Value:  sampleSum(pageViewSeries),
			Detail: "flexinfer_page_views_total series discovered",
		},
		{
			Name:   "app request metric",
			OK:     sampleSum(appRequests) > 0,
			Value:  sampleSum(appRequests),
			Detail: "flexinfer_http_requests_total series discovered",
		},
	}

	for _, sample := range upSamples {
		name := sample.Metric["service"]
		if name == "" {
			name = sample.Metric["job"]
		}
		if name == "" {
			name = "prometheus target"
		}
		signals = append(signals, TrafficSignal{
			Name:   name,
			OK:     sample.Value >= 1,
			Value:  sample.Value,
			Detail: fmt.Sprintf("namespace=%s pod=%s", sample.Metric["namespace"], sample.Metric["pod"]),
		})
	}

	return signals
}

func buildTrafficRecommendations(report TrafficReport) []string {
	recommendations := []string{}
	if len(report.Hosts) == 0 {
		recommendations = append(recommendations, "No ingress traffic series were returned. Verify nginx ingress metrics and host labels are scraped.")
	}
	if len(report.TopPages) == 0 {
		recommendations = append(recommendations, "No application page-view series were returned. Verify flexinfer-site /metrics is scraped after the next deploy.")
	}
	for _, host := range report.Hosts {
		if host.ErrorRate > 0.01 {
			recommendations = append(recommendations, fmt.Sprintf("%s is above 1%% 5xx rate for the selected window.", host.Host))
		}
		if host.P95LatencyMs > 2000 {
			recommendations = append(recommendations, fmt.Sprintf("%s p95 latency is above 2s.", host.Host))
		}
	}
	if len(recommendations) == 0 {
		recommendations = append(recommendations, "Traffic telemetry is flowing. Watch hosts with rising 4xx volume for broken links or probing.")
	}
	return recommendations
}

func sampleSum(samples []trafficPromSample) float64 {
	var total float64
	for _, sample := range samples {
		total += sample.Value
	}
	return total
}

func parsePromValue(raw json.RawMessage) float64 {
	var f float64
	if err := json.Unmarshal(raw, &f); err == nil {
		return sanitizePromFloat(f)
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return 0
	}
	f, _ = strconv.ParseFloat(s, 64)
	return sanitizePromFloat(f)
}

func sanitizePromFloat(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}
	return value
}
