package metrics

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/flexinfer/flexdeck/internal/litellm"
)

const (
	throughputSummaryKey     = "litellm:summary:throughput"
	throughputSummaryTTL     = 5 * time.Minute
	dashboardSummaryKey      = "dashboard:summary:resources"
	dashboardSummaryTTL      = 30 * time.Second
	dashboardSummaryMaxStale = 45 * time.Second
)

// Store manages metrics storage in Redis
type Store struct {
	redis *redis.Client
}

// MetricPoint represents a single metric sample
type MetricPoint struct {
	Timestamp    int64   `json:"ts"`
	TotalTokens  float64 `json:"total"`
	OutputTokens float64 `json:"output"`
	InputTokens  float64 `json:"input"`
	RequestCount float64 `json:"requests"`
	LatencyMs    float64 `json:"latency_ms"`
}

// ModelThroughput represents calculated tok/s for a model
type ModelThroughput struct {
	Model           string    `json:"model"`
	TokPerSec1m     float64   `json:"tok_per_sec_1m"`
	TokPerSec5m     float64   `json:"tok_per_sec_5m"`
	TokPerSec15m    float64   `json:"tok_per_sec_15m"`
	OutputTokPerSec float64   `json:"output_tok_per_sec"`
	RequestsPerMin  float64   `json:"requests_per_min"`
	AvgLatencyMs    float64   `json:"avg_latency_ms"`
	SparklineData   []float64 `json:"sparkline"`
	Trend           string    `json:"trend"`
	LastUpdated     time.Time `json:"last_updated"`
}

// NewStore creates a new metrics store
func NewStore(cfg config.RedisConfig) (*Store, error) {
	opts, err := redis.ParseURL(cfg.URL)
	if err != nil {
		return nil, fmt.Errorf("invalid redis URL: %w", err)
	}
	opts.Password = cfg.Password
	opts.DB = cfg.DB

	client := redis.NewClient(opts)

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("redis connection failed: %w", err)
	}

	return NewStoreWithClient(client), nil
}

// NewStoreWithClient wraps an existing Redis client for metrics storage.
func NewStoreWithClient(client *redis.Client) *Store {
	return &Store{redis: client}
}

// RedisClient returns the underlying Redis client for use by other packages.
func (s *Store) RedisClient() *redis.Client {
	return s.redis
}

// Close closes the Redis connection
func (s *Store) Close() error {
	return s.redis.Close()
}

// StoreMetrics stores a metrics snapshot in Redis
func (s *Store) StoreMetrics(ctx context.Context, metrics []litellm.ModelMetrics) error {
	pipe := s.redis.Pipeline()
	now := time.Now().Unix()

	for _, m := range metrics {
		key := fmt.Sprintf("litellm:metrics:%s", m.Model)
		point := MetricPoint{
			Timestamp:    now,
			TotalTokens:  m.TotalTokens,
			OutputTokens: m.OutputTokens,
			InputTokens:  m.InputTokens,
			RequestCount: m.RequestCount,
			LatencyMs:    m.TotalLatencyMs,
		}

		data, err := json.Marshal(point)
		if err != nil {
			continue
		}

		// Use Redis sorted set with timestamp as score for time-series
		pipe.ZAdd(ctx, key, redis.Z{
			Score:  float64(now),
			Member: string(data),
		})

		// Trim old data (keep last 20 minutes)
		cutoff := float64(now - 1200)
		pipe.ZRemRangeByScore(ctx, key, "-inf", fmt.Sprintf("%f", cutoff))

		// Set TTL on key
		pipe.Expire(ctx, key, 25*time.Minute)
	}

	_, err := pipe.Exec(ctx)
	if err != nil {
		return err
	}

	s.materializeThroughput(ctx)
	return nil
}

// GetThroughput returns tok/s for all models, preferring a pre-materialized
// summary stored by StoreMetrics. Falls back to full computation on miss.
func (s *Store) GetThroughput(ctx context.Context) ([]ModelThroughput, error) {
	data, err := s.redis.Get(ctx, throughputSummaryKey).Bytes()
	if err == nil {
		var results []ModelThroughput
		if err := json.Unmarshal(data, &results); err == nil {
			return results, nil
		}
	}
	return s.computeThroughput(ctx)
}

// computeThroughput scans all model sorted sets and calculates throughput.
func (s *Store) computeThroughput(ctx context.Context) ([]ModelThroughput, error) {
	var keys []string
	var cursor uint64
	for {
		var batch []string
		var err error
		batch, cursor, err = s.redis.Scan(ctx, cursor, "litellm:metrics:*", 100).Result()
		if err != nil {
			return nil, err
		}
		keys = append(keys, batch...)
		if cursor == 0 {
			break
		}
	}

	results := make([]ModelThroughput, 0, len(keys))
	now := time.Now().Unix()

	for _, key := range keys {
		model := key[len("litellm:metrics:"):]

		points, err := s.redis.ZRangeByScore(ctx, key, &redis.ZRangeBy{
			Min: fmt.Sprintf("%d", now-900),
			Max: fmt.Sprintf("%d", now),
		}).Result()
		if err != nil {
			continue
		}

		if len(points) < 2 {
			continue
		}

		throughput := s.calculateThroughput(model, points, now)
		results = append(results, throughput)
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].Model < results[j].Model
	})

	return results, nil
}

// MaterializeThroughput computes and stores the throughput summary in Redis.
// Exported so the background Materializer can call it on a timer.
func (s *Store) MaterializeThroughput(ctx context.Context) {
	s.materializeThroughput(ctx)
}

// materializeThroughput computes and stores the throughput summary in Redis.
func (s *Store) materializeThroughput(ctx context.Context) {
	results, err := s.computeThroughput(ctx)
	if err != nil {
		return
	}
	data, err := json.Marshal(results)
	if err != nil {
		return
	}
	s.redis.Set(ctx, throughputSummaryKey, data, throughputSummaryTTL)
}

// GetModelThroughput returns throughput for a specific model
func (s *Store) GetModelThroughput(ctx context.Context, model string) (*ModelThroughput, error) {
	key := fmt.Sprintf("litellm:metrics:%s", model)
	now := time.Now().Unix()

	points, err := s.redis.ZRangeByScore(ctx, key, &redis.ZRangeBy{
		Min: fmt.Sprintf("%d", now-900),
		Max: fmt.Sprintf("%d", now),
	}).Result()
	if err != nil {
		return nil, err
	}

	if len(points) < 2 {
		return nil, fmt.Errorf("insufficient data points")
	}

	throughput := s.calculateThroughput(model, points, now)
	return &throughput, nil
}

func (s *Store) calculateThroughput(model string, points []string, now int64) ModelThroughput {
	var parsed []MetricPoint
	for _, p := range points {
		var mp MetricPoint
		if err := json.Unmarshal([]byte(p), &mp); err == nil {
			parsed = append(parsed, mp)
		}
	}

	if len(parsed) < 2 {
		return ModelThroughput{Model: model, LastUpdated: time.Now()}
	}

	// Sort by timestamp
	sort.Slice(parsed, func(i, j int) bool {
		return parsed[i].Timestamp < parsed[j].Timestamp
	})

	result := ModelThroughput{
		Model:       model,
		LastUpdated: time.Now(),
	}

	// Calculate tok/s for each window
	result.TokPerSec1m = s.calculateRate(parsed, now, 60)
	result.TokPerSec5m = s.calculateRate(parsed, now, 300)
	result.TokPerSec15m = s.calculateRate(parsed, now, 900)

	// Output tokens rate
	result.OutputTokPerSec = s.calculateOutputRate(parsed, now, 60)

	// Requests per minute
	result.RequestsPerMin = s.calculateRequestRate(parsed, now, 60) * 60

	// Average latency
	result.AvgLatencyMs = s.calculateAvgLatency(parsed)

	// Sparkline data (last 15 data points, tok/s at each point)
	result.SparklineData = s.generateSparkline(parsed)

	// Trend detection
	result.Trend = s.detectTrend(result.SparklineData)

	return result
}

func (s *Store) calculateRate(points []MetricPoint, now int64, windowSec int64) float64 {
	cutoff := now - windowSec
	var first, last *MetricPoint

	for i := range points {
		if points[i].Timestamp >= cutoff {
			if first == nil {
				first = &points[i]
			}
			last = &points[i]
		}
	}

	if first == nil || last == nil || first.Timestamp == last.Timestamp {
		return 0
	}

	tokenDiff := last.TotalTokens - first.TotalTokens
	timeDiff := float64(last.Timestamp - first.Timestamp)

	if timeDiff <= 0 || tokenDiff < 0 {
		return 0
	}

	return tokenDiff / timeDiff
}

func (s *Store) calculateOutputRate(points []MetricPoint, now int64, windowSec int64) float64 {
	cutoff := now - windowSec
	var first, last *MetricPoint

	for i := range points {
		if points[i].Timestamp >= cutoff {
			if first == nil {
				first = &points[i]
			}
			last = &points[i]
		}
	}

	if first == nil || last == nil || first.Timestamp == last.Timestamp {
		return 0
	}

	tokenDiff := last.OutputTokens - first.OutputTokens
	timeDiff := float64(last.Timestamp - first.Timestamp)

	if timeDiff <= 0 || tokenDiff < 0 {
		return 0
	}

	return tokenDiff / timeDiff
}

func (s *Store) calculateRequestRate(points []MetricPoint, now int64, windowSec int64) float64 {
	cutoff := now - windowSec
	var first, last *MetricPoint

	for i := range points {
		if points[i].Timestamp >= cutoff {
			if first == nil {
				first = &points[i]
			}
			last = &points[i]
		}
	}

	if first == nil || last == nil || first.Timestamp == last.Timestamp {
		return 0
	}

	reqDiff := last.RequestCount - first.RequestCount
	timeDiff := float64(last.Timestamp - first.Timestamp)

	if timeDiff <= 0 || reqDiff < 0 {
		return 0
	}

	return reqDiff / timeDiff
}

func (s *Store) calculateAvgLatency(points []MetricPoint) float64 {
	if len(points) == 0 {
		return 0
	}

	// Get the most recent latency value
	return points[len(points)-1].LatencyMs
}

func (s *Store) generateSparkline(points []MetricPoint) []float64 {
	if len(points) < 2 {
		return nil
	}

	// Take last 15 points max
	start := 0
	if len(points) > 15 {
		start = len(points) - 15
	}
	subset := points[start:]

	sparkline := make([]float64, 0, len(subset)-1)

	for i := 1; i < len(subset); i++ {
		tokenDiff := subset[i].TotalTokens - subset[i-1].TotalTokens
		timeDiff := float64(subset[i].Timestamp - subset[i-1].Timestamp)

		if timeDiff > 0 && tokenDiff >= 0 {
			sparkline = append(sparkline, tokenDiff/timeDiff)
		} else {
			sparkline = append(sparkline, 0)
		}
	}

	return sparkline
}

func (s *Store) detectTrend(sparkline []float64) string {
	if len(sparkline) < 3 {
		return "stable"
	}

	// Compare first half average to second half average
	mid := len(sparkline) / 2
	var firstHalf, secondHalf float64

	for i := 0; i < mid; i++ {
		firstHalf += sparkline[i]
	}
	firstHalf /= float64(mid)

	for i := mid; i < len(sparkline); i++ {
		secondHalf += sparkline[i]
	}
	secondHalf /= float64(len(sparkline) - mid)

	// 10% threshold for trend detection
	if firstHalf == 0 && secondHalf == 0 {
		return "stable"
	}

	if firstHalf == 0 && secondHalf > 0 {
		return "up"
	}

	ratio := secondHalf / firstHalf
	if ratio > 1.1 {
		return "up"
	} else if ratio < 0.9 {
		return "down"
	}
	return "stable"
}

// --- Dashboard summary (server-side Prometheus aggregation) ---

// PromQL queries that the frontend previously fired individually.
var dashboardQueries = map[string]string{
	// Cluster (3)
	"clusterCpu":      `sum(rate(node_cpu_seconds_total{mode!="idle"}[5m])) / sum(rate(node_cpu_seconds_total[5m])) * 100`,
	"clusterMemUsed":  `sum(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes)`,
	"clusterMemTotal": `sum(node_memory_MemTotal_bytes)`,
	// Node (9)
	"nodeCpu":      `100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)`,
	"nodeMemPct":   `(1 - (node_memory_AvailableBytes / node_memory_MemTotalBytes)) * 100`,
	"nodeMemTotal": `node_memory_MemTotalBytes`,
	"gpuUtil":      `avg by (instance) (amdgpu_gpu_busy_percent)`,
	"vramUsed":     `sum by (instance) (amdgpu_vram_used_bytes)`,
	"vramTotal":    `sum by (instance) (amdgpu_vram_total_bytes)`,
	"gpuTemp":      `max by (instance) (amdgpu_temperature_edge)`,
	"gpuPower":     `sum by (instance) (amdgpu_power_average_watts)`,
	"gpuCount":     `count by (instance) (amdgpu_gpu_busy_percent)`,
	// Pod (3)
	"podCpu":      `sum(rate(container_cpu_usage_seconds_total{container!=""}[5m])) by (pod, namespace) * 100`,
	"podMem":      `sum(container_memory_working_set_bytes{container!=""}) by (pod, namespace)`,
	"podMemLimit": `sum(container_spec_memory_limit_bytes{container!=""}) by (pod, namespace)`,
}

// computeDashboardSummary fires all PromQL queries in parallel and assembles a DashboardSummary.
func (s *Store) computeDashboardSummary(ctx context.Context, promURL string) (*DashboardSummary, error) {
	pc := newPromClient(promURL)

	type queryResult struct {
		name    string
		samples []promSample
		err     error
	}

	results := make(map[string][]promSample, len(dashboardQueries))
	ch := make(chan queryResult, len(dashboardQueries))
	var wg sync.WaitGroup

	for name, query := range dashboardQueries {
		wg.Add(1)
		go func(n, q string) {
			defer wg.Done()
			samples, err := pc.queryInstant(ctx, q)
			ch <- queryResult{name: n, samples: samples, err: err}
		}(name, query)
	}

	wg.Wait()
	close(ch)

	for qr := range ch {
		if qr.err != nil {
			slog.Warn("dashboard summary query failed", "query", qr.name, "error", qr.err)
			continue
		}
		results[qr.name] = qr.samples
	}

	summary := &DashboardSummary{UpdatedAt: time.Now()}

	// Cluster
	summary.Cluster.CPUPercent = singleVal(results["clusterCpu"])
	summary.Cluster.MemoryUsed = singleVal(results["clusterMemUsed"])
	summary.Cluster.MemoryTotal = singleVal(results["clusterMemTotal"])

	// Nodes — collect all node names from CPU or mem queries
	nodeNames := collectNodeNames(results["nodeCpu"], results["nodeMemPct"])
	for _, nodeName := range nodeNames {
		nr := NodeResources{Node: nodeName}
		if v, ok := findNodeVal(results["nodeCpu"], nodeName); ok {
			nr.CPUPercent = &v
		}
		if v, ok := findNodeVal(results["nodeMemPct"], nodeName); ok {
			nr.MemPercent = &v
		}
		if v, ok := findNodeVal(results["nodeMemTotal"], nodeName); ok {
			nr.MemTotal = &v
			if nr.MemPercent != nil {
				used := v * (*nr.MemPercent / 100)
				nr.MemUsed = &used
			}
		}
		if gpuUtil, ok := findNodeVal(results["gpuUtil"], nodeName); ok {
			gpu := &NodeGPU{Utilization: &gpuUtil}
			if c, ok := findNodeVal(results["gpuCount"], nodeName); ok {
				gpu.Count = int(c)
			}
			if v, ok := findNodeVal(results["vramUsed"], nodeName); ok {
				gpu.VRAMUsed = &v
			}
			if v, ok := findNodeVal(results["vramTotal"], nodeName); ok {
				gpu.VRAMTotal = &v
			}
			if v, ok := findNodeVal(results["gpuTemp"], nodeName); ok {
				gpu.Temperature = &v
			}
			if v, ok := findNodeVal(results["gpuPower"], nodeName); ok {
				gpu.PowerWatts = &v
			}
			nr.GPU = gpu
		}
		summary.Nodes = append(summary.Nodes, nr)
	}

	// Pods
	for _, s := range results["podCpu"] {
		pod := s.Metric["pod"]
		ns := s.Metric["namespace"]
		if pod == "" {
			continue
		}
		pr := PodResources{
			Namespace:  ns,
			Pod:        pod,
			CPUPercent: s.Value,
		}
		if mem := findPodVal(results["podMem"], ns, pod); mem > 0 {
			pr.MemoryUsed = mem
		}
		if limit := findPodVal(results["podMemLimit"], ns, pod); limit > 0 {
			pr.MemoryLimit = limit
		}
		summary.Pods = append(summary.Pods, pr)
	}

	return summary, nil
}

// MaterializeDashboardSummary computes and stores the dashboard summary in Redis.
func (s *Store) MaterializeDashboardSummary(ctx context.Context, promURL string) {
	summary, err := s.computeDashboardSummary(ctx, promURL)
	if err != nil {
		slog.Warn("failed to compute dashboard summary", "error", err)
		return
	}
	data, err := json.Marshal(summary)
	if err != nil {
		slog.Warn("failed to marshal dashboard summary", "error", err)
		return
	}
	s.redis.Set(ctx, dashboardSummaryKey, data, dashboardSummaryTTL)
}

// GetDashboardSummary reads the pre-materialized dashboard summary from Redis.
// Returns nil if not found or expired beyond the max stale window.
func (s *Store) GetDashboardSummary(ctx context.Context) (*DashboardSummary, error) {
	data, err := s.redis.Get(ctx, dashboardSummaryKey).Bytes()
	if err != nil {
		return nil, fmt.Errorf("dashboard summary not available: %w", err)
	}
	var summary DashboardSummary
	if err := json.Unmarshal(data, &summary); err != nil {
		return nil, fmt.Errorf("dashboard summary unmarshal: %w", err)
	}
	if time.Since(summary.UpdatedAt) > dashboardSummaryMaxStale {
		return nil, fmt.Errorf("dashboard summary stale (updated %s ago)", time.Since(summary.UpdatedAt).Round(time.Second))
	}
	return &summary, nil
}

// --- helpers for Prometheus result parsing ---

func singleVal(samples []promSample) float64 {
	if len(samples) == 0 {
		return 0
	}
	return samples[0].Value
}

// normalizeNodeName strips port and domain suffix from a Prometheus instance label.
func normalizeNodeName(v string) string {
	v = strings.ToLower(strings.TrimSpace(v))
	v = strings.Split(v, ":")[0]
	v = strings.Split(v, ".")[0]
	return v
}

// metricNodeName extracts the best node identifier from a Prometheus metric map.
func metricNodeName(m map[string]string) string {
	for _, k := range []string{"node", "nodename", "kubernetes_node", "exported_node", "instance"} {
		if v := m[k]; v != "" {
			return v
		}
	}
	return ""
}

// collectNodeNames returns a deduplicated sorted list of node names.
func collectNodeNames(sets ...[]promSample) []string {
	seen := map[string]struct{}{}
	for _, samples := range sets {
		for _, s := range samples {
			name := normalizeNodeName(metricNodeName(s.Metric))
			if name != "" {
				seen[name] = struct{}{}
			}
		}
	}
	names := make([]string, 0, len(seen))
	for n := range seen {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}

// findNodeVal finds a metric value matching a node name (fuzzy hostname match).
func findNodeVal(samples []promSample, nodeName string) (float64, bool) {
	nodeNorm := normalizeNodeName(nodeName)
	for _, s := range samples {
		metricNorm := normalizeNodeName(metricNodeName(s.Metric))
		if metricNorm == nodeNorm || strings.Contains(metricNorm, nodeNorm) || strings.Contains(nodeNorm, metricNorm) {
			return s.Value, true
		}
	}
	return 0, false
}

// findPodVal finds a metric value for a specific pod in a namespace.
func findPodVal(samples []promSample, ns, pod string) float64 {
	for _, s := range samples {
		if s.Metric["pod"] == pod && s.Metric["namespace"] == ns {
			return s.Value
		}
	}
	return 0
}
