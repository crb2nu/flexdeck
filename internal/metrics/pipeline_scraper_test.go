package metrics

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/flexinfer/flexdeck/internal/config"
)

// GitLab's jobs API returns jobs newest-first (descending id). The scraper must
// (a) preserve every job so fan-out counts survive, and (b) order stages by
// definition order (ascending id), not the reversed API order.
func TestFetchPipelineJobs_PreservesFanoutAndOrdersByDefinition(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		// build (ids 10,11) is defined before test (ids 20-22); the API returns
		// them descending: test first, then build.
		_, _ = fmt.Fprint(w, `[
			{"id":22,"name":"test 3/3","stage":"test","status":"success","duration":3},
			{"id":21,"name":"test 2/3","stage":"test","status":"running","duration":2},
			{"id":20,"name":"test 1/3","stage":"test","status":"success","duration":1},
			{"id":11,"name":"build b","stage":"build","status":"success","duration":5},
			{"id":10,"name":"build a","stage":"build","status":"success","duration":4}
		]`)
	}))
	defer ts.Close()

	ps := &PipelineScraper{
		cfg:    config.GitLabConfig{URL: ts.URL, Token: "test-token"},
		client: &http.Client{},
	}

	stages, err := ps.fetchPipelineJobs(context.Background(), 1, 100)
	if err != nil {
		t.Fatalf("fetchPipelineJobs: %v", err)
	}

	if len(stages) != 2 {
		t.Fatalf("expected 2 stages, got %d", len(stages))
	}
	// Ascending-id order → build before test (not the reversed API order).
	if stages[0].Name != "build" || stages[1].Name != "test" {
		t.Fatalf("expected stage order [build test], got [%s %s]", stages[0].Name, stages[1].Name)
	}
	// Fan-out preserved: build has 2 jobs, test has 3.
	if len(stages[0].Jobs) != 2 {
		t.Errorf("build stage: expected 2 jobs, got %d", len(stages[0].Jobs))
	}
	if len(stages[1].Jobs) != 3 {
		t.Errorf("test stage: expected 3 jobs, got %d", len(stages[1].Jobs))
	}
	// Jobs within a stage are also ordered ascending by id.
	if stages[0].Jobs[0].Name != "build a" {
		t.Errorf("expected first build job 'build a', got %q", stages[0].Jobs[0].Name)
	}
	// A running job promotes the stage status.
	if stages[1].Status != "running" {
		t.Errorf("expected test stage status 'running', got %q", stages[1].Status)
	}
}
