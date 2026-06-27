package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/flexinfer/flexdeck/internal/models"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
)

func TestPublicCIStatusBuildsSanitizedLivePipeline(t *testing.T) {
	requests := make([]string, 0)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests = append(requests, r.URL.Path)
		if got := r.Header.Get("PRIVATE-TOKEN"); got != "test-token" {
			t.Fatalf("expected private token header, got %q", got)
		}
		w.Header().Set("Content-Type", "application/json")

		switch r.URL.Path {
		case "/api/v4/projects":
			if _, err := fmt.Fprint(w, `[{"id":11,"path_with_namespace":"services/flexdeck","default_branch":"main","visibility":"private"}]`); err != nil {
				t.Fatalf("write projects response: %v", err)
			}
		case "/api/v4/projects/11/pipelines":
			if _, err := fmt.Fprint(w, `[{"id":22,"status":"running","ref":"main","created_at":"2026-05-17T12:00:00Z"}]`); err != nil {
				t.Fatalf("write pipelines response: %v", err)
			}
		case "/api/v4/projects/11/pipelines/22/jobs":
			if _, err := fmt.Fprint(w, `[
				{"id":1,"name":"lint","stage":"verify","status":"success","duration":2.5},
				{"id":2,"name":"test","stage":"verify","status":"failed","duration":5.5},
				{"id":3,"name":"image","stage":"build","status":"running","duration":0}
			]`); err != nil {
				t.Fatalf("write jobs response: %v", err)
			}
		default:
			t.Fatalf("unexpected upstream path: %s", r.URL.Path)
		}
	}))
	defer upstream.Close()

	handler := &Handler{cfg: &config.Config{}}
	handler.cfg.GitLab.URL = upstream.URL
	handler.cfg.GitLab.Token = "test-token"

	req := httptest.NewRequest(http.MethodGet, "/api/public/ci", nil)
	rec := httptest.NewRecorder()
	handler.PublicCIStatus(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var got PublicCIResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Source != "live" || len(got.Pipelines) != 1 {
		t.Fatalf("expected one live pipeline, got %+v", got)
	}

	pipeline := got.Pipelines[0]
	if pipeline.Project != "flexdeck" || pipeline.ID != "22" || pipeline.Duration != 8 {
		t.Fatalf("unexpected pipeline summary: %+v", pipeline)
	}
	if len(pipeline.Stages) != 2 {
		t.Fatalf("expected two stages, got %+v", pipeline.Stages)
	}
	if pipeline.Stages[0].Name != "verify" || pipeline.Stages[0].Status != "failed" {
		t.Fatalf("expected failed verify stage, got %+v", pipeline.Stages[0])
	}
	if pipeline.Stages[1].Name != "build" || pipeline.Stages[1].Status != "running" {
		t.Fatalf("expected running build stage, got %+v", pipeline.Stages[1])
	}
	if strings.Join(requests, ",") != "/api/v4/projects,/api/v4/projects/11/pipelines,/api/v4/projects/11/pipelines/22/jobs" {
		t.Fatalf("unexpected upstream requests: %v", requests)
	}
}

func TestPublicCIStatusHandlesUpstreamContracts(t *testing.T) {
	tests := map[string]struct {
		token       string
		status      int
		body        string
		wantStatus  int
		wantMessage string
	}{
		"missing token": {
			token:       "",
			wantStatus:  http.StatusServiceUnavailable,
			wantMessage: "gitlab token not configured",
		},
		"project api error": {
			token:       "test-token",
			status:      http.StatusBadGateway,
			body:        `upstream down`,
			wantStatus:  http.StatusServiceUnavailable,
			wantMessage: "gitlab returned 502",
		},
		"malformed projects json": {
			token:       "test-token",
			status:      http.StatusOK,
			body:        `{broken`,
			wantStatus:  http.StatusServiceUnavailable,
			wantMessage: "failed to decode gitlab project list",
		},
	}

	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tt.status)
				if _, err := fmt.Fprint(w, tt.body); err != nil {
					t.Fatalf("write response: %v", err)
				}
			}))
			defer upstream.Close()

			handler := &Handler{cfg: &config.Config{}}
			handler.cfg.GitLab.URL = upstream.URL
			handler.cfg.GitLab.Token = tt.token

			req := httptest.NewRequest(http.MethodGet, "/api/public/ci", nil)
			rec := httptest.NewRecorder()
			handler.PublicCIStatus(rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("expected status %d, got %d: %s", tt.wantStatus, rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), tt.wantMessage) {
				t.Fatalf("expected response to contain %q, got %s", tt.wantMessage, rec.Body.String())
			}
		})
	}
}

func TestPublicDemoFallbackContracts(t *testing.T) {
	t.Run("topology returns unavailable when demo fallback disabled", func(t *testing.T) {
		t.Setenv("PUBLIC_API_ALLOW_DEMO", "false")
		handler := &Handler{cfg: &config.Config{}}
		req := httptest.NewRequest(http.MethodGet, "/api/public/topology", nil)
		rec := httptest.NewRecorder()
		handler.PublicTopology(rec, req)

		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("expected status 503, got %d: %s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "k8s client unavailable") {
			t.Fatalf("unexpected topology error body: %s", rec.Body.String())
		}
	})

	t.Run("topology uses demo fallback when enabled", func(t *testing.T) {
		t.Setenv("PUBLIC_API_ALLOW_DEMO", "true")
		handler := &Handler{cfg: &config.Config{}}
		req := httptest.NewRequest(http.MethodGet, "/api/public/topology", nil)
		rec := httptest.NewRecorder()
		handler.PublicTopology(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d: %s", rec.Code, rec.Body.String())
		}
		var got PublicTopologyResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode topology response: %v", err)
		}
		if got.Source != "demo" || len(got.Nodes) == 0 || len(got.Pods) == 0 || len(got.Services) == 0 {
			t.Fatalf("expected populated demo topology, got %+v", got)
		}
	})

	t.Run("ci uses demo fallback when token missing", func(t *testing.T) {
		t.Setenv("PUBLIC_API_ALLOW_DEMO", "1")
		handler := &Handler{cfg: &config.Config{}}
		req := httptest.NewRequest(http.MethodGet, "/api/public/ci", nil)
		rec := httptest.NewRecorder()
		handler.PublicCIStatus(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d: %s", rec.Code, rec.Body.String())
		}
		var got PublicCIResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode CI response: %v", err)
		}
		if got.Source != "demo" || len(got.Pipelines) != 2 {
			t.Fatalf("expected demo CI pipelines, got %+v", got)
		}
	})
}

func TestPublicModelsStatusUsesRegistryContracts(t *testing.T) {
	registryPath := filepath.Join(t.TempDir(), "models.json")
	registry, err := models.NewRegistry(config.ModelsConfig{RegistryPath: registryPath})
	if err != nil {
		t.Fatalf("NewRegistry returned error: %v", err)
	}

	items := []*models.Model{
		{
			ID:               "llama",
			Name:             "Llama 3 8B Instruct",
			Type:             models.TypeLLM,
			Tags:             []string{"chat"},
			DeploymentStatus: models.DeploymentDeployed,
			DeploymentName:   "vllm-llama",
			Metadata: map[string]any{
				"parameters": "8B",
				"backend":    "vllm",
				"gpu_group":  "7900",
				"aliases":    "chat, assistant",
			},
		},
		{
			ID:               "embed",
			Name:             "Nomic Embed",
			Type:             models.TypeEmbedding,
			DeploymentStatus: models.DeploymentPending,
			Metadata:         map[string]any{"aliases": []any{"embed", "", 42}},
		},
		{
			ID:               "sdxl",
			Name:             "SDXL Turbo",
			Type:             models.TypeDiffusion,
			DeploymentStatus: models.DeploymentFailed,
			Metadata:         map[string]any{"hardware": "NVIDIA GTX 980 Ti", "engine": "comfyui"},
		},
	}
	for _, item := range items {
		if err := registry.Register(item); err != nil {
			t.Fatalf("Register(%s) returned error: %v", item.ID, err)
		}
	}

	handler := &Handler{cfg: &config.Config{}, modelsRegistry: registry}
	req := httptest.NewRequest(http.MethodGet, "/api/public/models", nil)
	rec := httptest.NewRecorder()
	handler.PublicModelsStatus(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var got PublicModelsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Source != "live" || len(got.Models) != 3 {
		t.Fatalf("expected three live models, got %+v", got)
	}

	byID := map[string]PublicModelInfo{}
	for _, item := range got.Models {
		byID[item.ID] = item
	}
	llama := byID["llama"]
	if llama.Type != "llm" || llama.Status != "running" || llama.Parameters != "8B" || llama.Engine != "vLLM" {
		t.Fatalf("unexpected llama public contract: %+v", llama)
	}
	if llama.Hardware != "AMD 7900 XTX" || strings.Join(llama.Aliases, ",") != "chat,assistant" {
		t.Fatalf("unexpected llama metadata contract: %+v", llama)
	}
	if byID["embed"].Type != "embedding" || byID["embed"].Status != "pending" {
		t.Fatalf("unexpected embedding contract: %+v", byID["embed"])
	}
	if byID["sdxl"].Type != "image" || byID["sdxl"].Status != "failed" || byID["sdxl"].Engine != "ComfyUI" {
		t.Fatalf("unexpected image contract: %+v", byID["sdxl"])
	}
}

func TestPublicModelsAndMetricsFallbackContracts(t *testing.T) {
	t.Run("models unavailable", func(t *testing.T) {
		handler := &Handler{cfg: &config.Config{}}
		req := httptest.NewRequest(http.MethodGet, "/api/public/models", nil)
		rec := httptest.NewRecorder()
		handler.PublicModelsStatus(rec, req)

		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("expected status 503, got %d: %s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "models status unavailable") {
			t.Fatalf("unexpected error body: %s", rec.Body.String())
		}
	})

	t.Run("metrics counts deployed registry models", func(t *testing.T) {
		registry, err := models.NewRegistry(config.ModelsConfig{RegistryPath: filepath.Join(t.TempDir(), "models.json")})
		if err != nil {
			t.Fatalf("NewRegistry returned error: %v", err)
		}
		for _, item := range []*models.Model{
			{ID: "running", Name: "Running", DeploymentStatus: models.DeploymentDeployed},
			{ID: "stopped", Name: "Stopped", DeploymentStatus: models.DeploymentStopped},
		} {
			if err := registry.Register(item); err != nil {
				t.Fatalf("Register(%s) returned error: %v", item.ID, err)
			}
		}

		handler := &Handler{cfg: &config.Config{}, modelsRegistry: registry}
		req := httptest.NewRequest(http.MethodGet, "/api/public/metrics/summary", nil)
		rec := httptest.NewRecorder()
		handler.PublicMetricsSummary(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d: %s", rec.Code, rec.Body.String())
		}
		var got PublicMetricsSummary
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if got.AI.ModelsLoaded != 1 || got.Source != "mixed" {
			t.Fatalf("expected one deployed model in mixed summary, got %+v", got)
		}
	})
}

func TestPublicSanitizersAndModelInferenceHelpers(t *testing.T) {
	gpuCapacity := corev1.ResourceList{
		corev1.ResourceCPU:                 resource.MustParse("8"),
		corev1.ResourceMemory:              resource.MustParse("32Gi"),
		corev1.ResourceName("amd.com/gpu"): resource.MustParse("1"),
	}
	if got := sanitizeNodeName("prod-gpu-hostname", nil, gpuCapacity); !strings.HasPrefix(got, "gpu-worker-") {
		t.Fatalf("expected GPU node sanitizer, got %q", got)
	}
	if !hasGPU("plain-worker", map[string]string{"feature.node.kubernetes.io/pci-0300_10de.present": "true"}, nil) {
		t.Fatalf("expected NVIDIA feature label to count as GPU")
	}
	if got := sanitizePodName("llm-server-7d8f9cabc1-z9x8y"); got != "llm-server" {
		t.Fatalf("expected deployment hash stripped, got %q", got)
	}
	if got := sanitizePodName("qdrant-0"); got != "qdrant" {
		t.Fatalf("expected stateful ordinal stripped, got %q", got)
	}

	categoryCases := map[string]struct {
		namespace string
		name      string
		want      string
	}{
		"ai namespace":       {namespace: "ai", name: "server", want: "ai"},
		"monitoring name":    {namespace: "apps", name: "grafana", want: "monitoring"},
		"infrastructure ns":  {namespace: "longhorn-system", name: "manager", want: "infra"},
		"default app bucket": {namespace: "apps", name: "frontend", want: "app"},
	}
	for name, tc := range categoryCases {
		t.Run(name, func(t *testing.T) {
			if got := categorizePod(tc.namespace, tc.name); got != tc.want {
				t.Fatalf("categorizePod() = %q, want %q", got, tc.want)
			}
		})
	}

	model := &models.Model{
		ID:             "gguf-model",
		Name:           "Example 13b GGUF",
		DeploymentName: "llamacpp-example",
		Tags:           []string{"chat"},
		Metadata: map[string]any{
			"parameter_count": float64(13_000_000_000),
			"node":            "gpu-980-host",
			"aliases":         []string{" primary ", ""},
		},
	}
	if got := inferModelParameters(model); got != "13B" {
		t.Fatalf("expected 13B parameters, got %q", got)
	}
	if got := inferModelEngine(model); got != "llama.cpp" {
		t.Fatalf("expected llama.cpp engine, got %q", got)
	}
	if got := inferModelHardware(model); got != "NVIDIA GTX 980 Ti" {
		t.Fatalf("expected GTX 980 hardware, got %q", got)
	}
	if got := inferModelAliases(model); len(got) != 1 || got[0] != "primary" {
		t.Fatalf("expected trimmed aliases, got %+v", got)
	}
	if got := extractParamToken("model-137m"); got != "137M" {
		t.Fatalf("expected extracted param token, got %q", got)
	}
}

func TestModelHandlerParsingHelpers(t *testing.T) {
	paramCases := map[string]string{
		"qwen25-coder-32b":        "32B",
		"qwen2.5-7b-instruct":     "7B",
		"embedding-model-137m-v2": "137M",
		"mixed-7b-and-30b":        "30B",
		"no-parameter-token":      "",
	}
	for name, want := range paramCases {
		t.Run(name, func(t *testing.T) {
			if got := inferParamsFromName(name); got != want {
				t.Fatalf("inferParamsFromName() = %q, want %q", got, want)
			}
		})
	}

	if got := strToLower("FlexDeck-ABC"); got != "flexdeck-abc" {
		t.Fatalf("strToLower() = %q", got)
	}
	if got := toUpper("vllm-abc"); got != "VLLM-ABC" {
		t.Fatalf("toUpper() = %q", got)
	}
	if !containsIgnoreCase("FlexInfer Model Runtime", "model") {
		t.Fatalf("expected case-insensitive containment")
	}
	if containsIgnoreCase("FlexInfer", "dashboard") {
		t.Fatalf("did not expect absent substring to match")
	}

	req := httptest.NewRequest(http.MethodGet, "/api/models/crd/ns/name/swap-history?hours=999", nil)
	if got := parseHoursParam(req, 24, 168); got != 168 {
		t.Fatalf("expected parseHoursParam to clamp to 168, got %d", got)
	}
	req = httptest.NewRequest(http.MethodGet, "/api/models/crd/ns/name/swap-history?hours=0", nil)
	if got := parseHoursParam(req, 24, 168); got != 24 {
		t.Fatalf("expected parseHoursParam default, got %d", got)
	}
}

func TestParsePublicBenchmarks(t *testing.T) {
	now := "2026-06-27T00:00:00Z"

	t.Run("valid payload -> live", func(t *testing.T) {
		raw := `{"updatedAt":"2026-06-27T15:55:26Z","benchmarks":[` +
			`{"model":"gemma4-26b-a4b-gptq","backend":"vllm","gpuVendor":"AMD","gpuArch":"gfx1100","tokensPerSecond":67,"completionTokens":256,"durationSeconds":3.82,"samples":3,"timestamp":"2026-06-27T15:55:26Z"},` +
			`{"model":"qwen3-1.7b-tools","backend":"llamacpp","tokensPerSecond":19.8,"timestamp":"2026-06-27T15:55:26Z"}]}`
		resp, ok := parsePublicBenchmarks(raw, now)
		if !ok {
			t.Fatal("expected ok=true")
		}
		if resp.Source != "live" {
			t.Errorf("source = %q, want live", resp.Source)
		}
		if resp.UpdatedAt != "2026-06-27T15:55:26Z" {
			t.Errorf("updatedAt = %q", resp.UpdatedAt)
		}
		if len(resp.Benchmarks) != 2 || resp.Benchmarks[0].TokensPerSecond != 67 {
			t.Fatalf("benchmarks = %+v", resp.Benchmarks)
		}
		// Marshalled tokensPerSecond must be a JSON number for the site's zod schema.
		b, _ := json.Marshal(resp.Benchmarks[0])
		if !strings.Contains(string(b), `"tokensPerSecond":67`) {
			t.Errorf("tokensPerSecond should serialize as a number: %s", b)
		}
	})

	t.Run("missing updatedAt falls back to now", func(t *testing.T) {
		raw := `{"benchmarks":[{"model":"m","backend":"vllm","tokensPerSecond":1,"timestamp":"t"}]}`
		resp, ok := parsePublicBenchmarks(raw, now)
		if !ok || resp.UpdatedAt != now {
			t.Fatalf("ok=%v updatedAt=%q want now", ok, resp.UpdatedAt)
		}
	})

	t.Run("empty/invalid -> not ok (site keeps demo)", func(t *testing.T) {
		for _, raw := range []string{"", "not json", `{"benchmarks":[]}`, `{}`} {
			if _, ok := parsePublicBenchmarks(raw, now); ok {
				t.Errorf("raw %q: expected ok=false", raw)
			}
		}
	})
}
