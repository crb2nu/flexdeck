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

const civitaiAPIBase = "https://civitai.com/api/v1"

// CivitAIClient interacts with the CivitAI API
type CivitAIClient struct {
	apiKey     string
	httpClient *http.Client
}

// CivitAIModelType represents CivitAI model types
type CivitAIModelType string

const (
	CivitTypeCheckpoint   CivitAIModelType = "Checkpoint"
	CivitTypeLORA         CivitAIModelType = "LORA"
	CivitTypeTextualInv   CivitAIModelType = "TextualInversion"
	CivitTypeHypernetwork CivitAIModelType = "Hypernetwork"
	CivitTypeAestheticGrad CivitAIModelType = "AestheticGradient"
	CivitTypeControlnet   CivitAIModelType = "Controlnet"
	CivitTypePoses        CivitAIModelType = "Poses"
)

// CivitAIModel represents a CivitAI model
type CivitAIModel struct {
	ID          int              `json:"id"`
	Name        string           `json:"name"`
	Description string           `json:"description"`
	Type        CivitAIModelType `json:"type"`
	NSFW        bool             `json:"nsfw"`
	Tags        []string         `json:"tags"`
	Creator     struct {
		Username string `json:"username"`
		Image    string `json:"image"`
	} `json:"creator"`
	Stats struct {
		DownloadCount int `json:"downloadCount"`
		FavoriteCount int `json:"favoriteCount"`
		CommentCount  int `json:"commentCount"`
		RatingCount   int `json:"ratingCount"`
		Rating        float64 `json:"rating"`
	} `json:"stats"`
	ModelVersions []CivitAIModelVersion `json:"modelVersions"`
}

// CivitAIModelVersion represents a version of a CivitAI model
type CivitAIModelVersion struct {
	ID             int     `json:"id"`
	ModelID        int     `json:"modelId"`
	Name           string  `json:"name"`
	Description    string  `json:"description"`
	CreatedAt      string  `json:"createdAt"`
	DownloadURL    string  `json:"downloadUrl"`
	BaseModel      string  `json:"baseModel"` // e.g., "SD 1.5", "SDXL 1.0"
	TrainedWords   []string `json:"trainedWords"`
	Files          []CivitAIFile `json:"files"`
}

// CivitAIFile represents a file in a CivitAI model version
type CivitAIFile struct {
	ID           int     `json:"id"`
	Name         string  `json:"name"`
	SizeKB       float64 `json:"sizeKB"`
	Type         string  `json:"type"` // "Model", "Training Data", etc.
	Format       string  `json:"format"` // "SafeTensor", "PickleTensor", etc.
	DownloadURL  string  `json:"downloadUrl"`
	Primary      bool    `json:"primary"`
}

// CivitAISearchResponse represents the API search response
type CivitAISearchResponse struct {
	Items    []CivitAIModel `json:"items"`
	Metadata struct {
		TotalItems   int    `json:"totalItems"`
		CurrentPage  int    `json:"currentPage"`
		PageSize     int    `json:"pageSize"`
		TotalPages   int    `json:"totalPages"`
		NextCursor   string `json:"nextCursor"`
	} `json:"metadata"`
}

// NewCivitAIClient creates a new CivitAI API client
func NewCivitAIClient(apiKey string) *CivitAIClient {
	return &CivitAIClient{
		apiKey: apiKey,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// Search searches for models on CivitAI
func (c *CivitAIClient) Search(ctx context.Context, query string, modelType CivitAIModelType, limit int) ([]CivitAIModel, error) {
	params := url.Values{}
	if query != "" {
		params.Set("query", query)
	}
	if modelType != "" {
		params.Set("types", string(modelType))
	}
	if limit > 0 {
		params.Set("limit", fmt.Sprintf("%d", limit))
	} else {
		params.Set("limit", "20")
	}
	params.Set("sort", "Highest Rated")
	params.Set("nsfw", "false")

	reqURL := fmt.Sprintf("%s/models?%s", civitaiAPIBase, params.Encode())

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	c.setAuthHeader(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API error %d: %s", resp.StatusCode, string(body))
	}

	var result CivitAISearchResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return result.Items, nil
}

// GetModel retrieves detailed information about a specific model
func (c *CivitAIClient) GetModel(ctx context.Context, modelID int) (*CivitAIModel, error) {
	reqURL := fmt.Sprintf("%s/models/%d", civitaiAPIBase, modelID)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	c.setAuthHeader(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("model not found: %d", modelID)
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API error %d: %s", resp.StatusCode, string(body))
	}

	var model CivitAIModel
	if err := json.NewDecoder(resp.Body).Decode(&model); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return &model, nil
}

// GetLatestVersion returns the latest version of a model
func (c *CivitAIClient) GetLatestVersion(model *CivitAIModel) *CivitAIModelVersion {
	if len(model.ModelVersions) == 0 {
		return nil
	}
	return &model.ModelVersions[0]
}

// GetPrimaryFile returns the primary file from a model version
func (c *CivitAIClient) GetPrimaryFile(version *CivitAIModelVersion) *CivitAIFile {
	for _, f := range version.Files {
		if f.Primary {
			return &f
		}
	}
	if len(version.Files) > 0 {
		return &version.Files[0]
	}
	return nil
}

// GetDownloadURL returns the download URL for a model (primary file of latest version)
func (c *CivitAIClient) GetDownloadURL(model *CivitAIModel) string {
	version := c.GetLatestVersion(model)
	if version == nil {
		return ""
	}
	file := c.GetPrimaryFile(version)
	if file == nil {
		return version.DownloadURL
	}
	return file.DownloadURL
}

// InferModelType converts CivitAI type to our ModelType
func (c *CivitAIClient) InferModelType(civitType CivitAIModelType) ModelType {
	switch civitType {
	case CivitTypeCheckpoint, CivitTypeLORA, CivitTypeTextualInv,
		CivitTypeHypernetwork, CivitTypeAestheticGrad, CivitTypeControlnet:
		return TypeDiffusion
	default:
		return TypeOther
	}
}

func (c *CivitAIClient) setAuthHeader(req *http.Request) {
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
}

// ToModel converts a CivitAI model to our Model type
func (c *CivitAIClient) ToModel(civit *CivitAIModel) *Model {
	var size int64
	var downloadURL string
	var fileName string
	version := c.GetLatestVersion(civit)
	if version != nil {
		file := c.GetPrimaryFile(version)
		if file != nil {
			size = int64(file.SizeKB * 1024)
			downloadURL = file.DownloadURL
			fileName = file.Name
		}
		if downloadURL == "" {
			downloadURL = version.DownloadURL
		}
	}

	var baseModel string
	if version != nil {
		baseModel = version.BaseModel
	}

	return &Model{
		ID:          fmt.Sprintf("civitai-%d", civit.ID),
		Name:        civit.Name,
		Source:      SourceCivitAI,
		SourceID:    fmt.Sprintf("%d", civit.ID),
		SourceURL:   fmt.Sprintf("https://civitai.com/models/%d", civit.ID),
		Type:        c.InferModelType(civit.Type),
		Description: truncateDescription(civit.Description, 500),
		Tags:        civit.Tags,
		Size:        size,
		Metadata: map[string]any{
			"creator":       civit.Creator.Username,
			"downloads":     civit.Stats.DownloadCount,
			"favorites":     civit.Stats.FavoriteCount,
			"rating":        civit.Stats.Rating,
			"civit_type":    civit.Type,
			"base_model":    baseModel,
			"nsfw":          civit.NSFW,
			"download_url":  downloadURL,
			"file_name":     fileName,
		},
	}
}

func truncateDescription(desc string, maxLen int) string {
	// Strip HTML tags (basic)
	desc = strings.ReplaceAll(desc, "<br>", "\n")
	desc = strings.ReplaceAll(desc, "<br/>", "\n")
	desc = strings.ReplaceAll(desc, "<p>", "")
	desc = strings.ReplaceAll(desc, "</p>", "\n")

	if len(desc) <= maxLen {
		return desc
	}
	return desc[:maxLen] + "..."
}
