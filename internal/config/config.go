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
	FlexInferProxyURL string

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
	Disabled bool
	URL      string // env: LOOM_HUD_URL, default: http://localhost:3333
}

type LangfuseConfig struct {
	Disabled  bool
	URL       string // Langfuse web API URL
	PublicKey string // Basic auth public key
	SecretKey string // Basic auth secret key
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

		FlexInferProxyURL: getEnv("FLEXINFER_PROXY_URL", ""),

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
			AINamespace:    getEnv("AI_NAMESPACE", "ai"),
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
			Disabled: parseBool(getEnv("LOOM_HUD_DISABLED", "false")),
			URL:      getEnv("LOOM_HUD_URL", "http://localhost:3333"),
		},

		Langfuse: LangfuseConfig{
			Disabled:  parseBool(getEnv("LANGFUSE_DISABLED", "false")),
			URL:       getEnv("LANGFUSE_URL", "http://langfuse-web.ai.svc.cluster.local:3000"),
			PublicKey: getEnv("LANGFUSE_PUBLIC_KEY", ""),
			SecretKey: getEnv("LANGFUSE_SECRET_KEY", ""),
		},

		AllowedOrigins: strings.Split(getEnv("ALLOWED_ORIGINS", "*"), ","),

		GitLab: GitLabConfig{
			URL:   getEnv("GITLAB_URL", "https://gitlab.com"),
			Token: getEnv("GITLAB_TOKEN", ""),
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
