package config

import (
	"log/slog"
	"strings"
	"testing"
	"time"
)

func TestLoadUsesExpectedDefaults(t *testing.T) {
	t.Setenv("HOME", "/tmp/flexdeck-home")

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
	if !strings.Contains(strings.Join(cfg.AllowedOrigins, ","), "*") {
		t.Fatalf("expected default allowed origins to include *, got %v", cfg.AllowedOrigins)
	}
	if cfg.LoomHUD.URL != "http://localhost:3333" {
		t.Fatalf("expected default LOOM_HUD_URL, got %q", cfg.LoomHUD.URL)
	}
}

func TestLoadAppliesEnvironmentOverrides(t *testing.T) {
	t.Setenv("PORT", "9090")
	t.Setenv("LOG_LEVEL", "warn")
	t.Setenv("FLEXDECK_TOKEN_COOKIE_MAX_AGE_DAYS", "7")
	t.Setenv("FLEXDECK_TOKEN_COOKIE_SECURE", "yes")
	t.Setenv("ALLOWED_ORIGINS", "https://one.example,https://two.example")
	t.Setenv("LITELLM_SCRAPE_INTERVAL", "42")
	t.Setenv("REDIS_DB", "12")
	t.Setenv("LOOM_HUD_URL", "")

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
	if cfg.LiteLLM.ScrapeInterval != 42*time.Second {
		t.Fatalf("expected LITELLM_SCRAPE_INTERVAL=42s, got %s", cfg.LiteLLM.ScrapeInterval)
	}
	if cfg.Redis.DB != 12 {
		t.Fatalf("expected REDIS_DB=12, got %d", cfg.Redis.DB)
	}
	if cfg.LoomHUD.URL != "" {
		t.Fatalf("expected empty LOOM_HUD_URL to be preserved, got %q", cfg.LoomHUD.URL)
	}
	if len(cfg.AllowedOrigins) != 2 || cfg.AllowedOrigins[0] != "https://one.example" || cfg.AllowedOrigins[1] != "https://two.example" {
		t.Fatalf("unexpected ALLOWED_ORIGINS parse result: %v", cfg.AllowedOrigins)
	}
}

func TestValidateRequiresPort(t *testing.T) {
	cfg := &Config{}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected Validate() to return an error when port is empty")
	}
}
