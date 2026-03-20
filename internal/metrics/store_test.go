package metrics

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/flexinfer/flexdeck/internal/litellm"
	"github.com/redis/go-redis/v9"
)

func TestStore_Metrics(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()

	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	store := &Store{redis: client}

	ctx := context.Background()
	now := time.Now()

	model := "gpt-4"
	m1 := litellm.ModelMetrics{
		Model:          model,
		TotalTokens:    1000,
		OutputTokens:   400,
		InputTokens:    600,
		RequestCount:   10,
		TotalLatencyMs: 500,
		Timestamp:      now.Add(-60 * time.Second),
	}
	m2 := litellm.ModelMetrics{
		Model:          model,
		TotalTokens:    2000,
		OutputTokens:   800,
		InputTokens:    1200,
		RequestCount:   20,
		TotalLatencyMs: 600,
		Timestamp:      now,
	}

	// We can't easily mock time.Now() inside StoreMetrics, so we'll just push two points
	// and accept that they might have identical timestamps if we run too fast.
	// But calculateThroughput uses the point's recorded Timestamp (from now.Unix()).

	err := store.StoreMetrics(ctx, []litellm.ModelMetrics{m1})
	if err != nil {
		t.Fatalf("StoreMetrics failed: %v", err)
	}

	// Wait a bit to ensure different timestamp if needed
	time.Sleep(1 * time.Second)

	err = store.StoreMetrics(ctx, []litellm.ModelMetrics{m2})
	if err != nil {
		t.Fatalf("StoreMetrics failed: %v", err)
	}

	throughput, err := store.GetModelThroughput(ctx, model)
	if err != nil {
		t.Fatalf("GetModelThroughput failed: %v", err)
	}

	if throughput.Model != model {
		t.Errorf("expected model %q, got %q", model, throughput.Model)
	}

	if throughput.RequestsPerMin <= 0 {
		t.Errorf("expected positive requests per min, got %f", throughput.RequestsPerMin)
	}

	if throughput.TokPerSec1m <= 0 {
		t.Errorf("expected positive tokens per sec, got %f", throughput.TokPerSec1m)
	}

	if throughput.AvgLatencyMs != 600 {
		t.Errorf("expected latency 600, got %f", throughput.AvgLatencyMs)
	}

	// Test List all
	list, err := store.GetThroughput(ctx)
	if err != nil {
		t.Fatalf("GetThroughput failed: %v", err)
	}
	if len(list) != 1 {
		t.Errorf("expected 1 model in list, got %d", len(list))
	}
}

func TestStore_MaterializedThroughput(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()

	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	store := &Store{redis: client}
	ctx := context.Background()

	m1 := litellm.ModelMetrics{
		Model: "llama-3", TotalTokens: 1000, OutputTokens: 400,
		InputTokens: 600, RequestCount: 10, TotalLatencyMs: 500,
	}
	m2 := litellm.ModelMetrics{
		Model: "llama-3", TotalTokens: 2000, OutputTokens: 800,
		InputTokens: 1200, RequestCount: 20, TotalLatencyMs: 600,
	}

	if err := store.StoreMetrics(ctx, []litellm.ModelMetrics{m1}); err != nil {
		t.Fatalf("StoreMetrics(1) failed: %v", err)
	}
	time.Sleep(1 * time.Second)
	if err := store.StoreMetrics(ctx, []litellm.ModelMetrics{m2}); err != nil {
		t.Fatalf("StoreMetrics(2) failed: %v", err)
	}

	// StoreMetrics should have materialized the summary
	exists := client.Exists(ctx, throughputSummaryKey).Val()
	if exists != 1 {
		t.Fatalf("expected materialized key %q to exist", throughputSummaryKey)
	}

	// GetThroughput should read from the materialized key
	list, err := store.GetThroughput(ctx)
	if err != nil {
		t.Fatalf("GetThroughput failed: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 model, got %d", len(list))
	}
	if list[0].Model != "llama-3" {
		t.Errorf("expected model llama-3, got %q", list[0].Model)
	}
}

func TestStore_ThroughputFallbackOnMiss(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()

	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	store := &Store{redis: client}
	ctx := context.Background()

	m1 := litellm.ModelMetrics{
		Model: "mistral", TotalTokens: 500, OutputTokens: 200,
		InputTokens: 300, RequestCount: 5, TotalLatencyMs: 100,
	}
	m2 := litellm.ModelMetrics{
		Model: "mistral", TotalTokens: 1500, OutputTokens: 600,
		InputTokens: 900, RequestCount: 15, TotalLatencyMs: 200,
	}

	if err := store.StoreMetrics(ctx, []litellm.ModelMetrics{m1}); err != nil {
		t.Fatalf("StoreMetrics failed: %v", err)
	}
	time.Sleep(1 * time.Second)
	if err := store.StoreMetrics(ctx, []litellm.ModelMetrics{m2}); err != nil {
		t.Fatalf("StoreMetrics failed: %v", err)
	}

	// Delete the materialized key to simulate cold start
	client.Del(ctx, throughputSummaryKey)

	// GetThroughput should fall back to computation
	list, err := store.GetThroughput(ctx)
	if err != nil {
		t.Fatalf("GetThroughput fallback failed: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 model on fallback, got %d", len(list))
	}
	if list[0].Model != "mistral" {
		t.Errorf("expected model mistral, got %q", list[0].Model)
	}
}

func TestStore_MaterializedPipelineTrends(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()

	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	store := &Store{redis: client}
	ctx := context.Background()

	now := time.Now()
	runs := []PipelineRun{
		{PipelineID: 1, ProjectID: 42, Status: "success", Duration: 120, CreatedAt: now.Add(-2 * time.Hour)},
		{PipelineID: 2, ProjectID: 42, Status: "failed", Duration: 90, CreatedAt: now.Add(-1 * time.Hour)},
		{PipelineID: 3, ProjectID: 42, Status: "success", Duration: 150, CreatedAt: now},
	}

	for _, r := range runs {
		if err := store.StorePipelineRun(ctx, r); err != nil {
			t.Fatalf("StorePipelineRun failed: %v", err)
		}
	}

	// Per-project summary should exist
	summaryKey := pipelineTrendSummaryPrefix + "42"
	if client.Exists(ctx, summaryKey).Val() != 1 {
		t.Fatalf("expected per-project summary key to exist")
	}

	// GetPipelineTrends should read from materialized key
	trend, err := store.GetPipelineTrends(ctx, 42, 7*24*time.Hour)
	if err != nil {
		t.Fatalf("GetPipelineTrends failed: %v", err)
	}
	if trend.TotalRuns != 3 {
		t.Errorf("expected 3 runs, got %d", trend.TotalRuns)
	}

	// Delete summary and verify fallback
	client.Del(ctx, summaryKey)
	trend, err = store.GetPipelineTrends(ctx, 42, 7*24*time.Hour)
	if err != nil {
		t.Fatalf("GetPipelineTrends fallback failed: %v", err)
	}
	if trend.TotalRuns != 3 {
		t.Errorf("expected 3 runs on fallback, got %d", trend.TotalRuns)
	}
}

func TestStore_MaterializeAllPipelineTrends(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()

	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	store := &Store{redis: client}
	ctx := context.Background()

	now := time.Now()
	// Two projects
	for _, pid := range []int{10, 20} {
		run := PipelineRun{
			PipelineID: pid*10 + 1, ProjectID: pid,
			Status: "success", Duration: 60, CreatedAt: now,
		}
		if err := store.StorePipelineRun(ctx, run); err != nil {
			t.Fatalf("StorePipelineRun(%d) failed: %v", pid, err)
		}
	}

	store.MaterializeAllPipelineTrends(ctx)

	// All-projects summary should exist
	if client.Exists(ctx, pipelineAllTrendsSummary).Val() != 1 {
		t.Fatal("expected all-trends summary key to exist")
	}

	trends, err := store.GetMaterializedAllTrends(ctx)
	if err != nil {
		t.Fatalf("GetMaterializedAllTrends failed: %v", err)
	}
	if len(trends) != 2 {
		t.Errorf("expected 2 project trends, got %d", len(trends))
	}
}

func TestStore_GetDashboardSummary(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()

	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	store := &Store{redis: client}
	ctx := context.Background()

	// No key → error
	_, err := store.GetDashboardSummary(ctx)
	if err == nil {
		t.Fatal("expected error when summary key missing")
	}

	// Write a valid summary
	summary := DashboardSummary{
		Cluster: ClusterResources{CPUPercent: 42.5, MemoryUsed: 1e10, MemoryTotal: 3.2e10},
		Nodes: []NodeResources{
			{Node: "node-1", CPUPercent: float64Ptr(60)},
		},
		UpdatedAt: time.Now(),
	}
	data, _ := json.Marshal(summary)
	client.Set(ctx, dashboardSummaryKey, data, dashboardSummaryTTL)

	got, err := store.GetDashboardSummary(ctx)
	if err != nil {
		t.Fatalf("GetDashboardSummary failed: %v", err)
	}
	if got.Cluster.CPUPercent != 42.5 {
		t.Errorf("expected cluster cpu 42.5, got %f", got.Cluster.CPUPercent)
	}
	if len(got.Nodes) != 1 || got.Nodes[0].Node != "node-1" {
		t.Errorf("unexpected nodes: %+v", got.Nodes)
	}
}

func TestStore_GetDashboardSummary_Stale(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()

	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	store := &Store{redis: client}
	ctx := context.Background()

	// Write a summary with old timestamp
	summary := DashboardSummary{
		Cluster:   ClusterResources{CPUPercent: 10},
		UpdatedAt: time.Now().Add(-2 * time.Minute), // well past 45s stale window
	}
	data, _ := json.Marshal(summary)
	client.Set(ctx, dashboardSummaryKey, data, 5*time.Minute)

	_, err := store.GetDashboardSummary(ctx)
	if err == nil {
		t.Fatal("expected stale error")
	}
}

func TestStore_GetDashboardSummaryWithRefresh_ServesStaleOnRefreshFailure(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()

	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	store := &Store{redis: client}
	ctx := context.Background()

	summary := DashboardSummary{
		Cluster:   ClusterResources{CPUPercent: 10},
		UpdatedAt: time.Now().Add(-2 * time.Minute),
	}
	data, _ := json.Marshal(summary)
	client.Set(ctx, dashboardSummaryKey, data, 5*time.Minute)

	got, err := store.GetDashboardSummaryWithRefresh(ctx, "http://127.0.0.1:1")
	if err != nil {
		t.Fatalf("expected stale summary fallback, got error: %v", err)
	}
	if got.Cluster.CPUPercent != 10 {
		t.Fatalf("expected stale cluster cpu 10, got %f", got.Cluster.CPUPercent)
	}
}

func TestStore_MaterializeDashboardSummary(t *testing.T) {
	// Start a mock Prometheus server
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/query", func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query().Get("query")
		var result string
		switch {
		case query == dashboardQueries["clusterCpu"]:
			result = `{"status":"success","data":{"resultType":"vector","result":[{"metric":{},"value":[1,"55.5"]}]}}`
		case query == dashboardQueries["clusterMemUsed"]:
			result = `{"status":"success","data":{"resultType":"vector","result":[{"metric":{},"value":[1,"8000000000"]}]}}`
		case query == dashboardQueries["clusterMemTotal"]:
			result = `{"status":"success","data":{"resultType":"vector","result":[{"metric":{},"value":[1,"16000000000"]}]}}`
		default:
			result = `{"status":"success","data":{"resultType":"vector","result":[]}}`
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, result)
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()

	mr, _ := miniredis.Run()
	defer mr.Close()

	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	store := &Store{redis: client}
	ctx := context.Background()

	// Key should not exist yet
	if client.Exists(ctx, dashboardSummaryKey).Val() != 0 {
		t.Fatal("expected key absent before materialization")
	}

	store.MaterializeDashboardSummary(ctx, ts.URL)

	// Key should now exist
	if client.Exists(ctx, dashboardSummaryKey).Val() != 1 {
		t.Fatal("expected key present after materialization")
	}

	got, err := store.GetDashboardSummary(ctx)
	if err != nil {
		t.Fatalf("GetDashboardSummary after materialize: %v", err)
	}
	if got.Cluster.CPUPercent != 55.5 {
		t.Errorf("expected cluster cpu 55.5, got %f", got.Cluster.CPUPercent)
	}
	if got.Cluster.MemoryUsed != 8e9 {
		t.Errorf("expected cluster mem used 8e9, got %f", got.Cluster.MemoryUsed)
	}
}

func float64Ptr(v float64) *float64 { return &v }

func TestStore_GetThroughput_RehydratesSummaryOnMiss(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()

	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	store := &Store{redis: client}
	ctx := context.Background()

	m1 := litellm.ModelMetrics{
		Model: "rehydrate", TotalTokens: 500, OutputTokens: 200,
		InputTokens: 300, RequestCount: 5, TotalLatencyMs: 100,
	}
	m2 := litellm.ModelMetrics{
		Model: "rehydrate", TotalTokens: 1500, OutputTokens: 600,
		InputTokens: 900, RequestCount: 15, TotalLatencyMs: 200,
	}

	if err := store.StoreMetrics(ctx, []litellm.ModelMetrics{m1}); err != nil {
		t.Fatalf("StoreMetrics(1) failed: %v", err)
	}
	time.Sleep(1 * time.Second)
	if err := store.StoreMetrics(ctx, []litellm.ModelMetrics{m2}); err != nil {
		t.Fatalf("StoreMetrics(2) failed: %v", err)
	}

	client.Del(ctx, throughputSummaryKey)

	throughput, err := store.GetThroughput(ctx)
	if err != nil {
		t.Fatalf("GetThroughput failed: %v", err)
	}
	if len(throughput) != 1 {
		t.Fatalf("expected 1 throughput entry, got %d", len(throughput))
	}
	if client.Exists(ctx, throughputSummaryKey).Val() != 1 {
		t.Fatal("expected throughput summary key to be re-materialized")
	}
}

func TestStore_DirtyProjectsSet(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()

	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	store := &Store{redis: client}
	ctx := context.Background()

	now := time.Now()
	// Store runs for project 100 and 200
	for _, pid := range []int{100, 200} {
		run := PipelineRun{
			PipelineID: pid*10 + 1, ProjectID: pid,
			Status: "success", Duration: 60, CreatedAt: now,
		}
		if err := store.StorePipelineRun(ctx, run); err != nil {
			t.Fatalf("StorePipelineRun(%d) failed: %v", pid, err)
		}
	}

	// dirty set should contain both project IDs
	members, err := client.SMembers(ctx, dirtyProjectsKey).Result()
	if err != nil {
		t.Fatalf("SMembers failed: %v", err)
	}
	if len(members) != 2 {
		t.Fatalf("expected 2 dirty projects, got %d", len(members))
	}

	// Seed the all-projects summary first so dirty materialization can merge
	store.MaterializeAllPipelineTrends(ctx)

	// Add one more run for project 100 only
	run := PipelineRun{
		PipelineID: 1099, ProjectID: 100,
		Status: "failed", Duration: 120, CreatedAt: now.Add(time.Minute),
	}
	if err := store.StorePipelineRun(ctx, run); err != nil {
		t.Fatalf("StorePipelineRun(100) failed: %v", err)
	}

	store.MaterializeDirtyPipelineTrends(ctx)

	// dirty set should be cleared
	remaining, _ := client.SMembers(ctx, dirtyProjectsKey).Result()
	if len(remaining) != 0 {
		t.Errorf("expected dirty set to be empty, got %v", remaining)
	}

	// All-projects summary should still have both projects
	trends, err := store.GetMaterializedAllTrends(ctx)
	if err != nil {
		t.Fatalf("GetMaterializedAllTrends failed: %v", err)
	}
	if len(trends) != 2 {
		t.Errorf("expected 2 projects in merged summary, got %d", len(trends))
	}

	// Project 100 should now have 2 runs (the original + the new one)
	for _, tr := range trends {
		if tr.ProjectID == 100 && tr.TotalRuns != 2 {
			t.Errorf("expected project 100 to have 2 runs, got %d", tr.TotalRuns)
		}
	}
}

func TestStore_Trend(t *testing.T) {
	store := &Store{}

	cases := []struct {
		data []float64
		want string
	}{
		{[]float64{10, 10, 10, 10}, "stable"},
		{[]float64{10, 10, 20, 20}, "up"},
		{[]float64{20, 20, 10, 10}, "down"},
		{[]float64{10, 11}, "stable"}, // too few points
	}

	for _, tc := range cases {
		got := store.detectTrend(tc.data)
		if got != tc.want {
			t.Errorf("detectTrend(%v) = %q, want %q", tc.data, got, tc.want)
		}
	}
}
