package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/flexinfer/flexdeck/internal/qdrant"
)

// fakeQdrant is an injectable, goroutine-safe qdrantScroller for hermetic
// tests. The handler scrolls collections concurrently (errgroup), so the
// recorded filters must be guarded.
type fakeQdrant struct {
	// byCollection maps a collection name to the points it returns.
	byCollection map[string][]qdrant.Point
	// errCollections forces an error for the named collections.
	errCollections map[string]bool

	mu sync.Mutex
	// lastFilters records the filter passed per collection (for assertions).
	lastFilters map[string]map[string]any
}

func (f *fakeQdrant) Scroll(_ context.Context, collection string, filter map[string]any, _ int) ([]qdrant.Point, error) {
	f.mu.Lock()
	if f.lastFilters == nil {
		f.lastFilters = map[string]map[string]any{}
	}
	f.lastFilters[collection] = filter
	f.mu.Unlock()

	if f.errCollections[collection] {
		return nil, fmt.Errorf("qdrant %s unavailable", collection)
	}
	return f.byCollection[collection], nil
}

// filterFor returns the recorded filter for a collection under the lock.
func (f *fakeQdrant) filterFor(collection string) map[string]any {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.lastFilters[collection]
}

// newGitLabStub returns an httptest server emulating the GitLab REST endpoints
// the project handlers touch. handler may override behavior per path.
func newGitLabStub(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	return httptest.NewServer(handler)
}

func decodeDetail(t *testing.T, body []byte) projectDetail {
	t.Helper()
	var d projectDetail
	if err := json.Unmarshal(body, &d); err != nil {
		t.Fatalf("decode detail: %v\nbody=%s", err, string(body))
	}
	return d
}

func TestGetProject_MergesAllSources(t *testing.T) {
	ts := newGitLabStub(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.Contains(r.URL.Path, "/issues"):
			_, _ = fmt.Fprint(w, `[{"iid":1,"title":"bug","state":"opened","labels":["x"],"web_url":"http://gl/issues/1"}]`)
		case strings.Contains(r.URL.Path, "/milestones"):
			_, _ = fmt.Fprint(w, `[{"id":7,"title":"v1","state":"active","due_date":"2999-01-01","web_url":"http://gl/m/7"}]`)
		default:
			w.WriteHeader(http.StatusOK)
			_, _ = fmt.Fprint(w, `[]`)
		}
	})
	defer ts.Close()

	fq := &fakeQdrant{
		byCollection: map[string][]qdrant.Point{
			qdrantTasksCollection: {
				{Payload: map[string]any{"id": "t1", "title": "task one", "status": "in_progress", "priority": "high", "session_id": "s1"}},
				{Payload: map[string]any{"id": "t2", "title": "task two", "status": "completed", "priority": "low", "session_id": "s1"}},
			},
			qdrantRisksCollection: {
				{Payload: map[string]any{"id": "r1", "title": "risk one", "likelihood": "medium", "impact": "high", "status": "open"}},
			},
			qdrantContextCollection: {
				{Payload: map[string]any{"id": "d1", "title": "chose Qdrant for risks", "timestamp": "2026-06-19T22:00:00Z", "entry_type": "decision"}},
			},
			qdrantPlansCollection: {
				// gitlab_issue_iid is float64 to mirror JSON decoding of Qdrant numbers.
				{Payload: map[string]any{"id": "plan-x-1", "slug": "x", "title": "Plan one", "status": "in_progress", "mr_refs": []any{"!10", "!11"}, "kill_test_status": "passed", "riskiest_assumption": "the store is reachable cross-process", "gitlab_issue_iid": float64(17)}},
			},
			// Slice detail for plan-x-1, deliberately out of order to test sorting:
			// 4 slices, 3 landed (merged/integrated). order is float64 (JSON numbers).
			qdrantPlanSlicesCollection: {
				{Payload: map[string]any{"id": "s2", "plan_id": "plan-x-1", "status": "merged", "order": float64(2), "name": "slice two", "mr_ref": "!11"}},
				{Payload: map[string]any{"id": "s4", "plan_id": "plan-x-1", "status": "implementing", "order": float64(4), "name": "slice four"}},
				{Payload: map[string]any{"id": "s1", "plan_id": "plan-x-1", "status": "merged", "order": float64(1), "name": "slice one", "mr_ref": "!10"}},
				{Payload: map[string]any{"id": "s3", "plan_id": "plan-x-1", "status": "integrated", "order": float64(3), "name": "slice three", "mr_ref": "!13"}},
			},
		},
	}

	cfg := &config.Config{}
	cfg.GitLab.URL = ts.URL
	cfg.GitLab.Token = "tok"
	h := &Handler{cfg: cfg, gitlabClient: newGitLabClient(), qdrant: fq}

	rr := serveProject(h, "services/flexdeck")
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	d := decodeDetail(t, rr.Body.Bytes())

	if d.Project != "services/flexdeck" {
		t.Errorf("project = %q, want services/flexdeck", d.Project)
	}
	if d.Partial {
		t.Errorf("expected partial=false, got true")
	}
	if len(d.Issues) != 1 || d.Issues[0].IID != 1 {
		t.Errorf("issues = %+v", d.Issues)
	}
	if len(d.Milestones) != 1 || d.Milestones[0].ID != 7 {
		t.Errorf("milestones = %+v", d.Milestones)
	}
	if len(d.Tasks) != 2 {
		t.Errorf("tasks len = %d, want 2", len(d.Tasks))
	}
	if len(d.Risks) != 1 || d.Risks[0].ID != "r1" {
		t.Errorf("risks = %+v", d.Risks)
	}
	// Decisions come from the agent-context journal, filtered by project+type.
	if len(d.Decisions) != 1 || d.Decisions[0].ID != "d1" {
		t.Errorf("decisions = %+v, want one (d1)", d.Decisions)
	}
	if d.Decisions[0].DecidedAt != "2026-06-19T22:00:00Z" {
		t.Errorf("decision decided_at = %q", d.Decisions[0].DecidedAt)
	}

	// Plans come from the agent_plans_v1 store; phase is the "status" payload key.
	if len(d.Plans) != 1 || d.Plans[0].ID != "plan-x-1" {
		t.Errorf("plans = %+v, want one (plan-x-1)", d.Plans)
	}
	if d.Plans[0].Phase != "in_progress" || d.Plans[0].MRRefs != 2 {
		t.Errorf("plan phase/mr_refs = %q/%d, want in_progress/2", d.Plans[0].Phase, d.Plans[0].MRRefs)
	}
	// Planning contract: kill-test status + born-linked GitLab issue URL.
	if d.Plans[0].KillTestStatus != "passed" {
		t.Errorf("plan kill_test_status = %q, want passed", d.Plans[0].KillTestStatus)
	}
	if d.Plans[0].IssueIID != 17 {
		t.Errorf("plan issue_iid = %d, want 17", d.Plans[0].IssueIID)
	}
	wantIssueURL := ts.URL + "/services/flexdeck/-/issues/17"
	if d.Plans[0].IssueURL != wantIssueURL {
		t.Errorf("plan issue_url = %q, want %q", d.Plans[0].IssueURL, wantIssueURL)
	}
	// Slice progress: 4 total, 3 landed (2 merged + 1 integrated).
	if d.Plans[0].SliceTotal != 4 || d.Plans[0].SliceDone != 3 {
		t.Errorf("plan slices = %d/%d, want 3/4 done", d.Plans[0].SliceDone, d.Plans[0].SliceTotal)
	}
	// Riskiest assumption surfaced from the plan payload for the drill-in.
	if d.Plans[0].RiskiestAssumption != "the store is reachable cross-process" {
		t.Errorf("plan riskiest_assumption = %q", d.Plans[0].RiskiestAssumption)
	}
	// Slice detail must be returned and sorted by order, regardless of scroll order.
	if len(d.Plans[0].Slices) != 4 {
		t.Fatalf("plan slices detail len = %d, want 4", len(d.Plans[0].Slices))
	}
	if d.Plans[0].Slices[0].Order != 1 || d.Plans[0].Slices[0].Name != "slice one" || d.Plans[0].Slices[0].MRRef != "!10" {
		t.Errorf("slice[0] = %+v, want order 1 'slice one' !10", d.Plans[0].Slices[0])
	}
	if d.Plans[0].Slices[3].Order != 4 || d.Plans[0].Slices[3].Phase != "implementing" {
		t.Errorf("slice[3] = %+v, want order 4 implementing", d.Plans[0].Slices[3])
	}
	// The slice scroll must target the plan_id keyword.
	gotSliceFilter := fq.filterFor(qdrantPlanSlicesCollection)
	if fmt.Sprintf("%v", gotSliceFilter) != fmt.Sprintf("%v", qdrant.MatchKeyword("plan_id", "plan-x-1")) {
		t.Errorf("slice filter = %v, want plan_id match", gotSliceFilter)
	}
	gotPlanFilter := fq.filterFor(qdrantPlansCollection)
	if fmt.Sprintf("%v", gotPlanFilter) != fmt.Sprintf("%v", qdrant.MatchProject("services/flexdeck")) {
		t.Errorf("plans filter = %v, want project match", gotPlanFilter)
	}

	// The Qdrant filter must target the canonical project key.
	gotFilter := fq.filterFor(qdrantTasksCollection)
	if fmt.Sprintf("%v", gotFilter) != fmt.Sprintf("%v", qdrant.MatchProject("services/flexdeck")) {
		t.Errorf("tasks filter = %v, want project match for services/flexdeck", gotFilter)
	}
	// Decisions filter must target both project and entry_type=decision.
	gotDecFilter := fq.filterFor(qdrantContextCollection)
	if fmt.Sprintf("%v", gotDecFilter) != fmt.Sprintf("%v", qdrant.MatchProjectAndEntryType("services/flexdeck", "decision")) {
		t.Errorf("decisions filter = %v, want project+entry_type match", gotDecFilter)
	}
}

func TestGetProject_OneSourceDownIsPartial(t *testing.T) {
	// GitLab milestones endpoint errors (500); issues still succeed.
	ts := newGitLabStub(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/milestones") {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "/issues") {
			_, _ = fmt.Fprint(w, `[{"iid":9,"title":"open","state":"opened","labels":[],"web_url":"u"}]`)
			return
		}
		_, _ = fmt.Fprint(w, `[]`)
	})
	defer ts.Close()

	// Risks collection errors (e.g. pm_risks missing); tasks succeed.
	fq := &fakeQdrant{
		byCollection: map[string][]qdrant.Point{
			qdrantTasksCollection: {
				{Payload: map[string]any{"id": "t1", "title": "task", "status": "pending", "priority": "med", "session_id": "s"}},
			},
		},
		errCollections: map[string]bool{qdrantRisksCollection: true},
	}

	cfg := &config.Config{}
	cfg.GitLab.URL = ts.URL
	cfg.GitLab.Token = "tok"
	h := &Handler{cfg: cfg, gitlabClient: newGitLabClient(), qdrant: fq}

	rr := serveProject(h, "services/flexdeck")
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 despite source failure, got %d", rr.Code)
	}
	d := decodeDetail(t, rr.Body.Bytes())

	if !d.Partial {
		t.Errorf("expected partial=true when a source fails")
	}
	// Surviving sources are still present.
	if len(d.Issues) != 1 {
		t.Errorf("issues should survive, got %+v", d.Issues)
	}
	if len(d.Tasks) != 1 {
		t.Errorf("tasks should survive, got %+v", d.Tasks)
	}
	// Failed sources degrade to empty (never nil in JSON).
	if d.Milestones == nil || len(d.Milestones) != 0 {
		t.Errorf("milestones should be empty slice, got %+v", d.Milestones)
	}
	if d.Risks == nil || len(d.Risks) != 0 {
		t.Errorf("risks should be empty slice, got %+v", d.Risks)
	}
}

func TestGetProject_EmptyProject(t *testing.T) {
	ts := newGitLabStub(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `[]`)
	})
	defer ts.Close()

	fq := &fakeQdrant{byCollection: map[string][]qdrant.Point{}}

	cfg := &config.Config{}
	cfg.GitLab.URL = ts.URL
	cfg.GitLab.Token = "tok"
	h := &Handler{cfg: cfg, gitlabClient: newGitLabClient(), qdrant: fq}

	rr := serveProject(h, "services/empty")
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	d := decodeDetail(t, rr.Body.Bytes())

	if d.Partial {
		t.Errorf("expected partial=false for clean-but-empty project")
	}
	// All arrays must serialize as [] not null (frozen contract).
	for name, arr := range map[string]int{
		"tasks":      len(d.Tasks),
		"issues":     len(d.Issues),
		"milestones": len(d.Milestones),
		"risks":      len(d.Risks),
		"decisions":  len(d.Decisions),
	} {
		if arr != 0 {
			t.Errorf("%s expected empty, got %d", name, arr)
		}
	}
	body := rr.Body.String()
	for _, key := range []string{`"tasks":[]`, `"issues":[]`, `"milestones":[]`, `"risks":[]`, `"decisions":[]`} {
		if !strings.Contains(strings.ReplaceAll(body, " ", ""), key) {
			t.Errorf("response missing %s; body=%s", key, body)
		}
	}
}

func TestGetProject_URLEncodedIDDecodes(t *testing.T) {
	var seenIssueURI string
	ts := newGitLabStub(t, func(w http.ResponseWriter, r *http.Request) {
		// RequestURI is the raw, undecoded request target — Go decodes r.URL.Path,
		// so the %2F is only observable here.
		if strings.Contains(r.RequestURI, "/issues") {
			seenIssueURI = r.RequestURI
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `[]`)
	})
	defer ts.Close()

	cfg := &config.Config{}
	cfg.GitLab.URL = ts.URL
	cfg.GitLab.Token = "tok"
	h := &Handler{cfg: cfg, gitlabClient: newGitLabClient(), qdrant: &fakeQdrant{}}

	// Drive through the real chi router so {id} parsing matches production.
	r := chi.NewRouter()
	r.Get("/api/projects/{id}", h.GetProject)

	req := httptest.NewRequest(http.MethodGet, "/api/projects/services%2Fflexdeck", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	d := decodeDetail(t, rr.Body.Bytes())
	if d.Project != "services/flexdeck" {
		t.Errorf("decoded project = %q, want services/flexdeck", d.Project)
	}
	// The GitLab issues request must url-encode the project path back into one segment.
	if !strings.Contains(seenIssueURI, "services%2Fflexdeck") {
		t.Errorf("issue request-uri = %q, want services%%2Fflexdeck", seenIssueURI)
	}
}

func TestListProjects_Rollup(t *testing.T) {
	ts := newGitLabStub(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/projects"):
			// Project enumeration carries open_issues_count (no per-project fan-out).
			_, _ = fmt.Fprint(w, `[{"path_with_namespace":"services/flexdeck","open_issues_count":1}]`)
		default:
			_, _ = fmt.Fprint(w, `[]`)
		}
	})
	defer ts.Close()

	fq := &fakeQdrant{
		byCollection: map[string][]qdrant.Point{
			qdrantTasksCollection: {
				{Payload: map[string]any{"id": "t1", "project": "services/flexdeck", "status": "pending"}},
				{Payload: map[string]any{"id": "t2", "project": "services/flexdeck", "status": "completed"}},
			},
			qdrantRisksCollection: {
				{Payload: map[string]any{"id": "r1", "project": "services/flexdeck", "status": "open"}},
				{Payload: map[string]any{"id": "r2", "project": "services/flexdeck", "status": "closed"}},
			},
			qdrantPlansCollection: {
				{Payload: map[string]any{"id": "p1", "project": "services/flexdeck", "status": "planned"}},
				{Payload: map[string]any{"id": "p2", "project": "services/flexdeck", "status": "done"}},
			},
		},
	}

	cfg := &config.Config{}
	cfg.GitLab.URL = ts.URL
	cfg.GitLab.Token = "tok"
	h := &Handler{cfg: cfg, gitlabClient: newGitLabClient(), qdrant: fq}

	req := httptest.NewRequest(http.MethodGet, "/api/projects", nil)
	rr := httptest.NewRecorder()
	h.ListProjects(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}

	var resp struct {
		Projects []projectRollup `json:"projects"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode rollup: %v\nbody=%s", err, rr.Body.String())
	}
	if len(resp.Projects) != 1 {
		t.Fatalf("expected 1 project row, got %d", len(resp.Projects))
	}
	row := resp.Projects[0]
	if row.Project != "services/flexdeck" {
		t.Errorf("project = %q", row.Project)
	}
	if row.OpenTasks != 1 {
		t.Errorf("open_tasks = %d, want 1 (one completed excluded)", row.OpenTasks)
	}
	if row.OpenIssues != 1 {
		t.Errorf("open_issues = %d, want 1 (from open_issues_count)", row.OpenIssues)
	}
	if row.OpenRisks != 1 {
		t.Errorf("open_risks = %d, want 1 (closed excluded)", row.OpenRisks)
	}
	if row.OpenPlans != 1 {
		t.Errorf("open_plans = %d, want 1 (done excluded)", row.OpenPlans)
	}
}

func TestGetProject_QdrantUnreachableNeverErrors(t *testing.T) {
	ts := newGitLabStub(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `[]`)
	})
	defer ts.Close()

	// Real Qdrant client pointed at a dead address => Scroll errors,
	// handler must still 200 with partial=true.
	cfg := &config.Config{}
	cfg.GitLab.URL = ts.URL
	cfg.GitLab.Token = "tok"
	h := &Handler{
		cfg:          cfg,
		gitlabClient: newGitLabClient(),
		qdrant:       qdrant.New("http://127.0.0.1:0"),
	}

	rr := serveProject(h, "services/flexdeck")
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 with dead qdrant, got %d", rr.Code)
	}
	d := decodeDetail(t, rr.Body.Bytes())
	if !d.Partial {
		t.Errorf("expected partial=true when qdrant unreachable")
	}
	if d.Tasks == nil || d.Risks == nil {
		t.Errorf("failed sources must be empty slices, not nil")
	}
}

func TestGetProject_EmptyIDIsBadRequest(t *testing.T) {
	h := &Handler{cfg: &config.Config{}, gitlabClient: newGitLabClient(), qdrant: &fakeQdrant{}}
	r := chi.NewRouter()
	r.Get("/api/projects/{id}", h.GetProject)

	// A whitespace-only id decodes to empty -> 400.
	req := httptest.NewRequest(http.MethodGet, "/api/projects/%20", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty id, got %d", rr.Code)
	}
}

func TestListProjects_GitLabUnconfiguredEmpty(t *testing.T) {
	// No GitLab token => listProjectPaths returns empty, rollup is an empty list.
	h := &Handler{cfg: &config.Config{}, gitlabClient: newGitLabClient(), qdrant: &fakeQdrant{}}
	req := httptest.NewRequest(http.MethodGet, "/api/projects", nil)
	rr := httptest.NewRecorder()
	h.ListProjects(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	var resp struct {
		Projects []projectRollup `json:"projects"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Projects) != 0 {
		t.Errorf("expected empty rollup, got %d rows", len(resp.Projects))
	}
}

// serveProject invokes GetProject with a chi route context carrying the
// url-encoded id, mirroring how the router delivers the param.
// TestGetProject_ClientCancellationStillFetches reproduces the production bug
// where a browser aborting/superseding its poll cancelled the request context,
// every federated source failed with "context canceled", and the handler
// returned (and cached) an all-empty "partial" detail. The fix detaches the
// fetch from the request via context.WithoutCancel, so an already-cancelled
// request context must NOT empty the result.
func TestGetProject_ClientCancellationStillFetches(t *testing.T) {
	ts := newGitLabStub(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.Contains(r.URL.Path, "/issues"):
			_, _ = fmt.Fprint(w, `[{"iid":1,"title":"bug","state":"opened","labels":[],"web_url":"http://gl/issues/1"}]`)
		default:
			_, _ = fmt.Fprint(w, `[]`)
		}
	})
	defer ts.Close()

	fq := &fakeQdrant{byCollection: map[string][]qdrant.Point{
		qdrantTasksCollection: {
			{Payload: map[string]any{"id": "t1", "title": "task one", "status": "in_progress"}},
		},
	}}

	cfg := &config.Config{}
	cfg.GitLab.URL = ts.URL
	cfg.GitLab.Token = "tok"
	h := &Handler{cfg: cfg, gitlabClient: newGitLabClient(), qdrant: fq}

	// An already-cancelled request context: pre-fix this cancels the GitLab calls.
	parent, cancel := context.WithCancel(context.Background())
	cancel()

	encoded := url.PathEscape("services/flexdeck")
	req := httptest.NewRequest(http.MethodGet, "/api/projects/"+encoded, nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", encoded)
	req = req.WithContext(context.WithValue(parent, chi.RouteCtxKey, rctx))
	rr := httptest.NewRecorder()
	h.GetProject(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	d := decodeDetail(t, rr.Body.Bytes())
	if d.Partial {
		t.Errorf("partial=true: a cancelled request still emptied the detail (fetch not detached)")
	}
	if len(d.Issues) != 1 {
		t.Errorf("issues = %+v, want 1 (GitLab call must survive client cancellation)", d.Issues)
	}
	if len(d.Tasks) != 1 {
		t.Errorf("tasks = %+v, want 1", d.Tasks)
	}
}

func TestProjectDetail_FullyUnavailable(t *testing.T) {
	t.Parallel()

	// Every source failed: partial + no data anywhere -> must not be cached.
	allFailed := projectDetail{Partial: true}
	if !allFailed.fullyUnavailable() {
		t.Error("all-empty partial detail should be fullyUnavailable")
	}
	// Partial but some data came through -> cacheable (the banner explains the gap).
	withData := projectDetail{Partial: true, Issues: []projectIssue{{IID: 1}}}
	if withData.fullyUnavailable() {
		t.Error("partial detail with data should NOT be fullyUnavailable")
	}
	// Genuinely empty project, all sources OK (not partial) -> cacheable.
	emptyOK := projectDetail{Partial: false}
	if emptyOK.fullyUnavailable() {
		t.Error("non-partial empty detail should NOT be fullyUnavailable")
	}
}

func serveProject(h *Handler, project string) *httptest.ResponseRecorder {
	encoded := url.PathEscape(project)
	req := httptest.NewRequest(http.MethodGet, "/api/projects/"+encoded, nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", encoded)
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	rr := httptest.NewRecorder()
	h.GetProject(rr, req)
	return rr
}
