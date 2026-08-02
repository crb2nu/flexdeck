package config

import (
	"log/slog"
	"strings"
	"testing"
	"time"
)

func TestLoadUsesExpectedDefaults(t *testing.T) {
	t.Setenv("HOME", "/tmp/flexdeck-home")
	t.Setenv("PUBLIC_API_ONLY", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}

	if cfg.Port != "8080" {
		t.Fatalf("expected default port 8080, got %q", cfg.Port)
	}
	if cfg.LogLevel != slog.LevelInfo {
		t.Fatalf("expected default log level info, got %v", cfg.LogLevel)
	}
	if cfg.UIConfigDir != "/config" {
		t.Fatalf("expected default UI config dir /config, got %q", cfg.UIConfigDir)
	}
	if cfg.WorkspaceDir != "/tmp/flexdeck-home/workspace" {
		t.Fatalf("expected workspace dir derived from HOME, got %q", cfg.WorkspaceDir)
	}
	if cfg.TokenCookieTTL != 30*24*time.Hour {
		t.Fatalf("expected default token cookie ttl of 30 days, got %s", cfg.TokenCookieTTL)
	}
	if cfg.PublicAPIOnly {
		t.Fatal("expected public API only mode to be disabled by default")
	}
	if !strings.Contains(strings.Join(cfg.AllowedOrigins, ","), "*") {
		t.Fatalf("expected default allowed origins to include *, got %v", cfg.AllowedOrigins)
	}
	if cfg.LoomHUD.URL != "http://localhost:3333" {
		t.Fatalf("expected default LOOM_HUD_URL, got %q", cfg.LoomHUD.URL)
	}
	if cfg.LoomHUD.DirectURL != "" {
		t.Fatalf("expected default LOOM_HUD_DIRECT_URL to be empty, got %q", cfg.LoomHUD.DirectURL)
	}
}

func TestLoadAppliesEnvironmentOverrides(t *testing.T) {
	t.Setenv("PORT", "9090")
	t.Setenv("LOG_LEVEL", "warn")
	t.Setenv("FLEXDECK_TOKEN_COOKIE_MAX_AGE_DAYS", "7")
	t.Setenv("FLEXDECK_TOKEN_COOKIE_SECURE", "yes")
	t.Setenv("FLEXDECK_TRUSTED_CIDRS", "192.168.50.0/24")
	t.Setenv("FLEXDECK_TRUSTED_PROXY_CIDRS", "10.42.0.0/16")
	t.Setenv("ALLOWED_ORIGINS", "https://one.example,https://two.example")
	t.Setenv("LITELLM_SCRAPE_INTERVAL", "42")
	t.Setenv("REDIS_DB", "12")
	t.Setenv("LOOM_HUD_URL", "")
	t.Setenv("LOOM_HUD_DIRECT_URL", "https://hud.flexinfer.ai")
	t.Setenv("PUBLIC_API_ONLY", "true")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}

	if cfg.Port != "9090" {
		t.Fatalf("expected env override PORT=9090, got %q", cfg.Port)
	}
	if cfg.LogLevel != slog.LevelWarn {
		t.Fatalf("expected log level warn, got %v", cfg.LogLevel)
	}
	if cfg.TokenCookieTTL != 7*24*time.Hour {
		t.Fatalf("expected cookie ttl of 7 days, got %s", cfg.TokenCookieTTL)
	}
	if !cfg.CookieSecure {
		t.Fatal("expected cookie secure=true when FLEXDECK_TOKEN_COOKIE_SECURE=yes")
	}
	if cfg.TrustedCIDRs != "192.168.50.0/24" {
		t.Fatalf("expected trusted CIDR override, got %q", cfg.TrustedCIDRs)
	}
	if cfg.TrustedProxyCIDRs != "10.42.0.0/16" {
		t.Fatalf("expected trusted proxy CIDR override, got %q", cfg.TrustedProxyCIDRs)
	}
	if cfg.LiteLLM.ScrapeInterval != 42*time.Second {
		t.Fatalf("expected LITELLM_SCRAPE_INTERVAL=42s, got %s", cfg.LiteLLM.ScrapeInterval)
	}
	if cfg.Redis.DB != 12 {
		t.Fatalf("expected REDIS_DB=12, got %d", cfg.Redis.DB)
	}
	if cfg.LoomHUD.URL != "" {
		t.Fatalf("expected empty LOOM_HUD_URL to be preserved, got %q", cfg.LoomHUD.URL)
	}
	if cfg.LoomHUD.DirectURL != "https://hud.flexinfer.ai" {
		t.Fatalf("expected LOOM_HUD_DIRECT_URL override, got %q", cfg.LoomHUD.DirectURL)
	}
	if !cfg.PublicAPIOnly {
		t.Fatal("expected PUBLIC_API_ONLY=true to enable public API only mode")
	}
	if len(cfg.AllowedOrigins) != 2 || cfg.AllowedOrigins[0] != "https://one.example" || cfg.AllowedOrigins[1] != "https://two.example" {
		t.Fatalf("unexpected ALLOWED_ORIGINS parse result: %v", cfg.AllowedOrigins)
	}
}

func TestLoadTrimsSensitiveTokens(t *testing.T) {
	t.Setenv("GRAFANA_TOKEN", "  grafana-token \n")
	t.Setenv("GITLAB_TOKEN", "\tgitlab-token  ")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}

	if cfg.Grafana.Token != "grafana-token" {
		t.Fatalf("expected trimmed Grafana token, got %q", cfg.Grafana.Token)
	}
	if cfg.GitLab.Token != "gitlab-token" {
		t.Fatalf("expected trimmed GitLab token, got %q", cfg.GitLab.Token)
	}
}

func TestValidateRequiresPort(t *testing.T) {
	cfg := &Config{}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected Validate() to return an error when port is empty")
	}
}
