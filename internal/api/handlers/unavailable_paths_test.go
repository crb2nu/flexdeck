package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/flexinfer/flexdeck/internal/config"
)

func TestK8sHandlersReturnUnavailableWhenClientMissing(t *testing.T) {
	handler := &Handler{cfg: &config.Config{}}
	tests := map[string]http.HandlerFunc{
		"services":        handler.K8sServices,
		"nodes":           handler.K8sNodes,
		"deployments":     handler.K8sDeployments,
		"pods":            handler.K8sPods,
		"ingresses":       handler.K8sIngresses,
		"statefulSets":    handler.K8sStatefulSets,
		"daemonSets":      handler.K8sDaemonSets,
		"jobs":            handler.K8sJobs,
		"cronJobs":        handler.K8sCronJobs,
		"events":          handler.K8sEvents,
		"podLogs":         handler.K8sPodLogs,
		"podLogsSSE":      handler.K8sPodLogsSSE,
		"scale":           handler.K8sScale,
		"restart":         handler.K8sRestart,
		"nodeMetrics":     handler.K8sNodeMetrics,
		"podMetrics":      handler.K8sPodMetrics,
		"gpuByModel":      handler.K8sGPUByModel,
		"eventsSSE":       handler.K8sEventsSSE,
		"watchSSE":        handler.K8sWatchSSE,
		"pvcs":            handler.K8sPVCs,
		"pvs":             handler.K8sPVs,
		"storageClasses":  handler.K8sStorageClasses,
		"configMaps":      handler.K8sConfigMaps,
		"configMapDetail": handler.K8sConfigMapDetail,
		"secrets":         handler.K8sSecrets,
		"secretDetail":    handler.K8sSecretDetail,
	}

	for name, call := range tests {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/k8s/"+name, nil)
			rec := httptest.NewRecorder()
			call(rec, req)

			if rec.Code != http.StatusServiceUnavailable {
				t.Fatalf("expected status 503, got %d: %s", rec.Code, rec.Body.String())
			}
			body := strings.ToLower(rec.Body.String())
			if !strings.Contains(body, "k8s") && !strings.Contains(body, "prometheus") {
				t.Fatalf("expected dependency unavailable message, got %q", rec.Body.String())
			}
		})
	}
}

func TestCIHandlersReturnUnavailableWhenGitLabMissing(t *testing.T) {
	handler := &Handler{cfg: &config.Config{}, gitlabClient: newGitLabClient()}
	tests := map[string]struct {
		call       http.HandlerFunc
		wantStatus int
		wantText   string
	}{
		"repoConfig":      {call: handler.GetRepoConfig, wantStatus: http.StatusBadRequest, wantText: "invalid project id"},
		"jobTrace":        {call: handler.GetJobTrace, wantStatus: http.StatusUnauthorized, wantText: "GitLab token not configured"},
		"retryJob":        {call: handler.RetryJob, wantStatus: http.StatusUnauthorized, wantText: "GitLab token not configured"},
		"cancelJob":       {call: handler.CancelJob, wantStatus: http.StatusUnauthorized, wantText: "GitLab token not configured"},
		"playJob":         {call: handler.PlayJob, wantStatus: http.StatusUnauthorized, wantText: "GitLab token not configured"},
		"jobInfo":         {call: handler.GetJobInfo, wantStatus: http.StatusUnauthorized, wantText: "GitLab token not configured"},
		"ciSummary":       {call: handler.GetCISummary, wantStatus: http.StatusOK, wantText: "{}"},
		"allTrends":       {call: handler.GetAllPipelineTrends, wantStatus: http.StatusOK, wantText: "[]"},
		"pipelineTrends":  {call: handler.GetPipelineTrends, wantStatus: http.StatusOK, wantText: "{}"},
		"pipelineHistory": {call: handler.GetPipelineHistory, wantStatus: http.StatusOK, wantText: "[]"},
		"retryPipeline":   {call: handler.RetryPipeline, wantStatus: http.StatusUnauthorized, wantText: "GitLab token not configured"},
		"cancelPipeline":  {call: handler.CancelPipeline, wantStatus: http.StatusUnauthorized, wantText: "GitLab token not configured"},
		"triggerPipeline": {call: handler.TriggerPipeline, wantStatus: http.StatusUnauthorized, wantText: "GitLab token not configured"},
		"listPipelines":   {call: handler.ListProjectPipelines, wantStatus: http.StatusUnauthorized, wantText: "GitLab token not configured"},
	}

	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/ci/"+name, strings.NewReader(`{}`))
			rec := httptest.NewRecorder()
			tc.call(rec, req)

			if rec.Code != tc.wantStatus {
				t.Fatalf("expected status %d, got %d: %s", tc.wantStatus, rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), tc.wantText) {
				t.Fatalf("expected response containing %q, got %q", tc.wantText, rec.Body.String())
			}
		})
	}
}

func TestModelHandlersReturnUnavailableWhenDependenciesMissing(t *testing.T) {
	handler := &Handler{cfg: &config.Config{}}
	tests := map[string]http.HandlerFunc{
		"list":             handler.ModelsList,
		"get":              handler.ModelsGet,
		"register":         handler.ModelsRegister,
		"delete":           handler.ModelsDelete,
		"searchHF":         handler.ModelsSearchHuggingFace,
		"searchCivitAI":    handler.ModelsSearchCivitAI,
		"startDownload":    handler.ModelsStartDownload,
		"downloadProgress": handler.ModelsDownloadProgress,
		"cancelDownload":   handler.ModelsCancelDownload,
		"deploy":           handler.ModelsDeploy,
		"scale":            handler.ModelsScale,
	}

	for name, call := range tests {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/models/"+name, strings.NewReader(`{}`))
			rec := httptest.NewRecorder()
			call(rec, req)

			if rec.Code != http.StatusServiceUnavailable {
				t.Fatalf("expected status 503, got %d: %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestModelCRDHandlersReturnUnavailableWhenK8sMissing(t *testing.T) {
	handler := &Handler{cfg: &config.Config{}}
	tests := map[string]http.HandlerFunc{
		"list":        handler.ModelsCRD,
		"scale":       handler.ModelsCRDScale,
		"activate":    handler.ModelsCRDActivate,
		"restart":     handler.ModelsCRDRestart,
		"watch":       handler.ModelsCRDWatchSSE,
		"events":      handler.ModelsCRDEvents,
		"swapHistory": handler.ModelSwapHistory,
		"groupSwap":   handler.GroupSwapHistory,
	}

	for name, call := range tests {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/models/crd/"+name, nil)
			rec := httptest.NewRecorder()
			call(rec, req)

			if rec.Code != http.StatusServiceUnavailable {
				t.Fatalf("expected status 503, got %d: %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestGitOpsOnlyCRDPatchRejectsMutationsBeforeK8sLookup(t *testing.T) {
	handler := &Handler{cfg: &config.Config{}}
	req := httptest.NewRequest(http.MethodPatch, "/api/models/crd/ns/name/spec", strings.NewReader(`{"serverless":{}}`))
	rec := httptest.NewRecorder()
	handler.ModelsCRDPatchSpec(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "CRD mutations disabled") {
		t.Fatalf("expected gitops mutation guard message, got %s", rec.Body.String())
	}
}

func TestDashboardSummaryReturnsUnavailableWithoutMetricsStore(t *testing.T) {
	handler := &Handler{cfg: &config.Config{}}
	req := httptest.NewRequest(http.MethodGet, "/api/dashboard/summary", nil)
	rec := httptest.NewRecorder()
	handler.DashboardSummary(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status 503, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "metrics store unavailable") {
		t.Fatalf("unexpected dashboard error body: %s", rec.Body.String())
	}
}
