package handlers

import (
	"bufio"
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"sort"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/flexinfer/flexdeck/internal/k8s"
)

// ModelCacheList returns all ModelCache CRDs in the namespace.
func (h *Handler) ModelCacheList(w http.ResponseWriter, r *http.Request) {
	kc := h.k8sForRequest(r)
	if kc == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "kubernetes client not configured",
		})
		return
	}

	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		namespace = h.cfg.Models.AINamespace
		if namespace == "" {
			namespace = "flexinfer-system"
		}
	}

	caches, err := kc.ListModelCaches(r.Context(), namespace)
	if err != nil {
		slog.Error("ModelCacheList: failed to list ModelCache CRDs", "error", err, "namespace", namespace)
		respondJSON(w, http.StatusInternalServerError, map[string]any{
			"error": fmt.Sprintf("failed to list ModelCache CRDs: %v", err),
		})
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"caches":    caches,
		"namespace": namespace,
		"count":     len(caches),
	})
}

// ModelCacheGet returns a single ModelCache CRD.
func (h *Handler) ModelCacheGet(w http.ResponseWriter, r *http.Request) {
	kc := h.k8sForRequest(r)
	if kc == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "kubernetes client not configured",
		})
		return
	}

	namespace := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")

	cache, err := kc.GetModelCache(r.Context(), namespace, name)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{
			"error": fmt.Sprintf("failed to get ModelCache %s/%s: %v", namespace, name, err),
		})
		return
	}

	respondJSON(w, http.StatusOK, cache)
}

// ModelCacheWatchSSE streams ModelCache CRD watch events via Server-Sent Events.
func (h *Handler) ModelCacheWatchSSE(w http.ResponseWriter, r *http.Request) {
	kc := h.k8sForRequest(r)
	if kc == nil {
		http.Error(w, "k8s client unavailable", http.StatusServiceUnavailable)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		namespace = h.cfg.Models.AINamespace
		if namespace == "" {
			namespace = "flexinfer-system"
		}
	}

	ctx := r.Context()
	events, err := kc.WatchModelCaches(ctx, namespace)
	if err != nil {
		slog.Error("ModelCacheWatchSSE: watch failed", "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher.Flush()

	for {
		select {
		case <-ctx.Done():
			return
		case event, ok := <-events:
			if !ok {
				return
			}
			sendSSE(w, flusher, "modelcache", event)
		}
	}
}

// ModelCachePodLogs streams logs from the active job pod for a ModelCache pipeline.
func (h *Handler) ModelCachePodLogs(w http.ResponseWriter, r *http.Request) {
	kc := h.k8sForRequest(r)
	if kc == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	namespace := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	// Find the active job pod by label selector
	podName, err := h.findModelCacheJobPod(r.Context(), kc, namespace, name)
	if err != nil {
		_, _ = fmt.Fprintf(w, "event: error\ndata: {\"error\":\"%s\"}\n\n", err.Error())
		flusher.Flush()
		return
	}

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	tailLines := int64(200)
	stream, err := kc.GetPodLogs(ctx, namespace, podName, k8s.PodLogOptions{
		Follow:    true,
		TailLines: &tailLines,
	})
	if err != nil {
		_, _ = fmt.Fprintf(w, "event: error\ndata: {\"error\":\"%s\"}\n\n", err.Error())
		flusher.Flush()
		return
	}
	defer func() { _ = stream.Close() }()

	_, _ = fmt.Fprintf(w, "event: ready\ndata: {\"ok\":true,\"pod\":\"%s\"}\n\n", podName)
	flusher.Flush()

	done := make(chan struct{})
	go func() {
		<-r.Context().Done()
		close(done)
		cancel()
	}()

	scanner := bufio.NewScanner(stream)
	for scanner.Scan() {
		select {
		case <-done:
			return
		default:
			line := scanner.Text()
			escapedLine := strings.ReplaceAll(line, "\n", "\\n")
			_, _ = fmt.Fprintf(w, "event: log\ndata: %s\n\n", escapedLine)
			flusher.Flush()
		}
	}
}

// findModelCacheJobPod finds the most recent job pod for a ModelCache pipeline.
func (h *Handler) findModelCacheJobPod(ctx context.Context, kc *k8s.Client, namespace, cacheName string) (string, error) {
	// List jobs with the ModelCache label
	labelSelector := fmt.Sprintf("flexinfer.ai/modelcache=%s", cacheName)
	jobs, err := kc.ListJobsByLabel(ctx, namespace, labelSelector)
	if err != nil {
		return "", fmt.Errorf("failed to list jobs: %w", err)
	}

	if len(jobs) == 0 {
		return "", fmt.Errorf("no jobs found for ModelCache %s/%s", namespace, cacheName)
	}

	// Sort by creation time descending, pick the most recent
	sort.Slice(jobs, func(i, j int) bool {
		return jobs[i].CreationTimestamp.After(jobs[j].CreationTimestamp.Time)
	})

	// Find pods belonging to the most recent job
	jobName := jobs[0].Name
	podSelector := fmt.Sprintf("job-name=%s", jobName)
	pods, err := kc.ListPodsByLabel(ctx, namespace, podSelector)
	if err != nil {
		return "", fmt.Errorf("failed to list pods for job %s: %w", jobName, err)
	}

	if len(pods) == 0 {
		return "", fmt.Errorf("no pods found for job %s", jobName)
	}

	return pods[0].Name, nil
}
