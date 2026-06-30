package handlers

import (
	"context"
	"testing"

	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/flexinfer/flexdeck/internal/qdrant"
)

func loomPlansFakeQdrant() *fakeQdrant {
	return &fakeQdrant{byCollection: map[string][]qdrant.Point{
		qdrantPlansCollection: {
			{Payload: map[string]any{
				"id": "plan-a", "slug": "plan-a", "title": "Plan A",
				"project": "services/x", "namespace": "x/feat", "status": "in_progress",
				"kill_test_status": "passed 2026-06-30", "kill_test": "curl mills",
				"riskiest_assumption": "mills reachable",
				"mr_refs":             []any{"https://gl/x/-/merge_requests/1", "https://gl/x/-/merge_requests/2"},
				"pipeline_refs":       []any{"p1"},
				"gitlab_issue_iid":    float64(7),
				"mills_backlog_id":    "MILLS-1",
				"created_by":          "claude-code",
				"created_at":          "2026-06-29T08:00:00Z",
				"updated_at":          "2026-06-30T10:00:00Z",
				"success_json":        `{"tests":["go test ./..."],"manual_check":"diff"}`,
				"phase_history_json":  `[{"from":"planned","to":"in_progress","at":"2026-06-30T09:00:00Z","note":"start"}]`,
			}},
			{Payload: map[string]any{
				"id": "plan-b", "slug": "plan-b", "title": "Plan B",
				"project": "services/y", "namespace": "y/feat", "status": "draft",
				"updated_at": "2026-06-29T10:00:00Z",
			}},
		},
		qdrantPlanSlicesCollection: {
			{Payload: map[string]any{"plan_id": "plan-a", "order": float64(2), "name": "s2", "status": "pending", "goal": "second"}},
			{Payload: map[string]any{"plan_id": "plan-a", "order": float64(1), "name": "s1", "status": "merged", "goal": "first", "files": []any{"a.go"}, "mr_ref": "m1"}},
			{Payload: map[string]any{"plan_id": "plan-b", "order": float64(1), "name": "b1", "status": "pending"}},
		},
	}}
}

func newLoomPlansHandler() *Handler {
	return &Handler{
		cfg:    &config.Config{GitLab: config.GitLabConfig{URL: "https://gitlab.example"}},
		qdrant: loomPlansFakeQdrant(),
	}
}

func TestListLoomPlans(t *testing.T) {
	h := newLoomPlansHandler()
	res, err := h.listLoomPlans(context.Background(), loomPlanFilter{})
	if err != nil {
		t.Fatalf("listLoomPlans: %v", err)
	}
	if len(res.Plans) != 2 {
		t.Fatalf("expected 2 plans, got %d", len(res.Plans))
	}
	// Sorted most-recently-updated first → plan-a (06-30) before plan-b (06-29).
	if res.Plans[0].ID != "plan-a" || res.Plans[1].ID != "plan-b" {
		t.Fatalf("unexpected order: %s, %s", res.Plans[0].ID, res.Plans[1].ID)
	}
	a := res.Plans[0]
	if a.SliceTotal != 2 || a.SliceDone != 1 {
		t.Errorf("plan-a slice rollup: total=%d done=%d (want 2/1)", a.SliceTotal, a.SliceDone)
	}
	if a.MRRefs != 2 {
		t.Errorf("plan-a mr_refs count = %d (want 2)", a.MRRefs)
	}
	if a.Phase != "in_progress" {
		t.Errorf("plan-a phase = %q (want in_progress, read from status)", a.Phase)
	}
	if a.IssueURL != "https://gitlab.example/services/x/-/issues/7" {
		t.Errorf("plan-a issue url = %q", a.IssueURL)
	}
	if res.Plans[1].SliceTotal != 1 {
		t.Errorf("plan-b slice total = %d (want 1)", res.Plans[1].SliceTotal)
	}
}

func TestListLoomPlansPhaseFilter(t *testing.T) {
	h := newLoomPlansHandler()
	res, err := h.listLoomPlans(context.Background(), loomPlanFilter{phase: "draft"})
	if err != nil {
		t.Fatalf("listLoomPlans: %v", err)
	}
	if len(res.Plans) != 1 || res.Plans[0].ID != "plan-b" {
		t.Fatalf("phase filter should yield only plan-b, got %+v", res.Plans)
	}
}

func TestListLoomPlansScrollError(t *testing.T) {
	h := &Handler{
		cfg:    &config.Config{},
		qdrant: &fakeQdrant{errCollections: map[string]bool{qdrantPlansCollection: true}},
	}
	if _, err := h.listLoomPlans(context.Background(), loomPlanFilter{}); err == nil {
		t.Fatal("expected error when the plans scroll fails (so cache serves stale)")
	}
}

func TestGetLoomPlanDetail(t *testing.T) {
	h := newLoomPlansHandler()
	d, err := h.getLoomPlan(context.Background(), "plan-a")
	if err != nil {
		t.Fatalf("getLoomPlan: %v", err)
	}
	if d == nil {
		t.Fatal("expected plan-a detail, got nil")
	}
	if d.KillTest != "curl mills" {
		t.Errorf("kill_test = %q", d.KillTest)
	}
	if d.Success == nil || len(d.Success.Tests) != 1 || d.Success.ManualCheck != "diff" {
		t.Errorf("success = %+v", d.Success)
	}
	if len(d.PhaseHistory) != 1 || d.PhaseHistory[0].To != "in_progress" {
		t.Errorf("phase history = %+v", d.PhaseHistory)
	}
	if len(d.MRRefList) != 2 {
		t.Errorf("mr_ref_list = %+v", d.MRRefList)
	}
	// Slices ordered by Order; only plan-a's two slices.
	if len(d.Slices) != 2 || d.Slices[0].Name != "s1" || d.Slices[1].Name != "s2" {
		t.Fatalf("slices = %+v", d.Slices)
	}
	if d.SliceTotal != 2 || d.SliceDone != 1 {
		t.Errorf("detail rollup total=%d done=%d (want 2/1)", d.SliceTotal, d.SliceDone)
	}
	if d.Slices[0].MRRef != "m1" || len(d.Slices[0].Files) != 1 {
		t.Errorf("slice s1 detail = %+v", d.Slices[0])
	}
}

func TestGetLoomPlanNotFound(t *testing.T) {
	h := newLoomPlansHandler()
	d, err := h.getLoomPlan(context.Background(), "missing")
	if err != nil {
		t.Fatalf("getLoomPlan: %v", err)
	}
	if d != nil {
		t.Fatalf("expected nil for missing plan, got %+v", d)
	}
}
