package handlers

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/flexinfer/flexdeck/internal/qdrant"
	"github.com/go-chi/chi/v5"
)

// The standalone Plans surface reads the same agent_plans_v1 / agent_plan_slices_v1
// Qdrant collections the per-project Projects drill-in uses (see projects.go).
// Phase is stored under the "status" payload key (indexed); phase_history and
// success are stored as JSON strings (phase_history_json / success_json).
const (
	loomPlansScrollLimit      = 500
	loomPlanSlicesScrollLimit = 4000
)

// loomPlanSummary is one row in GET /api/loom/plans — the cross-project Plans
// list. It is a superset of the per-project projectPlan lane.
type loomPlanSummary struct {
	ID                 string `json:"id"`
	Slug               string `json:"slug"`
	Title              string `json:"title"`
	Project            string `json:"project"`
	Namespace          string `json:"namespace"`
	Phase              string `json:"phase"`
	KillTestStatus     string `json:"kill_test_status"`
	RiskiestAssumption string `json:"riskiest_assumption"`
	MRRefs             int    `json:"mr_refs"`
	IssueIID           int    `json:"issue_iid"`
	IssueURL           string `json:"issue_url"`
	SliceTotal         int    `json:"slice_total"`
	SliceDone          int    `json:"slice_done"`
	UpdatedAt          string `json:"updated_at"`
}

type loomPlansList struct {
	Plans []loomPlanSummary `json:"plans"`
}

// loomPlanSliceDetail is one slice in the plan drill-in, ordered by Order.
type loomPlanSliceDetail struct {
	Order              int      `json:"order"`
	Name               string   `json:"name"`
	Goal               string   `json:"goal"`
	Phase              string   `json:"phase"`
	Files              []string `json:"files"`
	AcceptanceCriteria string   `json:"acceptance_criteria"`
	BranchName         string   `json:"branch_name"`
	MRRef              string   `json:"mr_ref"`
	DependsOn          []string `json:"depends_on"`
}

type loomPlanPhaseTransition struct {
	From  string `json:"from"`
	To    string `json:"to"`
	At    string `json:"at"`
	Actor string `json:"actor,omitempty"`
	Note  string `json:"note,omitempty"`
}

type loomPlanSuccess struct {
	Tests       []string `json:"tests,omitempty"`
	Metrics     []string `json:"metrics,omitempty"`
	ManualCheck string   `json:"manual_check,omitempty"`
}

// loomPlanDetail is GET /api/loom/plans/{id} — the full record for the drill-in.
type loomPlanDetail struct {
	loomPlanSummary
	KillTest       string                    `json:"kill_test"`
	Success        *loomPlanSuccess          `json:"success,omitempty"`
	Dependencies   []string                  `json:"dependencies"`
	MRRefList      []string                  `json:"mr_ref_list"`
	PipelineRefs   []string                  `json:"pipeline_refs"`
	DeployRefs     []string                  `json:"deploy_refs"`
	MillsBacklogID string                    `json:"mills_backlog_id"`
	MirrorPath     string                    `json:"mirror_path"`
	CreatedBy      string                    `json:"created_by"`
	CreatedAt      string                    `json:"created_at"`
	PhaseHistory   []loomPlanPhaseTransition `json:"phase_history"`
	Slices         []loomPlanSliceDetail     `json:"slices"`
}

// planScalars are the plan payload fields shared by the per-project lane
// (projects.go) and the standalone Plans surface, so both parse plans one way.
type planScalars struct {
	ID, Slug, Title, Project, Namespace, Phase string
	KillTestStatus, RiskiestAssumption         string
	MRCount, IssueIID                          int
	UpdatedAt                                  string
}

func planScalarsFromPayload(pl map[string]any) planScalars {
	return planScalars{
		ID:                 payloadString(pl, "id"),
		Slug:               payloadString(pl, "slug"),
		Title:              payloadString(pl, "title"),
		Project:            payloadString(pl, "project"),
		Namespace:          payloadString(pl, "namespace"),
		Phase:              payloadString(pl, "status"),
		KillTestStatus:     payloadString(pl, "kill_test_status"),
		RiskiestAssumption: payloadString(pl, "riskiest_assumption"),
		MRCount:            payloadSliceLen(pl, "mr_refs"),
		IssueIID:           payloadInt(pl, "gitlab_issue_iid"),
		UpdatedAt:          payloadString(pl, "updated_at"),
	}
}

type loomPlanFilter struct{ project, namespace, phase string }

func (f loomPlanFilter) cacheKey() string { return f.project + "|" + f.namespace + "|" + f.phase }

func (f loomPlanFilter) matches(s planScalars) bool {
	if f.namespace != "" && !strings.EqualFold(s.Namespace, f.namespace) {
		return false
	}
	if f.phase != "" && !strings.EqualFold(s.Phase, f.phase) {
		return false
	}
	return true
}

// LoomPlans lists plans across all projects for the standalone Plans surface.
// GET /api/loom/plans?project=&namespace=&phase=
func (h *Handler) LoomPlans(w http.ResponseWriter, r *http.Request) {
	// Detach from the client request so an aborted poll cannot cancel the scroll
	// mid-flight and pin an empty result (see ListProjects for the same fix).
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), projectFetchTimeout)
	defer cancel()

	q := r.URL.Query()
	filter := loomPlanFilter{
		project:   strings.TrimSpace(q.Get("project")),
		namespace: strings.TrimSpace(q.Get("namespace")),
		phase:     strings.TrimSpace(q.Get("phase")),
	}
	cacheKey := "loom:plans:" + filter.cacheKey()

	if h.cache != nil {
		cached, err := h.cache.GetOrFetchSmooth(ctx, cacheKey, 30*time.Second, func() (any, error) {
			return h.listLoomPlans(ctx, filter)
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(cached)
			return
		}
		slog.Warn("loom plans cache error", "error", err)
	}

	data, err := h.listLoomPlans(ctx, filter)
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	respondJSON(w, http.StatusOK, data)
}

func (h *Handler) listLoomPlans(ctx context.Context, filter loomPlanFilter) (loomPlansList, error) {
	out := loomPlansList{Plans: []loomPlanSummary{}}
	if h.qdrant == nil {
		return out, nil
	}

	var qfilter map[string]any
	if filter.project != "" {
		qfilter = qdrant.MatchProject(filter.project)
	}
	points, err := h.qdrant.Scroll(ctx, qdrantPlansCollection, qfilter, loomPlansScrollLimit)
	if err != nil {
		// Surface the error so the cache serves the last good (stale) value and
		// retries, instead of pinning an empty list for the TTL.
		return loomPlansList{}, err
	}

	rollup := h.planSliceRollup(ctx)

	plans := make([]loomPlanSummary, 0, len(points))
	for _, p := range points {
		sc := planScalarsFromPayload(p.Payload)
		if sc.ID == "" || !filter.matches(sc) {
			continue
		}
		roll := rollup[sc.ID]
		plans = append(plans, loomPlanSummary{
			ID:                 sc.ID,
			Slug:               sc.Slug,
			Title:              sc.Title,
			Project:            sc.Project,
			Namespace:          sc.Namespace,
			Phase:              sc.Phase,
			KillTestStatus:     sc.KillTestStatus,
			RiskiestAssumption: sc.RiskiestAssumption,
			MRRefs:             sc.MRCount,
			IssueIID:           sc.IssueIID,
			IssueURL:           h.planIssueURL(sc.Project, sc.IssueIID),
			SliceTotal:         roll.total,
			SliceDone:          roll.done,
			UpdatedAt:          sc.UpdatedAt,
		})
	}
	// Most-recently-updated first (RFC3339 sorts lexically); stable on ID.
	sort.SliceStable(plans, func(a, b int) bool {
		if plans[a].UpdatedAt != plans[b].UpdatedAt {
			return plans[a].UpdatedAt > plans[b].UpdatedAt
		}
		return plans[a].ID < plans[b].ID
	})
	out.Plans = plans
	return out, nil
}

type sliceRoll struct{ total, done int }

// planSliceRollup scrolls the whole slices collection once and tallies
// total/done per plan_id. Best-effort: a scroll error yields an empty rollup
// (slice bars render as 0) rather than failing the list.
func (h *Handler) planSliceRollup(ctx context.Context) map[string]sliceRoll {
	out := map[string]sliceRoll{}
	if h.qdrant == nil {
		return out
	}
	pts, err := h.qdrant.Scroll(ctx, qdrantPlanSlicesCollection, nil, loomPlanSlicesScrollLimit)
	if err != nil {
		slog.Debug("loom plans: slice rollup scroll failed", "error", err)
		return out
	}
	for _, p := range pts {
		planID := payloadString(p.Payload, "plan_id")
		if planID == "" {
			continue
		}
		r := out[planID]
		r.total++
		if isDoneSlicePhase(payloadString(p.Payload, "status")) {
			r.done++
		}
		out[planID] = r
	}
	return out
}

// LoomPlanDetail returns the full record for one plan. GET /api/loom/plans/{id}.
func (h *Handler) LoomPlanDetail(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	if id == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"error": "plan id required"})
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), projectFetchTimeout)
	defer cancel()

	detail, err := h.getLoomPlan(ctx, id)
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	if detail == nil {
		respondJSON(w, http.StatusNotFound, map[string]any{"error": "plan not found"})
		return
	}
	respondJSON(w, http.StatusOK, detail)
}

func (h *Handler) getLoomPlan(ctx context.Context, id string) (*loomPlanDetail, error) {
	if h.qdrant == nil {
		return nil, nil
	}
	points, err := h.qdrant.Scroll(ctx, qdrantPlansCollection, qdrant.MatchKeyword("id", id), 8)
	if err != nil {
		return nil, err
	}
	var pl map[string]any
	for _, p := range points {
		if payloadString(p.Payload, "id") == id {
			pl = p.Payload
			break
		}
	}
	if pl == nil {
		return nil, nil
	}
	sc := planScalarsFromPayload(pl)

	slices, total, done := h.loomPlanSlices(ctx, id)

	return &loomPlanDetail{
		loomPlanSummary: loomPlanSummary{
			ID:                 sc.ID,
			Slug:               sc.Slug,
			Title:              sc.Title,
			Project:            sc.Project,
			Namespace:          sc.Namespace,
			Phase:              sc.Phase,
			KillTestStatus:     sc.KillTestStatus,
			RiskiestAssumption: sc.RiskiestAssumption,
			MRRefs:             sc.MRCount,
			IssueIID:           sc.IssueIID,
			IssueURL:           h.planIssueURL(sc.Project, sc.IssueIID),
			SliceTotal:         total,
			SliceDone:          done,
			UpdatedAt:          sc.UpdatedAt,
		},
		KillTest:       payloadString(pl, "kill_test"),
		Success:        parsePlanSuccess(payloadString(pl, "success_json")),
		Dependencies:   payloadStrings(pl, "dependencies"),
		MRRefList:      payloadStrings(pl, "mr_refs"),
		PipelineRefs:   payloadStrings(pl, "pipeline_refs"),
		DeployRefs:     payloadStrings(pl, "deploy_refs"),
		MillsBacklogID: payloadString(pl, "mills_backlog_id"),
		MirrorPath:     payloadString(pl, "mirror_path"),
		CreatedBy:      payloadString(pl, "created_by"),
		CreatedAt:      payloadString(pl, "created_at"),
		PhaseHistory:   parsePhaseHistory(payloadString(pl, "phase_history_json")),
		Slices:         slices,
	}, nil
}

func (h *Handler) loomPlanSlices(ctx context.Context, planID string) ([]loomPlanSliceDetail, int, int) {
	out := []loomPlanSliceDetail{}
	if h.qdrant == nil {
		return out, 0, 0
	}
	pts, err := h.qdrant.Scroll(ctx, qdrantPlanSlicesCollection, qdrant.MatchKeyword("plan_id", planID), qdrantScrollLimit)
	if err != nil {
		slog.Debug("loom plan slices failed", "plan_id", planID, "error", err)
		return out, 0, 0
	}
	done := 0
	for _, p := range pts {
		if payloadString(p.Payload, "plan_id") != planID {
			continue
		}
		phase := payloadString(p.Payload, "status")
		if isDoneSlicePhase(phase) {
			done++
		}
		out = append(out, loomPlanSliceDetail{
			Order:              payloadInt(p.Payload, "order"),
			Name:               payloadString(p.Payload, "name"),
			Goal:               payloadString(p.Payload, "goal"),
			Phase:              phase,
			Files:              payloadStrings(p.Payload, "files"),
			AcceptanceCriteria: payloadString(p.Payload, "acceptance_criteria"),
			BranchName:         payloadString(p.Payload, "branch_name"),
			MRRef:              payloadString(p.Payload, "mr_ref"),
			DependsOn:          payloadStrings(p.Payload, "depends_on"),
		})
	}
	sort.SliceStable(out, func(a, b int) bool { return out[a].Order < out[b].Order })
	return out, len(out), done
}

// parsePhaseHistory decodes the phase_history_json payload field (a JSON array
// of transitions) into the API shape, formatting timestamps as RFC3339.
func parsePhaseHistory(raw string) []loomPlanPhaseTransition {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var hist []struct {
		From  string    `json:"from"`
		To    string    `json:"to"`
		At    time.Time `json:"at"`
		Actor string    `json:"actor"`
		Note  string    `json:"note"`
	}
	if err := json.Unmarshal([]byte(raw), &hist); err != nil {
		return nil
	}
	out := make([]loomPlanPhaseTransition, 0, len(hist))
	for _, t := range hist {
		at := ""
		if !t.At.IsZero() {
			at = t.At.UTC().Format(time.RFC3339)
		}
		out = append(out, loomPlanPhaseTransition{From: t.From, To: t.To, At: at, Actor: t.Actor, Note: t.Note})
	}
	return out
}

// parsePlanSuccess decodes the success_json payload field; returns nil when the
// stored value is empty/null or carries no criteria.
func parsePlanSuccess(raw string) *loomPlanSuccess {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var sc loomPlanSuccess
	if err := json.Unmarshal([]byte(raw), &sc); err != nil {
		return nil
	}
	if len(sc.Tests) == 0 && len(sc.Metrics) == 0 && strings.TrimSpace(sc.ManualCheck) == "" {
		return nil
	}
	return &sc
}

// payloadStrings reads a string-array payload field (e.g. mr_refs, files),
// tolerating nil and non-array values.
func payloadStrings(payload map[string]any, key string) []string {
	if payload == nil {
		return nil
	}
	arr, ok := payload[key].([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, v := range arr {
		if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
			out = append(out, s)
		}
	}
	return out
}
