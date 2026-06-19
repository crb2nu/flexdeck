package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"golang.org/x/sync/errgroup"

	"github.com/flexinfer/flexdeck/internal/qdrant"
)

// qdrantScroller is the minimal Qdrant surface the project federation needs.
// Implemented by *qdrant.Client and by test fakes.
type qdrantScroller interface {
	Scroll(ctx context.Context, collection string, filter map[string]any, limit int) ([]qdrant.Point, error)
}

const (
	// Collections federated for project tracking.
	qdrantTasksCollection   = "agent_tasks_v1"
	qdrantRisksCollection   = "pm_risks"
	qdrantContextCollection = "agent_context_v1"

	// projectsRollupMaxProjects caps how many GitLab projects the rollup walks,
	// keeping the fan-out bounded against a fragile GitLab API.
	projectsRollupMaxProjects = 60

	// qdrantScrollLimit caps points pulled per collection per project.
	qdrantScrollLimit = 200

	// qdrantRollupScrollLimit caps the single grouped scroll the rollup does per
	// collection (all tasks/risks across all projects, tallied by project).
	qdrantRollupScrollLimit = 2000
)

// projectTask is one agent-context task scoped to a project.
type projectTask struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Status    string `json:"status"`
	Priority  string `json:"priority"`
	SessionID string `json:"session_id"`
}

// projectIssue is one open GitLab issue.
type projectIssue struct {
	IID    int      `json:"iid"`
	Title  string   `json:"title"`
	State  string   `json:"state"`
	Labels []string `json:"labels"`
	WebURL string   `json:"web_url"`
}

// projectMilestone is one active GitLab milestone.
type projectMilestone struct {
	ID      int    `json:"id"`
	Title   string `json:"title"`
	State   string `json:"state"`
	DueDate string `json:"due_date"`
	WebURL  string `json:"web_url"`
}

// projectRisk is one risk from the pm_risks collection.
type projectRisk struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Likelihood string `json:"likelihood"`
	Impact     string `json:"impact"`
	Status     string `json:"status"`
}

// projectDecision is one decision (best-effort; see note in fetchDecisions).
type projectDecision struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	DecidedAt string `json:"decided_at"`
}

// projectDetail is the GET /api/projects/{id} response.
type projectDetail struct {
	Project    string             `json:"project"`
	Partial    bool               `json:"partial"`
	Tasks      []projectTask      `json:"tasks"`
	Issues     []projectIssue     `json:"issues"`
	Milestones []projectMilestone `json:"milestones"`
	Risks      []projectRisk      `json:"risks"`
	Decisions  []projectDecision  `json:"decisions"`
}

// projectRollup is one row of the GET /api/projects response.
type projectRollup struct {
	Project          string `json:"project"`
	OpenTasks        int    `json:"open_tasks"`
	OpenIssues       int    `json:"open_issues"`
	MilestonesAtRisk int    `json:"milestones_at_risk"`
	OpenRisks        int    `json:"open_risks"`
}

// ListProjects returns a tracking rollup across known GitLab projects.
// GET /api/projects
func (h *Handler) ListProjects(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if h.cache != nil {
		cached, err := h.cache.GetOrFetchSmooth(ctx, "projects:rollup", 30*time.Second, func() (any, error) {
			return h.fetchProjectsRollup(ctx)
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(cached)
			return
		}
		slog.Warn("projects rollup cache error", "error", err)
	}

	data, err := h.fetchProjectsRollup(ctx)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	respondJSON(w, http.StatusOK, data)
}

// GetProject returns the federated detail for a single project.
// GET /api/projects/{id} where id is the url-encoded path_with_namespace.
func (h *Handler) GetProject(w http.ResponseWriter, r *http.Request) {
	raw := chi.URLParam(r, "id")
	id, err := url.PathUnescape(raw)
	if err != nil {
		id = raw
	}
	id = strings.TrimSpace(id)
	if id == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"error": "project id required"})
		return
	}

	ctx := r.Context()
	cacheKey := "projects:detail:" + id
	if h.cache != nil {
		cached, cacheErr := h.cache.GetOrFetchSmooth(ctx, cacheKey, 30*time.Second, func() (any, error) {
			return h.fetchProjectDetail(ctx, id), nil
		})
		if cacheErr == nil {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(cached)
			return
		}
		slog.Warn("project detail cache error", "error", cacheErr, "project", id)
	}

	respondJSON(w, http.StatusOK, h.fetchProjectDetail(ctx, id))
}

// fetchProjectDetail federates all sources for a single project. Each source is
// fetched independently; a failed source contributes an empty slice and flips
// partial to true. The endpoint never errors out on a single dead source.
func (h *Handler) fetchProjectDetail(ctx context.Context, project string) projectDetail {
	detail := projectDetail{
		Project:    project,
		Tasks:      []projectTask{},
		Issues:     []projectIssue{},
		Milestones: []projectMilestone{},
		Risks:      []projectRisk{},
		Decisions:  []projectDecision{},
	}

	var (
		tasks      []projectTask
		issues     []projectIssue
		milestones []projectMilestone
		risks      []projectRisk
		decisions  []projectDecision

		tasksErr, issuesErr, milestonesErr, risksErr, decisionsErr error
	)

	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error { issues, issuesErr = h.fetchProjectIssues(gctx, project); return nil })
	g.Go(func() error { milestones, milestonesErr = h.fetchProjectMilestones(gctx, project); return nil })
	g.Go(func() error { tasks, tasksErr = h.fetchProjectTasks(gctx, project); return nil })
	g.Go(func() error { risks, risksErr = h.fetchProjectRisks(gctx, project); return nil })
	g.Go(func() error { decisions, decisionsErr = h.fetchProjectDecisions(gctx, project); return nil })
	_ = g.Wait()

	if issuesErr != nil {
		slog.Warn("projects: issues source failed", "project", project, "error", issuesErr)
		detail.Partial = true
	} else {
		detail.Issues = issues
	}

	if milestonesErr != nil {
		slog.Warn("projects: milestones source failed", "project", project, "error", milestonesErr)
		detail.Partial = true
	} else {
		detail.Milestones = milestones
	}

	if tasksErr != nil {
		slog.Warn("projects: tasks source failed", "project", project, "error", tasksErr)
		detail.Partial = true
	} else {
		detail.Tasks = tasks
	}

	if risksErr != nil {
		slog.Warn("projects: risks source failed", "project", project, "error", risksErr)
		detail.Partial = true
	} else {
		detail.Risks = risks
	}

	// Decisions come from the agent-context journal: agent_context_v1 entries of
	// type "decision" now carry a canonical `project` (= path_with_namespace),
	// stamped from the owning session (loom-core!734), so they filter the same
	// way tasks/risks do. Entries recorded before that change lack `project` and
	// simply don't match — decisions are forward-looking, so that is acceptable.
	if decisionsErr != nil {
		slog.Warn("projects: decisions source failed", "project", project, "error", decisionsErr)
		detail.Partial = true
	} else {
		detail.Decisions = decisions
	}

	return detail
}

// fetchProjectsRollup walks known GitLab projects and computes the per-project
// open-counts rollup. Per-project failures degrade that row's counts to zero
// rather than failing the whole rollup.
func (h *Handler) fetchProjectsRollup(ctx context.Context) (map[string]any, error) {
	projects, err := h.listProjectsWithCounts(ctx)
	if err != nil {
		return nil, err
	}

	// Two grouped Qdrant scrolls (all tasks, all risks), tallied by project — not
	// one fetch per project. Issue counts come free from the GitLab project list
	// (open_issues_count). Milestone "at risk" is intentionally NOT computed here
	// (it would cost one GitLab call per project); it is surfaced in the detail
	// view instead. A scroll error degrades to zero counts, never fails the rollup.
	openTasks := h.countOpenByProject(ctx, qdrantTasksCollection, isCompletedTaskStatus)
	openRisks := h.countOpenByProject(ctx, qdrantRisksCollection, isClosedRiskStatus)

	rows := make([]projectRollup, 0, len(projects))
	for _, p := range projects {
		rows = append(rows, projectRollup{
			Project:    p.Path,
			OpenTasks:  openTasks[p.Path],
			OpenIssues: p.OpenIssues,
			OpenRisks:  openRisks[p.Path],
		})
	}

	return map[string]any{"projects": rows}, nil
}

// projectMeta is the minimal per-project info the rollup needs from GitLab.
type projectMeta struct {
	Path       string
	OpenIssues int
}

// listProjectsWithCounts returns project paths plus open_issues_count from a
// single GitLab project-list call (no per-project fan-out).
func (h *Handler) listProjectsWithCounts(ctx context.Context) ([]projectMeta, error) {
	token := h.cfg.GitLab.Token
	if token == "" {
		slog.Warn("projects: GitLab token not configured")
		return []projectMeta{}, nil
	}

	apiURL := fmt.Sprintf("%s/api/v4/projects?membership=true&per_page=%d&order_by=last_activity_at&sort=desc",
		h.cfg.GitLab.URL, gitlabPerPageDefault)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create projects request: %w", err)
	}
	req.Header.Set("PRIVATE-TOKEN", token)

	resp, err := h.gitlabClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("list projects: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitLab API error: %s", resp.Status)
	}

	var raw []struct {
		PathWithNamespace string `json:"path_with_namespace"`
		OpenIssuesCount   int    `json:"open_issues_count"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("decode projects: %w", err)
	}

	out := make([]projectMeta, 0, len(raw))
	for _, p := range raw {
		if p.PathWithNamespace == "" {
			continue
		}
		out = append(out, projectMeta{Path: p.PathWithNamespace, OpenIssues: p.OpenIssuesCount})
		if len(out) >= projectsRollupMaxProjects {
			break
		}
	}
	return out, nil
}

// countOpenByProject scrolls a Qdrant collection once and tallies, per canonical
// `project`, the points whose status is NOT closed per isClosed. A scroll error
// degrades to an empty map so the rollup shows zero counts rather than failing.
func (h *Handler) countOpenByProject(ctx context.Context, collection string, isClosed func(string) bool) map[string]int {
	counts := map[string]int{}
	if h.qdrant == nil {
		return counts
	}
	points, err := h.qdrant.Scroll(ctx, collection, nil, qdrantRollupScrollLimit)
	if err != nil {
		slog.Warn("projects: rollup scroll failed", "collection", collection, "error", err)
		return counts
	}
	for _, p := range points {
		project := payloadString(p.Payload, "project")
		if project == "" {
			continue
		}
		if isClosed(payloadString(p.Payload, "status")) {
			continue
		}
		counts[project]++
	}
	return counts
}

// fetchProjectIssues fetches open GitLab issues for a project.
func (h *Handler) fetchProjectIssues(ctx context.Context, project string) ([]projectIssue, error) {
	token := h.cfg.GitLab.Token
	if token == "" {
		return []projectIssue{}, nil
	}

	apiURL := fmt.Sprintf("%s/api/v4/projects/%s/issues?state=opened&per_page=%d",
		h.cfg.GitLab.URL, gitlabProjectID(project), gitlabPerPageDefault)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create issues request: %w", err)
	}
	req.Header.Set("PRIVATE-TOKEN", token)

	resp, err := h.gitlabClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch issues: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitLab issues error: %s", resp.Status)
	}

	var raw []struct {
		IID    int      `json:"iid"`
		Title  string   `json:"title"`
		State  string   `json:"state"`
		Labels []string `json:"labels"`
		WebURL string   `json:"web_url"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("decode issues: %w", err)
	}

	issues := make([]projectIssue, 0, len(raw))
	for _, it := range raw {
		labels := it.Labels
		if labels == nil {
			labels = []string{}
		}
		issues = append(issues, projectIssue{
			IID:    it.IID,
			Title:  it.Title,
			State:  it.State,
			Labels: labels,
			WebURL: it.WebURL,
		})
	}
	return issues, nil
}

// fetchProjectMilestones fetches active GitLab milestones for a project.
func (h *Handler) fetchProjectMilestones(ctx context.Context, project string) ([]projectMilestone, error) {
	token := h.cfg.GitLab.Token
	if token == "" {
		return []projectMilestone{}, nil
	}

	apiURL := fmt.Sprintf("%s/api/v4/projects/%s/milestones?state=active&per_page=%d",
		h.cfg.GitLab.URL, gitlabProjectID(project), gitlabPerPageDefault)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create milestones request: %w", err)
	}
	req.Header.Set("PRIVATE-TOKEN", token)

	resp, err := h.gitlabClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch milestones: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitLab milestones error: %s", resp.Status)
	}

	var raw []struct {
		ID      int    `json:"id"`
		Title   string `json:"title"`
		State   string `json:"state"`
		DueDate string `json:"due_date"`
		WebURL  string `json:"web_url"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("decode milestones: %w", err)
	}

	milestones := make([]projectMilestone, 0, len(raw))
	for _, m := range raw {
		milestones = append(milestones, projectMilestone{
			ID:      m.ID,
			Title:   m.Title,
			State:   m.State,
			DueDate: m.DueDate,
			WebURL:  m.WebURL,
		})
	}
	return milestones, nil
}

// fetchProjectTasks scrolls agent_tasks_v1 for tasks scoped to the project.
func (h *Handler) fetchProjectTasks(ctx context.Context, project string) ([]projectTask, error) {
	if h.qdrant == nil {
		return []projectTask{}, nil
	}
	points, err := h.qdrant.Scroll(ctx, qdrantTasksCollection, qdrant.MatchProject(project), qdrantScrollLimit)
	if err != nil {
		return nil, err
	}

	tasks := make([]projectTask, 0, len(points))
	for _, p := range points {
		pl := p.Payload
		tasks = append(tasks, projectTask{
			ID:        payloadString(pl, "id"),
			Title:     payloadString(pl, "title"),
			Status:    payloadString(pl, "status"),
			Priority:  payloadString(pl, "priority"),
			SessionID: payloadString(pl, "session_id"),
		})
	}
	return tasks, nil
}

// fetchProjectRisks scrolls pm_risks for the project. A missing collection
// (created by a sibling slice) is treated as "no risks" by the caller's
// partial handling — here we surface the error and let fetchProjectDetail
// flag partial, but an empty result is the common steady state.
func (h *Handler) fetchProjectRisks(ctx context.Context, project string) ([]projectRisk, error) {
	if h.qdrant == nil {
		return []projectRisk{}, nil
	}
	points, err := h.qdrant.Scroll(ctx, qdrantRisksCollection, qdrant.MatchProject(project), qdrantScrollLimit)
	if err != nil {
		return nil, err
	}

	risks := make([]projectRisk, 0, len(points))
	for _, p := range points {
		pl := p.Payload
		risks = append(risks, projectRisk{
			ID:         payloadString(pl, "id"),
			Title:      payloadString(pl, "title"),
			Likelihood: payloadString(pl, "likelihood"),
			Impact:     payloadString(pl, "impact"),
			Status:     payloadString(pl, "status"),
		})
	}
	return risks, nil
}

// fetchProjectDecisions scrolls the agent-context journal (agent_context_v1)
// for entries of type "decision" scoped to the project. Entries carry a
// canonical `project` field stamped from the owning session (loom-core!734).
func (h *Handler) fetchProjectDecisions(ctx context.Context, project string) ([]projectDecision, error) {
	if h.qdrant == nil {
		return []projectDecision{}, nil
	}
	points, err := h.qdrant.Scroll(ctx, qdrantContextCollection, qdrant.MatchProjectAndEntryType(project, "decision"), qdrantScrollLimit)
	if err != nil {
		return nil, err
	}

	decisions := make([]projectDecision, 0, len(points))
	for _, p := range points {
		pl := p.Payload
		decisions = append(decisions, projectDecision{
			ID:        payloadString(pl, "id"),
			Title:     payloadString(pl, "title"),
			DecidedAt: payloadString(pl, "timestamp"),
		})
	}
	return decisions, nil
}

// --- rollup helpers ---

func isCompletedTaskStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "completed", "done", "closed", "cancelled", "canceled":
		return true
	default:
		return false
	}
}

func isClosedRiskStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "closed", "resolved", "mitigated", "accepted", "done":
		return true
	default:
		return false
	}
}

// gitlabProjectID url-encodes a path_with_namespace into the single-segment
// form GitLab's API expects (slashes become %2F). url.PathEscape alone leaves
// slashes intact, which GitLab would interpret as extra path segments.
func gitlabProjectID(project string) string {
	return strings.ReplaceAll(url.PathEscape(project), "/", "%2F")
}

// payloadString reads a string field from a Qdrant payload, tolerating nil
// and non-string values.
func payloadString(payload map[string]any, key string) string {
	if payload == nil {
		return ""
	}
	switch v := payload[key].(type) {
	case string:
		return v
	case fmt.Stringer:
		return v.String()
	default:
		return ""
	}
}
