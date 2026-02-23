package handlers

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type uiConfigResponse struct {
	Title  string         `json:"title"`
	Accent string         `json:"accent"`
	Links  []uiConfigLink `json:"links"`
}

type uiConfigLink struct {
	Label    string `json:"label"`
	Href     string `json:"href"`
	Disabled bool   `json:"disabled,omitempty"`
}

func defaultUIConfigResponse() uiConfigResponse {
	return uiConfigResponse{
		Title:  "FLEXDECK",
		Accent: "#00d9ff",
		Links:  []uiConfigLink{},
	}
}

func normalizeUIConfig(raw uiConfigResponse) (uiConfigResponse, error) {
	cfg := defaultUIConfigResponse()

	if strings.TrimSpace(raw.Title) != "" {
		cfg.Title = raw.Title
	}
	if strings.TrimSpace(raw.Accent) != "" {
		cfg.Accent = raw.Accent
	}

	if raw.Links != nil {
		normalized := make([]uiConfigLink, 0, len(raw.Links))
		for _, link := range raw.Links {
			label := strings.TrimSpace(link.Label)
			href := strings.TrimSpace(link.Href)
			if label == "" || href == "" {
				return uiConfigResponse{}, errors.New("link entries require non-empty label and href")
			}
			normalized = append(normalized, uiConfigLink{
				Label:    label,
				Href:     href,
				Disabled: link.Disabled,
			})
		}
		cfg.Links = normalized
	}

	return cfg, nil
}

func resolveUIConfigPath(basePath string) (string, error) {
	cleanPath := strings.TrimSpace(basePath)
	if cleanPath == "" {
		return "", os.ErrNotExist
	}

	info, err := os.Stat(cleanPath)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return cleanPath, nil
	}

	for _, name := range []string{"ui-config.json", "config.json"} {
		candidate := filepath.Join(cleanPath, name)
		fileInfo, statErr := os.Stat(candidate)
		if statErr == nil && !fileInfo.IsDir() {
			return candidate, nil
		}
	}

	return "", os.ErrNotExist
}

func loadUIConfig(path string) (uiConfigResponse, error) {
	file, err := os.Open(path)
	if err != nil {
		return uiConfigResponse{}, err
	}
	defer func() {
		if closeErr := file.Close(); closeErr != nil {
			slog.Warn("failed to close ui config file", "path", path, "error", closeErr)
		}
	}()

	body, err := io.ReadAll(file)
	if err != nil {
		return uiConfigResponse{}, err
	}

	var raw uiConfigResponse
	if err := json.Unmarshal(body, &raw); err != nil {
		return uiConfigResponse{}, err
	}

	return normalizeUIConfig(raw)
}

// UIConfig returns the configured UI config, falling back to defaults on missing or invalid files.
func (h *Handler) UIConfig(w http.ResponseWriter, r *http.Request) {
	config := defaultUIConfigResponse()
	configDir := ""
	if h != nil && h.cfg != nil {
		configDir = h.cfg.UIConfigDir
	}

	configPath, err := resolveUIConfigPath(configDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			slog.Warn("ui config file not found, using defaults", "dir", configDir)
		} else {
			slog.Warn("ui config path resolution failed, using defaults", "dir", configDir, "error", err)
		}
	} else {
		loadedConfig, loadErr := loadUIConfig(configPath)
		if loadErr != nil {
			slog.Warn("ui config is invalid, using defaults", "path", configPath, "error", loadErr)
		} else {
			config = loadedConfig
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(config)
}
