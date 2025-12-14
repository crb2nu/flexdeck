package models

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// DownloadProgress represents download progress information
type DownloadProgress struct {
	ModelID     string  `json:"model_id"`
	FileName    string  `json:"file_name"`
	TotalBytes  int64   `json:"total_bytes"`
	Downloaded  int64   `json:"downloaded"`
	Percent     float64 `json:"percent"`
	BytesPerSec int64   `json:"bytes_per_sec"`
	Status      string  `json:"status"` // "downloading", "completed", "failed"
	Error       string  `json:"error,omitempty"`
}

// ProgressCallback is called with download progress updates
type ProgressCallback func(progress DownloadProgress)

// Downloader manages model downloads
type Downloader struct {
	basePath   string
	hfToken    string
	civitKey   string
	registry   *Registry
	httpClient *http.Client

	mu        sync.RWMutex
	downloads map[string]*downloadTask
}

type downloadTask struct {
	modelID   string
	cancel    context.CancelFunc
	progress  DownloadProgress
	callbacks []ProgressCallback
}

// NewDownloader creates a new download manager
func NewDownloader(basePath, hfToken, civitKey string, registry *Registry) *Downloader {
	return &Downloader{
		basePath:   basePath,
		hfToken:    hfToken,
		civitKey:   civitKey,
		registry:   registry,
		downloads:  make(map[string]*downloadTask),
		httpClient: &http.Client{
			Timeout: 0, // No timeout for large downloads
		},
	}
}

// StartDownload begins downloading a model
func (d *Downloader) StartDownload(ctx context.Context, model *Model, callback ProgressCallback) error {
	d.mu.Lock()
	if _, exists := d.downloads[model.ID]; exists {
		d.mu.Unlock()
		return fmt.Errorf("download already in progress for %s", model.ID)
	}

	downloadCtx, cancel := context.WithCancel(ctx)
	task := &downloadTask{
		modelID: model.ID,
		cancel:  cancel,
		progress: DownloadProgress{
			ModelID: model.ID,
			Status:  "downloading",
		},
	}
	if callback != nil {
		task.callbacks = append(task.callbacks, callback)
	}
	d.downloads[model.ID] = task
	d.mu.Unlock()

	// Update registry status
	d.registry.UpdateDownloadStatus(model.ID, StatusDownloading, 0, "")

	go d.runDownload(downloadCtx, model, task)

	return nil
}

// CancelDownload cancels an in-progress download
func (d *Downloader) CancelDownload(modelID string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	task, exists := d.downloads[modelID]
	if !exists {
		return fmt.Errorf("no download in progress for %s", modelID)
	}

	task.cancel()
	delete(d.downloads, modelID)

	d.registry.UpdateDownloadStatus(modelID, StatusFailed, 0, "download cancelled")

	return nil
}

// GetProgress returns the current progress of a download
func (d *Downloader) GetProgress(modelID string) (*DownloadProgress, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	task, exists := d.downloads[modelID]
	if !exists {
		return nil, false
	}

	progress := task.progress
	return &progress, true
}

// SubscribeProgress adds a callback for progress updates
func (d *Downloader) SubscribeProgress(modelID string, callback ProgressCallback) bool {
	d.mu.Lock()
	defer d.mu.Unlock()

	task, exists := d.downloads[modelID]
	if !exists {
		return false
	}

	task.callbacks = append(task.callbacks, callback)
	return true
}

func (d *Downloader) runDownload(ctx context.Context, model *Model, task *downloadTask) {
	defer func() {
		d.mu.Lock()
		delete(d.downloads, model.ID)
		d.mu.Unlock()
	}()

	var downloadURL string
	var fileName string

	switch model.Source {
	case SourceHuggingFace:
		downloadURL, fileName = d.getHFDownloadInfo(model)
		if downloadURL == "" {
			d.completeWithError(task, model.ID, "could not determine download URL for HuggingFace model")
			return
		}
	case SourceCivitAI:
		var err error
		downloadURL, fileName, err = d.getCivitDownloadInfo(model)
		if err != nil {
			d.completeWithError(task, model.ID, err.Error())
			return
		}
	default:
		d.completeWithError(task, model.ID, "unsupported model source")
		return
	}

	task.progress.FileName = fileName

	// Create destination directory
	destDir := filepath.Join(d.basePath, model.ID)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		d.completeWithError(task, model.ID, fmt.Sprintf("create directory: %v", err))
		return
	}

	destPath := filepath.Join(destDir, fileName)

	// Perform download
	err := d.downloadFile(ctx, downloadURL, destPath, model.Source, task)
	if err != nil {
		if ctx.Err() != nil {
			d.completeWithError(task, model.ID, "download cancelled")
		} else {
			d.completeWithError(task, model.ID, err.Error())
		}
		return
	}

	// Update model with local path
	model.LocalPath = destDir
	model.DownloadStatus = StatusCompleted
	model.DownloadProgress = 100
	now := time.Now()
	model.DownloadedAt = &now

	if err := d.registry.Update(model); err != nil {
		slog.Warn("failed to update model registry", "error", err)
	}

	// Notify completion
	task.progress.Status = "completed"
	task.progress.Percent = 100
	d.notifyProgress(task)
}

func (d *Downloader) downloadFile(ctx context.Context, url, destPath string, source ModelSource, task *downloadTask) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	// Add auth headers (HuggingFace only - CivitAI uses query param auth)
	if source == SourceHuggingFace && d.hfToken != "" {
		req.Header.Set("Authorization", "Bearer "+d.hfToken)
	}

	resp, err := d.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		// Read error body for more details
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		if len(body) > 0 {
			return fmt.Errorf("download failed (HTTP %d): %s", resp.StatusCode, string(body))
		}
		switch resp.StatusCode {
		case http.StatusUnauthorized:
			return fmt.Errorf("download failed (HTTP 401): unauthorized - check API key")
		case http.StatusForbidden:
			return fmt.Errorf("download failed (HTTP 403): access denied")
		case http.StatusNotFound:
			return fmt.Errorf("download failed (HTTP 404): file not found")
		default:
			return fmt.Errorf("download failed (HTTP %d)", resp.StatusCode)
		}
	}

	totalSize := resp.ContentLength
	task.progress.TotalBytes = totalSize

	// Create temp file
	tempPath := destPath + ".tmp"
	out, err := os.Create(tempPath)
	if err != nil {
		return fmt.Errorf("create file: %w", err)
	}
	defer out.Close()

	// Track progress
	startTime := time.Now()
	var downloaded int64
	buf := make([]byte, 32*1024) // 32KB buffer
	lastUpdate := time.Now()

	for {
		select {
		case <-ctx.Done():
			os.Remove(tempPath)
			return ctx.Err()
		default:
		}

		n, err := resp.Body.Read(buf)
		if n > 0 {
			if _, writeErr := out.Write(buf[:n]); writeErr != nil {
				os.Remove(tempPath)
				return fmt.Errorf("write file: %w", writeErr)
			}
			downloaded += int64(n)

			// Update progress every 500ms
			if time.Since(lastUpdate) > 500*time.Millisecond {
				elapsed := time.Since(startTime).Seconds()
				var percent float64
				if totalSize > 0 {
					percent = float64(downloaded) / float64(totalSize) * 100
				}
				var bytesPerSec int64
				if elapsed > 0 {
					bytesPerSec = int64(float64(downloaded) / elapsed)
				}

				task.progress.Downloaded = downloaded
				task.progress.Percent = percent
				task.progress.BytesPerSec = bytesPerSec

				d.notifyProgress(task)
				d.registry.UpdateDownloadStatus(task.modelID, StatusDownloading, percent, "")

				lastUpdate = time.Now()
			}
		}

		if err == io.EOF {
			break
		}
		if err != nil {
			os.Remove(tempPath)
			return fmt.Errorf("read response: %w", err)
		}
	}

	// Rename temp file to final destination
	if err := os.Rename(tempPath, destPath); err != nil {
		return fmt.Errorf("rename file: %w", err)
	}

	return nil
}

func (d *Downloader) getHFDownloadInfo(model *Model) (string, string) {
	// For HuggingFace, we typically want the safetensors or bin file
	// This is a simplified version - in production you'd list files and pick the right one
	hfClient := NewHuggingFaceClient(d.hfToken)

	files, err := hfClient.ListFiles(context.Background(), model.SourceID)
	if err != nil {
		slog.Warn("failed to list HF files", "model", model.SourceID, "error", err)
		return "", ""
	}

	// Find the best file to download (prefer safetensors)
	var bestFile *HFFileInfo
	for i, f := range files {
		if f.Type != "file" {
			continue
		}
		ext := filepath.Ext(f.Path)
		if ext == ".safetensors" || ext == ".bin" || ext == ".gguf" {
			if bestFile == nil ||
				(filepath.Ext(bestFile.Path) != ".safetensors" && ext == ".safetensors") ||
				(filepath.Ext(bestFile.Path) == ext && f.Size > bestFile.Size) {
				bestFile = &files[i]
			}
		}
	}

	if bestFile == nil {
		return "", ""
	}

	url := hfClient.GetDownloadURL(model.SourceID, bestFile.Path)
	return url, filepath.Base(bestFile.Path)
}

func (d *Downloader) getCivitDownloadInfo(model *Model) (string, string, error) {
	// Validate API key is configured
	if d.civitKey == "" {
		return "", "", fmt.Errorf("CIVITAI_API_KEY not configured - required for CivitAI downloads")
	}

	var downloadURL string
	var fileName string

	// Get filename from metadata or generate one
	if fn, ok := model.Metadata["file_name"].(string); ok && fn != "" {
		fileName = fn
	} else {
		fileName = model.Name + ".safetensors"
	}

	// For CivitAI, the download URL should be stored in metadata
	if u, ok := model.Metadata["download_url"].(string); ok && u != "" {
		downloadURL = u
	} else {
		// Fetch fresh info
		civitClient := NewCivitAIClient(d.civitKey)
		var modelID int
		fmt.Sscanf(model.SourceID, "%d", &modelID)

		civitModel, err := civitClient.GetModel(context.Background(), modelID)
		if err != nil {
			return "", "", fmt.Errorf("failed to fetch model info from CivitAI: %w", err)
		}

		downloadURL = civitClient.GetDownloadURL(civitModel)
	}

	if downloadURL == "" {
		return "", "", fmt.Errorf("no download URL available for model")
	}

	// CivitAI requires token as query parameter (CDN doesn't accept Authorization header)
	if strings.Contains(downloadURL, "?") {
		downloadURL = downloadURL + "&token=" + url.QueryEscape(d.civitKey)
	} else {
		downloadURL = downloadURL + "?token=" + url.QueryEscape(d.civitKey)
	}

	return downloadURL, fileName, nil
}

func (d *Downloader) completeWithError(task *downloadTask, modelID, errMsg string) {
	task.progress.Status = "failed"
	task.progress.Error = errMsg
	d.notifyProgress(task)
	d.registry.UpdateDownloadStatus(modelID, StatusFailed, 0, errMsg)
}

func (d *Downloader) notifyProgress(task *downloadTask) {
	d.mu.RLock()
	callbacks := make([]ProgressCallback, len(task.callbacks))
	copy(callbacks, task.callbacks)
	d.mu.RUnlock()

	for _, cb := range callbacks {
		cb(task.progress)
	}
}
