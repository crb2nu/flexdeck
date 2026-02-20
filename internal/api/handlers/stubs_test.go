package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/flexinfer/flexdeck/internal/config"
)

func TestUIConfigUsesDefaultsWhenConfigMissing(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	h := &Handler{
		cfg: &config.Config{
			UIConfigDir: dir,
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/ui/config", nil)
	rr := httptest.NewRecorder()
	h.UIConfig(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	var got uiConfigResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if got.Title != "FLEXDECK" {
		t.Fatalf("expected default title, got %q", got.Title)
	}
	if got.Accent != "#00d9ff" {
		t.Fatalf("expected default accent, got %q", got.Accent)
	}
	if len(got.Links) != 0 {
		t.Fatalf("expected no default links, got %d", len(got.Links))
	}
}

func TestUIConfigLoadsFromDiskWhenValid(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	payload := `{
		"title": "Ops Deck",
		"accent": "#33ffaa",
		"links": [
			{"label": "GitLab", "href": "https://gitlab.flexinfer.ai"},
			{"label": "Grafana", "href": "https://grafana.flexinfer.ai", "disabled": true}
		]
	}`

	if err := os.WriteFile(filepath.Join(dir, "ui-config.json"), []byte(payload), 0o644); err != nil {
		t.Fatalf("failed to write ui config: %v", err)
	}

	h := &Handler{
		cfg: &config.Config{
			UIConfigDir: dir,
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/ui/config", nil)
	rr := httptest.NewRecorder()
	h.UIConfig(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	var got uiConfigResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if got.Title != "Ops Deck" {
		t.Fatalf("expected configured title, got %q", got.Title)
	}
	if got.Accent != "#33ffaa" {
		t.Fatalf("expected configured accent, got %q", got.Accent)
	}
	if len(got.Links) != 2 {
		t.Fatalf("expected 2 links, got %d", len(got.Links))
	}
	if got.Links[1].Label != "Grafana" || !got.Links[1].Disabled {
		t.Fatalf("expected disabled Grafana link, got %+v", got.Links[1])
	}
}

func TestUIConfigFallsBackWhenConfigInvalid(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	payload := `{
		"title": "Broken Config",
		"links": [
			{"label": "", "href": "https://gitlab.flexinfer.ai"}
		]
	}`

	if err := os.WriteFile(filepath.Join(dir, "ui-config.json"), []byte(payload), 0o644); err != nil {
		t.Fatalf("failed to write ui config: %v", err)
	}

	h := &Handler{
		cfg: &config.Config{
			UIConfigDir: dir,
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/ui/config", nil)
	rr := httptest.NewRecorder()
	h.UIConfig(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	var got uiConfigResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if got.Title != "FLEXDECK" {
		t.Fatalf("expected default title when invalid config is provided, got %q", got.Title)
	}
	if got.Accent != "#00d9ff" {
		t.Fatalf("expected default accent when invalid config is provided, got %q", got.Accent)
	}
	if len(got.Links) != 0 {
		t.Fatalf("expected no links when invalid config is provided, got %d", len(got.Links))
	}
}
