package config

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Port        string
	LogLevel    slog.Level
	StaticDir   string
	UIConfigDir string

	// Auth
	Token           string
	TokenCookie     string
	TokenCookieTTL  time.Duration
	CookieSecure    bool
	AllowedOrigins  []string

	// K8s
	K8s K8sConfig

	// Prometheus
	Prom PrometheusConfig

	// Loki
	Loki LokiConfig

	// vLLM
	VLLM VLLMConfig

	// Cache
	Cache CacheConfig

	// LiteLLM
	LiteLLM LiteLLMConfig

	// Redis
	Redis RedisConfig
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
	ScrapeInterval time.Duration
}

type RedisConfig struct {
	Disabled bool
	URL      string
	Password string
	DB       int
}

func Load() (*Config, error) {
	cfg := &Config{
		Port:        getEnv("PORT", "8080"),
		LogLevel:    parseLogLevel(getEnv("LOG_LEVEL", "info")),
		StaticDir:   getEnv("STATIC_DIR", "./web/dist"),
		UIConfigDir: getEnv("UI_CONFIG_DIR", "/config"),

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

		Cache: CacheConfig{
			HFPath:      getEnv("HF_CACHE_PATH", ""),
			CivitAIPath: getEnv("CIVITAI_CACHE_PATH", ""),
		},

		LiteLLM: LiteLLMConfig{
			Disabled:       parseBool(getEnv("LITELLM_DISABLED", "false")),
			URL:            getEnv("LITELLM_URL", "http://litellm.ai.svc.cluster.local:8000"),
			ScrapeInterval: parseDurationSeconds(getEnv("LITELLM_SCRAPE_INTERVAL", "15")),
		},

		Redis: RedisConfig{
			Disabled: parseBool(getEnv("REDIS_DISABLED", "false")),
			URL:      getEnv("REDIS_URL", ""),
			Password: getEnv("REDIS_PASSWORD", ""),
			DB:       parseInt(getEnv("REDIS_DB", "0")),
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
