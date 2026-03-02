package models

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const hfAPIBase = "https://huggingface.co/api"

// HuggingFaceClient interacts with the HuggingFace API
type HuggingFaceClient struct {
	token      string
	httpClient *http.Client
}

// HFModelInfo represents a HuggingFace model
type HFModelInfo struct {
	ID           string   `json:"id"` // e.g., "meta-llama/Llama-3.1-8B"
	ModelID      string   `json:"modelId"`
	Author       string   `json:"author"`
	SHA          string   `json:"sha"`
	Private      bool     `json:"private"`
	Disabled     bool     `json:"disabled"`
	Gated        bool     `json:"gated"`
	Downloads    int64    `json:"downloads"`
	Likes        int64    `json:"likes"`
	Tags         []string `json:"tags"`
	PipelineTag  string   `json:"pipeline_tag"` // e.g., "text-generation"
	LibraryName  string   `json:"library_name"` // e.g., "transformers"
	CreatedAt    string   `json:"createdAt"`
	LastModified string   `json:"lastModified"`
}

// HFFileInfo represents a file in a HuggingFace repository
type HFFileInfo struct {
	Type string `json:"type"` // "file" or "directory"
	Path string `json:"path"`
	Size int64  `json:"size"`
	OID  string `json:"oid"` // Git object ID
	LFS  *struct {
		OID         string `json:"oid"`
		Size        int64  `json:"size"`
		PointerSize int64  `json:"pointerSize"`
	} `json:"lfs,omitempty"`
}

// HFSearchResult represents search results
type HFSearchResult struct {
	Models []HFModelInfo `json:"models"`
	Total  int           `json:"numTotalItems"`
}

// NewHuggingFaceClient creates a new HuggingFace API client
func NewHuggingFaceClient(token string) *HuggingFaceClient {
	return &HuggingFaceClient{
		token: token,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// Search searches for models on HuggingFace
func (c *HuggingFaceClient) Search(ctx context.Context, query string, filter string, limit int) ([]HFModelInfo, error) {
	params := url.Values{}
	params.Set("search", query)
	if filter != "" {
		params.Set("filter", filter)
	}
	if limit > 0 {
		params.Set("limit", fmt.Sprintf("%d", limit))
	} else {
		params.Set("limit", "20")
	}
	params.Set("sort", "downloads")
	params.Set("direction", "-1")

	reqURL := fmt.Sprintf("%s/models?%s", hfAPIBase, params.Encode())

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	c.setAuthHeader(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API error %d: %s", resp.StatusCode, string(body))
	}

	var models []HFModelInfo
	if err := json.NewDecoder(resp.Body).Decode(&models); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return models, nil
}

// GetModel retrieves detailed information about a specific model
func (c *HuggingFaceClient) GetModel(ctx context.Context, modelID string) (*HFModelInfo, error) {
	reqURL := fmt.Sprintf("%s/models/%s", hfAPIBase, modelID)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	c.setAuthHeader(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("model not found: %s", modelID)
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API error %d: %s", resp.StatusCode, string(body))
	}

	var model HFModelInfo
	if err := json.NewDecoder(resp.Body).Decode(&model); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return &model, nil
}

// ListFiles lists files in a HuggingFace repository
func (c *HuggingFaceClient) ListFiles(ctx context.Context, modelID string) ([]HFFileInfo, error) {
	reqURL := fmt.Sprintf("%s/models/%s/tree/main", hfAPIBase, modelID)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	c.setAuthHeader(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API error %d: %s", resp.StatusCode, string(body))
	}

	var files []HFFileInfo
	if err := json.NewDecoder(resp.Body).Decode(&files); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return files, nil
}

// GetTotalSize calculates the total size of all files in a model repository
func (c *HuggingFaceClient) GetTotalSize(ctx context.Context, modelID string) (int64, error) {
	files, err := c.ListFiles(ctx, modelID)
	if err != nil {
		return 0, err
	}

	var total int64
	for _, f := range files {
		if f.Type == "file" {
			if f.LFS != nil {
				total += f.LFS.Size
			} else {
				total += f.Size
			}
		}
	}

	return total, nil
}

// GetDownloadURL returns the download URL for a file
func (c *HuggingFaceClient) GetDownloadURL(modelID, filename string) string {
	return fmt.Sprintf("https://huggingface.co/%s/resolve/main/%s", modelID, filename)
}

// InferModelType guesses the model type from tags and pipeline
func (c *HuggingFaceClient) InferModelType(model *HFModelInfo) ModelType {
	// Check pipeline tag first
	switch model.PipelineTag {
	case "text-generation", "text2text-generation", "conversational":
		return TypeLLM
	case "text-to-image", "image-to-image":
		return TypeDiffusion
	case "feature-extraction", "sentence-similarity":
		return TypeEmbedding
	}

	// Check tags
	for _, tag := range model.Tags {
		tagLower := strings.ToLower(tag)
		if strings.Contains(tagLower, "llm") || strings.Contains(tagLower, "language-model") {
			return TypeLLM
		}
		if strings.Contains(tagLower, "diffusion") || strings.Contains(tagLower, "stable-diffusion") {
			return TypeDiffusion
		}
		if strings.Contains(tagLower, "embedding") {
			return TypeEmbedding
		}
	}

	// Check library name
	switch model.LibraryName {
	case "transformers", "llama.cpp", "vllm":
		return TypeLLM
	case "diffusers":
		return TypeDiffusion
	case "sentence-transformers":
		return TypeEmbedding
	}

	return TypeOther
}

func (c *HuggingFaceClient) setAuthHeader(req *http.Request) {
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
}

// ToModel converts a HuggingFace model to our Model type
func (c *HuggingFaceClient) ToModel(hf *HFModelInfo) *Model {
	return &Model{
		ID:          fmt.Sprintf("hf-%s", strings.ReplaceAll(hf.ID, "/", "-")),
		Name:        hf.ID,
		Source:      SourceHuggingFace,
		SourceID:    hf.ID,
		SourceURL:   fmt.Sprintf("https://huggingface.co/%s", hf.ID),
		Type:        c.InferModelType(hf),
		Description: "", // HF doesn't return description in list
		Tags:        hf.Tags,
		Metadata: map[string]any{
			"author":    hf.Author,
			"downloads": hf.Downloads,
			"likes":     hf.Likes,
			"pipeline":  hf.PipelineTag,
			"library":   hf.LibraryName,
			"gated":     hf.Gated,
			"private":   hf.Private,
		},
	}
}
