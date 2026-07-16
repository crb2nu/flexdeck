package config

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port         string
	LogLevel     slog.Level
	StaticDir    string
	UIConfigDir  string
	WorkspaceDir string

	// Auth
	Token          string
	TokenCookie    string
	TokenCookieTTL time.Duration
	CookieSecure   bool
	TrustedCIDRs   string
	AllowedOrigins []string

	// K8s
	K8s K8sConfig

	// Prometheus
	Prom PrometheusConfig

	// Loki
	Loki LokiConfig

	// vLLM
	VLLM VLLMConfig

	// FlexInfer proxy (backend-agnostic inference endpoint)
	FlexInferProxy FlexInferProxyConfig

	// Cache
	Cache CacheConfig

	// LiteLLM
	LiteLLM LiteLLMConfig

	// Redis
	Redis RedisConfig

	// Models
	Models ModelsConfig

	// Agents
	Agents AgentsConfig

	// Loom HUD (agent presence from loom-core)
	LoomHUD LoomHUDConfig

	// Langfuse (LLM observability)
	Langfuse LangfuseConfig

	// GitLab
	GitLab GitLabConfig

	// Grafana
	Grafana GrafanaConfig

	// Alertmanager
	Alertmanager AlertmanagerConfig

	// RBAC
	RBAC RBACConfig

	// Audit
	Audit AuditConfig

	// Multi-Cluster
	MultiCluster MultiClusterConfig

	// Qdrant (vector store, read-only — project-tracking federation)
	Qdrant QdrantConfig

	// Mills (loom-mills-operator REST — autonomy control plane, read-mostly)
	Mills MillsConfig

	// Flightdeck (loom-flightdeck — agent flight recorder: stalls + context ledger)
	Flightdeck FlightdeckConfig
}

type K8sConfig struct {
	Disabled      bool
	ReadOnly      bool
	Host          string
	Namespace     string
	Token         string
	CAFile        string
	SkipTLSVerify bool
}

type GitLabConfig struct {
	URL   string
	Token string
}

type PrometheusConfig struct {
	Disabled bool
	URL      string
}

type LokiConfig struct {
	Disabled bool
	URL      string
}

type VLLMConfig struct {
	Disabled  bool
	URL       string
	Namespace string
}

type CacheConfig struct {
	HFPath      string
	CivitAIPath string
}

type LiteLLMConfig struct {
	Disabled       bool
	URL            string
	APIKey         string
	ScrapeInterval time.Duration
}

type RedisConfig struct {
	Disabled bool
	URL      string
	Password string
	DB       int
}

type ModelsConfig struct {
	Disabled       bool
	RegistryPath   string // Path to models registry JSON file
	HFToken        string // HuggingFace API token
	CivitAIKey     string // CivitAI API key
	DownloadPath   string // Path to store downloaded models
	GitOpsRepoPath string // Path to GitOps repository for manifests
	AINamespace    string // Kubernetes namespace for AI workloads
}

type AgentsConfig struct {
	Disabled     bool
	RegistryPath string // Path to agents registry JSON file

	// Dify integration (visual workflow builder)
	DifyURL    string // Dify API URL (e.g., http://dify-api.ai.svc.cluster.local:5001)
	DifyAPIKey string // Dify API key for authentication

	// LangGraph integration (stateful graph workflows)
	LangGraphURL string // LangGraph API URL (e.g., http://langgraph.ai.svc.cluster.local:8000)

	// AgentScope integration (multi-agent sandbox)
	AgentScopeURL    string // AgentScope sandbox base URL
	AgentScopeGUIURL string // AgentScope GUI sandbox URL
}

type LoomHUDConfig struct {
	Disabled  bool
	URL       string // env: LOOM_HUD_URL, default: http://localhost:3333
	DirectURL string // env: LOOM_HUD_DIRECT_URL, default: falls back to LOOM_HUD_URL when unset
	PushToken string // env: LOOM_HUD_PUSH_TOKEN — shared secret for push webhook auth
}

type GrafanaConfig struct {
	Disabled bool
	URL      string // env: GRAFANA_URL
	Token    string // env: GRAFANA_TOKEN (service account token with Viewer role)
}

type LangfuseConfig struct {
	Disabled  bool
	URL       string // Langfuse web API URL
	PublicKey string // Basic auth public key
	SecretKey string // Basic auth secret key
}

type FlexInferProxyConfig struct {
	Disabled       bool
	URL            string
	ManagementMode string // "gitops" (read-only) or "admin" (read-write CRD patches)
}

type AlertmanagerConfig struct {
	Disabled bool
	URL      string
}

type RBACConfig struct {
	Disabled   bool
	UsersPath  string // JSON file for user/role persistence (used when RedisURL is empty)
	AdminToken string // Bootstrap admin token (creates admin user on first run)
	RedisURL   string // When set, users persist to this dedicated Redis instead of UsersPath
}

type AuditConfig struct {
	Disabled bool
	TTLDays  int // How long to retain audit entries (default: 90)
}

type MultiClusterConfig struct {
	Disabled     bool
	RegistryPath string // JSON file for cluster registry persistence
}

type QdrantConfig struct {
	URL    string // env: QDRANT_URL, default: http://localhost:6333
	APIKey string // env: QDRANT_API_KEY (optional; sent as api-key header when set)
}

// MillsConfig points at the loom-mills-operator REST API (/api/mills/*). flexdeck
// federates mills DIRECTLY because the in-cluster HUD upstream (mobile-hud) does
// not expose /api/mills/* — only the workstation daemon does. Read endpoints are
// open; AdminToken is required only for mutating endpoints (slice 6).
type MillsConfig struct {
	Disabled   bool
	URL        string // env: MILLS_OPERATOR_URL
	AdminToken string // env: LOOM_MILLS_ADMIN_TOKEN — bearer for mutating /api/mills endpoints
	// MutationsEnabled dark-launches the slice-6 control layer (pause/resume/
	// escalate/kill-switch). Default false: even an RBAC admin cannot mutate
	// until this flag is flipped AND an AdminToken is configured. env:
	// LOOM_MILLS_MUTATIONS_ENABLED.
	MutationsEnabled bool
}

// FlightdeckConfig points at the loom-flightdeck JSON API (stalls + context
// ledger). Token is the IngestAuth bearer used by the board JSON endpoints.
type FlightdeckConfig struct {
	Disabled bool
	URL      string // env: FLIGHTDECK_URL
	Token    string // env: FLIGHTDECK_TOKEN — bearer for the flightdeck JSON API
}

func Load() (*Config, error) {
	cfg := &Config{
		Port:     getEnv("PORT", "8080"),
		LogLevel: parseLogLevel(getEnv("LOG_LEVEL", "info")),

		StaticDir:    getEnv("STATIC_DIR", "./web/dist"),
		UIConfigDir:  getEnv("UI_CONFIG_DIR", "/config"),
		WorkspaceDir: getEnv("WORKSPACE_DIR", os.Getenv("HOME")+"/workspace"),

		Token:          getEnv("FLEXDECK_TOKEN", ""),
		TokenCookie:    getEnv("FLEXDECK_TOKEN_COOKIE", "flexdeck_token"),
		TokenCookieTTL: parseDuration(getEnv("FLEXDECK_TOKEN_COOKIE_MAX_AGE_DAYS", "30")) * 24 * time.Hour,
		CookieSecure:   parseBool(getEnv("FLEXDECK_TOKEN_COOKIE_SECURE", "false")),
		TrustedCIDRs:   getEnv("FLEXDECK_TRUSTED_CIDRS", ""),

		K8s: K8sConfig{
			Disabled:      parseBool(getEnv("K8S_DISABLED", "false")),
			ReadOnly:      parseBool(getEnv("K8S_READONLY", "false")),
			Host:          getEnv("K8S_HOST", "https://kubernetes.default.svc"),
			Namespace:     getEnv("K8S_NAMESPACE", "default"),
			Token:         getEnv("K8S_BEARER_TOKEN", ""),
			CAFile:        getEnv("K8S_CA_FILE", ""),
			SkipTLSVerify: parseBool(getEnv("K8S_SKIP_TLS_VERIFY", "false")),
		},

		Prom: PrometheusConfig{
			Disabled: parseBool(getEnv("PROM_DISABLED", "false")),
			URL:      getEnv("PROM_URL", "http://kube-prometheus-stack-prometheus.monitoring.svc.cluster.local:9090"),
		},

		Loki: LokiConfig{
			Disabled: parseBool(getEnv("LOKI_DISABLED", "false")),
			URL:      getEnv("LOKI_URL", "http://loki.logging.svc.cluster.local:3100"),
		},

		VLLM: VLLMConfig{
			Disabled:  parseBool(getEnv("VLLM_DISABLED", "false")),
			URL:       getEnv("VLLM_URL", ""),
			Namespace: getEnv("VLLM_NAMESPACE", "ai"),
		},

		FlexInferProxy: FlexInferProxyConfig{
			Disabled:       parseBool(getEnv("FLEXINFER_PROXY_DISABLED", "false")),
			URL:            getEnv("FLEXINFER_PROXY_URL", ""),
			ManagementMode: getEnv("FLEXINFER_MANAGEMENT_MODE", "gitops"),
		},

		Cache: CacheConfig{
			HFPath:      getEnv("HF_CACHE_PATH", ""),
			CivitAIPath: getEnv("CIVITAI_CACHE_PATH", ""),
		},

		LiteLLM: LiteLLMConfig{
			Disabled:       parseBool(getEnv("LITELLM_DISABLED", "false")),
			URL:            getEnv("LITELLM_URL", "http://litellm.ai.svc.cluster.local:8000"),
			APIKey:         getEnv("LITELLM_API_KEY", ""),
			ScrapeInterval: parseDurationSeconds(getEnv("LITELLM_SCRAPE_INTERVAL", "15")),
		},

		Redis: RedisConfig{
			Disabled: parseBool(getEnv("REDIS_DISABLED", "false")),
			URL:      getEnv("REDIS_URL", ""),
			Password: getEnv("REDIS_PASSWORD", ""),
			DB:       parseInt(getEnv("REDIS_DB", "0")),
		},

		Models: ModelsConfig{
			Disabled:       parseBool(getEnv("MODELS_DISABLED", "false")),
			RegistryPath:   getEnv("MODELS_REGISTRY_PATH", "/data/models.json"),
			HFToken:        getEnv("HF_TOKEN", ""),
			CivitAIKey:     getEnv("CIVITAI_API_KEY", ""),
			DownloadPath:   getEnv("MODELS_DOWNLOAD_PATH", "/models"),
			GitOpsRepoPath: getEnv("GITOPS_REPO_PATH", ""),
			AINamespace:    getEnv("AI_NAMESPACE", "flexinfer-system"),
		},

		Agents: AgentsConfig{
			Disabled:         parseBool(getEnv("AGENTS_DISABLED", "false")),
			RegistryPath:     getEnv("AGENTS_REGISTRY_PATH", "/data/agents.json"),
			DifyURL:          getEnv("DIFY_URL", "http://dify-api.ai.svc.cluster.local:5001"),
			DifyAPIKey:       getEnv("DIFY_API_KEY", ""),
			LangGraphURL:     getEnv("LANGGRAPH_URL", "http://langgraph.ai.svc.cluster.local:8000"),
			AgentScopeURL:    getEnv("AGENTSCOPE_URL", "http://agentscope-sandbox-base.ai.svc.cluster.local:8000"),
			AgentScopeGUIURL: getEnv("AGENTSCOPE_GUI_URL", "http://agentscope-sandbox-gui.ai.svc.cluster.local:8000"),
		},

		LoomHUD: LoomHUDConfig{
			Disabled:  parseBool(getEnv("LOOM_HUD_DISABLED", "false")),
			URL:       getEnvAllowEmpty("LOOM_HUD_URL", "http://localhost:3333"),
			DirectURL: getEnvAllowEmpty("LOOM_HUD_DIRECT_URL", ""),
			PushToken: getEnv("LOOM_HUD_PUSH_TOKEN", ""),
		},

		// Defaults are the in-cluster service DNS confirmed by the slice-1
		// kill-test, so the Loom control plane works without a manifest change;
		// override via env. Mills port is 8090 (not 3333).
		Mills: MillsConfig{
			Disabled:         parseBool(getEnv("MILLS_DISABLED", "false")),
			URL:              getEnvAllowEmpty("MILLS_OPERATOR_URL", "http://loom-mills-operator.loom-mills.svc.cluster.local:8090"),
			AdminToken:       getEnv("LOOM_MILLS_ADMIN_TOKEN", ""),
			MutationsEnabled: parseBool(getEnv("LOOM_MILLS_MUTATIONS_ENABLED", "false")),
		},

		Flightdeck: FlightdeckConfig{
			Disabled: parseBool(getEnv("FLIGHTDECK_DISABLED", "false")),
			URL:      getEnvAllowEmpty("FLIGHTDECK_URL", "http://loom-flightdeck.loom-flightdeck.svc.cluster.local"),
			Token:    getEnv("FLIGHTDECK_TOKEN", ""),
		},

		Langfuse: LangfuseConfig{
			Disabled:  parseBool(getEnv("LANGFUSE_DISABLED", "false")),
			URL:       getEnv("LANGFUSE_URL", "http://langfuse-web.ai.svc.cluster.local:3000"),
			PublicKey: getEnv("LANGFUSE_PUBLIC_KEY", ""),
			SecretKey: getEnv("LANGFUSE_SECRET_KEY", ""),
		},

		Grafana: GrafanaConfig{
			Disabled: parseBool(getEnv("GRAFANA_DISABLED", "false")),
			URL:      getEnv("GRAFANA_URL", "http://kube-prometheus-stack-grafana.monitoring.svc.cluster.local:80"),
			Token:    strings.TrimSpace(getEnv("GRAFANA_TOKEN", "")),
		},

		Alertmanager: AlertmanagerConfig{
			Disabled: parseBool(getEnv("ALERTMANAGER_DISABLED", "false")),
			URL:      getEnv("ALERTMANAGER_URL", "http://kube-prometheus-stack-alertmanager.monitoring.svc.cluster.local:9093"),
		},

		RBAC: RBACConfig{
			Disabled:   parseBool(getEnv("RBAC_DISABLED", "true")),
			UsersPath:  getEnv("RBAC_USERS_PATH", "/data/rbac-users.json"),
			AdminToken: getEnv("RBAC_ADMIN_TOKEN", ""),
			RedisURL:   getEnv("RBAC_REDIS_URL", ""),
		},

		Audit: AuditConfig{
			Disabled: parseBool(getEnv("AUDIT_DISABLED", "true")),
			TTLDays:  parseInt(getEnv("AUDIT_TTL_DAYS", "90")),
		},

		MultiCluster: MultiClusterConfig{
			Disabled:     parseBool(getEnv("MULTICLUSTER_DISABLED", "true")),
			RegistryPath: getEnv("CLUSTERS_REGISTRY_PATH", "/data/clusters.json"),
		},

		Qdrant: QdrantConfig{
			URL:    getEnv("QDRANT_URL", "http://localhost:6333"),
			APIKey: strings.TrimSpace(getEnv("QDRANT_API_KEY", "")),
		},

		AllowedOrigins: strings.Split(getEnv("ALLOWED_ORIGINS", "*"), ","),

		GitLab: GitLabConfig{
			URL:   getEnv("GITLAB_URL", "https://gitlab.com"),
			Token: strings.TrimSpace(getEnv("GITLAB_TOKEN", "")),
		},
	}

	return cfg, nil
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// getEnvAllowEmpty returns defaultValue only when the key is unset.
// If the key exists and is an empty string, the empty value is preserved.
func getEnvAllowEmpty(key, defaultValue string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return defaultValue
}

func parseBool(s string) bool {
	return s == "true" || s == "1" || s == "yes"
}

func parseDuration(s string) time.Duration {
	days, err := strconv.Atoi(s)
	if err != nil {
		return 30
	}
	return time.Duration(days)
}

func parseDurationSeconds(s string) time.Duration {
	secs, err := strconv.Atoi(s)
	if err != nil {
		return 15 * time.Second
	}
	return time.Duration(secs) * time.Second
}

func parseInt(s string) int {
	i, err := strconv.Atoi(s)
	if err != nil {
		return 0
	}
	return i
}

func parseLogLevel(s string) slog.Level {
	switch s {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

func (c *Config) Validate() error {
	if c.Port == "" {
		return fmt.Errorf("PORT is required")
	}
	return nil
}
