package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/flexinfer/flexdeck/internal/k8s"
)

func (h *Handler) K8sServices(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := r.URL.Query().Get("ns")
	services, err := h.k8s.GetServices(r.Context(), ns)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(services)
}

func (h *Handler) K8sNodes(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	nodes, err := h.k8s.GetNodes(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(nodes)
}

func (h *Handler) K8sDeployments(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := r.URL.Query().Get("ns")
	deployments, err := h.k8s.GetDeployments(r.Context(), ns)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(deployments)
}

func (h *Handler) K8sPods(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := r.URL.Query().Get("ns")
	pods, err := h.k8s.GetPods(r.Context(), ns)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(pods)
}

func (h *Handler) K8sIngresses(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := r.URL.Query().Get("ns")
	ingresses, err := h.k8s.GetIngresses(r.Context(), ns)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ingresses)
}

func (h *Handler) K8sScale(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")
	replicasStr := r.URL.Query().Get("replicas")

	replicas, err := strconv.ParseInt(replicasStr, 10, 32)
	if err != nil {
		http.Error(w, "invalid replicas parameter", http.StatusBadRequest)
		return
	}

	if err := h.k8s.ScaleDeployment(r.Context(), ns, name, int32(replicas)); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"ok":       true,
		"name":     name,
		"replicas": replicas,
	})
}

func (h *Handler) K8sRestart(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")

	if err := h.k8s.RestartDeployment(r.Context(), ns, name); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"ok":   true,
		"name": name,
	})
}

// K8sWatchSSE implements Server-Sent Events for real-time K8s resource streaming.
// It watches nodes, pods, and services and streams changes to the client.
func (h *Handler) K8sWatchSSE(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	// Get optional namespace filter
	ns := r.URL.Query().Get("ns")

	// Create cancellable context
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	// Start watchers
	nodeEvents, err := h.k8s.WatchNodes(ctx)
	if err != nil {
		log.Printf("Failed to watch nodes: %v", err)
		fmt.Fprintf(w, "event: error\ndata: {\"error\":\"Failed to watch nodes\"}\n\n")
		flusher.Flush()
		return
	}

	podEvents, err := h.k8s.WatchPods(ctx, ns)
	if err != nil {
		log.Printf("Failed to watch pods: %v", err)
		fmt.Fprintf(w, "event: error\ndata: {\"error\":\"Failed to watch pods\"}\n\n")
		flusher.Flush()
		return
	}

	serviceEvents, err := h.k8s.WatchServices(ctx, ns)
	if err != nil {
		log.Printf("Failed to watch services: %v", err)
		fmt.Fprintf(w, "event: error\ndata: {\"error\":\"Failed to watch services\"}\n\n")
		flusher.Flush()
		return
	}

	// Send ready event
	fmt.Fprintf(w, "event: ready\ndata: {\"ok\":true}\n\n")
	flusher.Flush()

	// Merge all event channels
	merged := make(chan k8s.WatchEvent, 100)
	var wg sync.WaitGroup
	wg.Add(3)

	go func() {
		defer wg.Done()
		for event := range nodeEvents {
			merged <- event
		}
	}()

	go func() {
		defer wg.Done()
		for event := range podEvents {
			merged <- event
		}
	}()

	go func() {
		defer wg.Done()
		for event := range serviceEvents {
			merged <- event
		}
	}()

	// Close merged channel when all watchers are done
	go func() {
		wg.Wait()
		close(merged)
	}()

	// Handle client disconnect
	done := make(chan struct{})
	go func() {
		<-r.Context().Done()
		close(done)
		cancel()
	}()

	// Stream events to client
	for {
		select {
		case <-done:
			return
		case event, ok := <-merged:
			if !ok {
				return
			}

			data, err := json.Marshal(event)
			if err != nil {
				log.Printf("Failed to marshal event: %v", err)
				continue
			}

			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.ObjectType, data)
			flusher.Flush()
		}
	}
}
