package k8s

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sort"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/dynamic"
)

// FlexInferModel represents a flexinfer.ai/v1alpha2 Model CRD.
// This is a lightweight mirror of the controller's type, containing only
// the fields FlexDeck needs to render the dashboard.
type FlexInferModel struct {
	Name              string               `json:"name"`
	Namespace         string               `json:"namespace"`
	CreationTimestamp string               `json:"creationTimestamp"`
	Spec              FlexInferModelSpec   `json:"spec"`
	Status            FlexInferModelStatus `json:"status"`
	Labels            map[string]string    `json:"labels,omitempty"`
	Annotations       map[string]string    `json:"annotations,omitempty"`
}

type FlexInferModelSpec struct {
	Backend       string                `json:"backend"`
	Source        string                `json:"source"`
	GPU           *FlexInferGPUSpec     `json:"gpu,omitempty"`
	Serverless    *FlexInferServerless  `json:"serverless,omitempty"`
	Cache         *FlexInferCacheSpec   `json:"cache,omitempty"`
	LiteLLM       *FlexInferLiteLLMSpec `json:"litellm,omitempty"`
	ServiceLabels []string              `json:"serviceLabels,omitempty"`
	KVCache       *FlexInferKVCacheSpec `json:"kvCache,omitempty"`
	NodeSelector  map[string]string     `json:"nodeSelector,omitempty"`
}

type FlexInferGPUSpec struct {
	Vendor       string `json:"vendor,omitempty"`
	Shared       string `json:"shared,omitempty"`
	Priority     *int32 `json:"priority,omitempty"`
	Count        *int32 `json:"count,omitempty"`
	VRAMEstimate *int64 `json:"vramEstimateMB,omitempty"`
}

type FlexInferServerless struct {
	Enabled          *bool  `json:"enabled,omitempty"`
	MinReplicas      *int32 `json:"minReplicas,omitempty"`
	IdleTimeout      string `json:"idleTimeout,omitempty"`
	ColdStartTimeout string `json:"coldStartTimeout,omitempty"`
}

type FlexInferCacheSpec struct {
	Strategy     string `json:"strategy,omitempty"`
	PVCName      string `json:"pvcName,omitempty"`
	StorageClass string `json:"storageClass,omitempty"`
	Size         string `json:"size,omitempty"`
}

type FlexInferLiteLLMSpec struct {
	Enabled         *bool    `json:"enabled,omitempty"`
	ServedModelName string   `json:"servedModelName,omitempty"`
	Aliases         []string `json:"aliases,omitempty"`
	CopilotAlias    string   `json:"copilotAlias,omitempty"`
}

type FlexInferKVCacheSpec struct {
	PressurePolicy string `json:"pressurePolicy,omitempty"`
	HighWatermark  string `json:"highWatermark,omitempty"`
	LowWatermark   string `json:"lowWatermark,omitempty"`
}

type FlexInferModelStatus struct {
	Phase          string                  `json:"phase,omitempty"`
	Conditions     []FlexInferCondition    `json:"conditions,omitempty"`
	GPU            *FlexInferGPUStatus     `json:"gpu,omitempty"`
	Endpoint       string                  `json:"endpoint,omitempty"`
	LastActiveTime string                  `json:"lastActiveTime,omitempty"`
	Metrics        *FlexInferMetricsStatus `json:"metrics,omitempty"`
	SharedGroup    *FlexInferSharedGroup   `json:"sharedGroup,omitempty"`
	Cache          *FlexInferCacheStatus   `json:"cache,omitempty"`
	KVCache        *FlexInferKVCacheStatus `json:"kvCache,omitempty"`
}

type FlexInferCondition struct {
	Type               string `json:"type"`
	Status             string `json:"status"`
	Reason             string `json:"reason,omitempty"`
	Message            string `json:"message,omitempty"`
	LastTransitionTime string `json:"lastTransitionTime,omitempty"`
}

type FlexInferGPUStatus struct {
	Node         string `json:"node,omitempty"`
	Device       string `json:"device,omitempty"`
	Vendor       string `json:"vendor,omitempty"`
	Architecture string `json:"architecture,omitempty"`
	MemoryMB     int64  `json:"memoryMB,omitempty"`
}

type FlexInferMetricsStatus struct {
	TokensPerSecond string `json:"tokensPerSecond,omitempty"`
	LoadTimeSeconds string `json:"loadTimeSeconds,omitempty"`
	AvgLatencyMs    string `json:"avgLatencyMs,omitempty"`
}

type FlexInferSharedGroup struct {
	GroupName     string `json:"groupName,omitempty"`
	State         string `json:"state,omitempty"`
	QueuePosition int32  `json:"queuePosition,omitempty"`
	PreemptedBy   string `json:"preemptedBy,omitempty"`
	PreemptedAt   string `json:"preemptedAt,omitempty"`
}

type FlexInferCacheStatus struct {
	Strategy  string `json:"strategy,omitempty"`
	Ready     bool   `json:"ready,omitempty"`
	PVCName   string `json:"pvcName,omitempty"`
	JobName   string `json:"jobName,omitempty"`
	JobPhase  string `json:"jobPhase,omitempty"`
	Message   string `json:"message,omitempty"`
	SizeBytes int64  `json:"sizeBytes,omitempty"`
}

type FlexInferKVCacheStatus struct {
	Utilization      string `json:"utilization,omitempty"`
	Pressure         bool   `json:"pressure,omitempty"`
	LastPressureTime string `json:"lastPressureTime,omitempty"`
	LastAction       string `json:"lastAction,omitempty"`
}

// ModelEvent represents a K8s event for a FlexInfer Model CRD.
type ModelEvent struct {
	Type           string `json:"type"`
	Reason         string `json:"reason"`
	Message        string `json:"message"`
	FirstTimestamp string `json:"firstTimestamp"`
	LastTimestamp  string `json:"lastTimestamp"`
	Count          int32  `json:"count"`
	Source         string `json:"source,omitempty"`
}

var modelGVR = schema.GroupVersionResource{
	Group:    "ai.flexinfer",
	Version:  "v1alpha2",
	Resource: "models",
}

var loraAdapterGVR = schema.GroupVersionResource{
	Group:    "ai.flexinfer",
	Version:  "v1alpha2",
	Resource: "loraadapters",
}

var modelCatalogGVR = schema.GroupVersionResource{
	Group:    "ai.flexinfer",
	Version:  "v1alpha2",
	Resource: "modelcatalogs",
}

// LoRAAdapter represents a flexinfer.ai/v1alpha2 LoRAAdapter CRD.
type LoRAAdapter struct {
	Name          string `json:"name"`
	Namespace     string `json:"namespace"`
	ModelRef      string `json:"modelRef"`
	State         string `json:"state"` // Pending, Loaded, Unloading
	AdapterSource string `json:"adapterSource"`
}

// ModelCatalogEntry represents a flexinfer.ai/v1alpha2 ModelCatalog CRD.
type ModelCatalogEntry struct {
	Name         string            `json:"name"`
	Namespace    string            `json:"namespace"`
	Source       string            `json:"source"` // HuggingFace, OCI, Ollama
	Models       []CatalogModelRef `json:"models"`
	LastSyncTime string            `json:"lastSyncTime"`
}

// CatalogModelRef is a model reference within a catalog.
type CatalogModelRef struct {
	Name string   `json:"name"`
	Size string   `json:"size,omitempty"`
	Tags []string `json:"tags,omitempty"`
}

// dynamicClient returns a cached dynamic client, creating it on first use.
func (c *Client) dynamicClient() (dynamic.Interface, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.dynClient != nil {
		return c.dynClient, nil
	}
	dc, err := dynamic.NewForConfig(c.restConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create dynamic client: %w", err)
	}
	c.dynClient = dc
	return dc, nil
}

// ListFlexInferModels queries flexinfer.ai/v1alpha2 Model CRDs from the given namespace.
func (c *Client) ListFlexInferModels(ctx context.Context, namespace string) ([]FlexInferModel, error) {
	dynClient, err := c.dynamicClient()
	if err != nil {
		return nil, err
	}

	list, err := dynClient.Resource(modelGVR).Namespace(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list Model CRDs: %w", err)
	}

	return parseModelList(list)
}

// ScaleFlexInferModel patches spec.serverless.minReplicas on a Model CRD.
func (c *Client) ScaleFlexInferModel(ctx context.Context, namespace, name string, minReplicas int32) error {
	dynClient, err := c.dynamicClient()
	if err != nil {
		return err
	}

	patch := fmt.Sprintf(`{"spec":{"serverless":{"minReplicas":%d}}}`, minReplicas)
	_, err = dynClient.Resource(modelGVR).Namespace(namespace).Patch(
		ctx, name, types.MergePatchType, []byte(patch), metav1.PatchOptions{},
	)
	if err != nil {
		return fmt.Errorf("failed to scale model %s/%s: %w", namespace, name, err)
	}
	return nil
}

// RestartFlexInferModel annotates a Model CRD with a restart timestamp.
func (c *Client) RestartFlexInferModel(ctx context.Context, namespace, name string) error {
	dynClient, err := c.dynamicClient()
	if err != nil {
		return err
	}

	ts := time.Now().Format(time.RFC3339)
	patch := fmt.Sprintf(`{"metadata":{"annotations":{"flexinfer.ai/restartedAt":"%s"}}}`, ts)
	_, err = dynClient.Resource(modelGVR).Namespace(namespace).Patch(
		ctx, name, types.MergePatchType, []byte(patch), metav1.PatchOptions{},
	)
	if err != nil {
		return fmt.Errorf("failed to restart model %s/%s: %w", namespace, name, err)
	}
	return nil
}

// PatchFlexInferModelSpec applies a partial spec update to a Model CRD via MergePatch.
func (c *Client) PatchFlexInferModelSpec(ctx context.Context, namespace, name string, specPatch map[string]any) error {
	dynClient, err := c.dynamicClient()
	if err != nil {
		return err
	}

	patchBody := map[string]any{"spec": specPatch}
	patchBytes, err := json.Marshal(patchBody)
	if err != nil {
		return fmt.Errorf("failed to marshal spec patch: %w", err)
	}

	_, err = dynClient.Resource(modelGVR).Namespace(namespace).Patch(
		ctx, name, types.MergePatchType, patchBytes, metav1.PatchOptions{},
	)
	if err != nil {
		return fmt.Errorf("failed to patch model spec %s/%s: %w", namespace, name, err)
	}
	return nil
}

// ModelWatchEvent represents a model watch event for SSE streaming.
type ModelWatchEvent struct {
	Type  string          `json:"type"` // ADDED, MODIFIED, DELETED
	Model *FlexInferModel `json:"model"`
}

// WatchFlexInferModels returns a channel of model watch events.
func (c *Client) WatchFlexInferModels(ctx context.Context, namespace string) (<-chan ModelWatchEvent, error) {
	dynClient, err := c.dynamicClient()
	if err != nil {
		return nil, err
	}

	watcher, err := dynClient.Resource(modelGVR).Namespace(namespace).Watch(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to watch Model CRDs: %w", err)
	}

	ch := make(chan ModelWatchEvent, 32)
	go func() {
		defer close(ch)
		defer watcher.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case event, ok := <-watcher.ResultChan():
				if !ok {
					return
				}

				obj, ok := event.Object.(*unstructured.Unstructured)
				if !ok {
					continue
				}

				model, err := parseModel(obj)
				if err != nil {
					slog.Warn("failed to parse model watch event", "error", err)
					continue
				}

				eventType := "MODIFIED"
				switch event.Type {
				case watch.Added:
					eventType = "ADDED"
				case watch.Deleted:
					eventType = "DELETED"
				case watch.Modified:
					eventType = "MODIFIED"
				}

				ch <- ModelWatchEvent{Type: eventType, Model: model}
			}
		}
	}()

	return ch, nil
}

func parseModel(obj *unstructured.Unstructured) (*FlexInferModel, error) {
	raw, err := json.Marshal(obj.Object)
	if err != nil {
		return nil, err
	}

	var crd struct {
		Metadata metav1.ObjectMeta    `json:"metadata"`
		Spec     FlexInferModelSpec   `json:"spec"`
		Status   FlexInferModelStatus `json:"status"`
	}
	if err := json.Unmarshal(raw, &crd); err != nil {
		return nil, err
	}

	return &FlexInferModel{
		Name:              crd.Metadata.Name,
		Namespace:         crd.Metadata.Namespace,
		CreationTimestamp: crd.Metadata.CreationTimestamp.Format("2006-01-02T15:04:05Z"),
		Spec:              crd.Spec,
		Status:            crd.Status,
		Labels:            crd.Metadata.Labels,
		Annotations:       crd.Metadata.Annotations,
	}, nil
}

func parseModelList(list *unstructured.UnstructuredList) ([]FlexInferModel, error) {
	models := make([]FlexInferModel, 0, len(list.Items))
	for _, item := range list.Items {
		model, err := parseModel(&item)
		if err != nil {
			continue
		}
		models = append(models, *model)
	}
	return models, nil
}

// GetFlexInferModelEvents returns K8s events for a specific FlexInfer Model CRD.
func (c *Client) GetFlexInferModelEvents(ctx context.Context, namespace, modelName string) ([]ModelEvent, error) {
	eventList, err := c.clientset.CoreV1().Events(namespace).List(ctx, metav1.ListOptions{
		FieldSelector: fmt.Sprintf("involvedObject.name=%s", modelName),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list events: %w", err)
	}

	var events []ModelEvent
	for _, e := range eventList.Items {
		if e.InvolvedObject.Kind != "Model" {
			continue
		}
		source := ""
		if e.Source.Component != "" {
			source = e.Source.Component
		}
		events = append(events, ModelEvent{
			Type:           e.Type,
			Reason:         e.Reason,
			Message:        e.Message,
			FirstTimestamp: e.FirstTimestamp.Format("2006-01-02T15:04:05Z"),
			LastTimestamp:  e.LastTimestamp.Format("2006-01-02T15:04:05Z"),
			Count:          e.Count,
			Source:         source,
		})
	}

	// Sort by lastTimestamp desc
	sort.Slice(events, func(i, j int) bool {
		return events[i].LastTimestamp > events[j].LastTimestamp
	})

	if len(events) > 50 {
		events = events[:50]
	}

	return events, nil
}

// ListLoRAAdapters queries flexinfer.ai/v1alpha2 LoRAAdapter CRDs from the given namespace.
func (c *Client) ListLoRAAdapters(ctx context.Context, namespace string) ([]LoRAAdapter, error) {
	dynClient, err := c.dynamicClient()
	if err != nil {
		return nil, err
	}

	list, err := dynClient.Resource(loraAdapterGVR).Namespace(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list LoRAAdapter CRDs: %w", err)
	}

	adapters := make([]LoRAAdapter, 0, len(list.Items))
	for _, item := range list.Items {
		raw, err := json.Marshal(item.Object)
		if err != nil {
			continue
		}

		var crd struct {
			Metadata metav1.ObjectMeta `json:"metadata"`
			Spec     struct {
				ModelRef      string `json:"modelRef"`
				AdapterSource string `json:"adapterSource"`
			} `json:"spec"`
			Status struct {
				State string `json:"state"`
			} `json:"status"`
		}
		if err := json.Unmarshal(raw, &crd); err != nil {
			continue
		}

		state := crd.Status.State
		if state == "" {
			state = "Pending"
		}
		adapters = append(adapters, LoRAAdapter{
			Name:          crd.Metadata.Name,
			Namespace:     crd.Metadata.Namespace,
			ModelRef:      crd.Spec.ModelRef,
			State:         state,
			AdapterSource: crd.Spec.AdapterSource,
		})
	}

	return adapters, nil
}

// ListModelCatalogs queries flexinfer.ai/v1alpha2 ModelCatalog CRDs from the given namespace.
func (c *Client) ListModelCatalogs(ctx context.Context, namespace string) ([]ModelCatalogEntry, error) {
	dynClient, err := c.dynamicClient()
	if err != nil {
		return nil, err
	}

	list, err := dynClient.Resource(modelCatalogGVR).Namespace(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list ModelCatalog CRDs: %w", err)
	}

	entries := make([]ModelCatalogEntry, 0, len(list.Items))
	for _, item := range list.Items {
		raw, err := json.Marshal(item.Object)
		if err != nil {
			continue
		}

		var crd struct {
			Metadata metav1.ObjectMeta `json:"metadata"`
			Spec     struct {
				Source string            `json:"source"`
				Models []CatalogModelRef `json:"models"`
			} `json:"spec"`
			Status struct {
				LastSyncTime string `json:"lastSyncTime"`
			} `json:"status"`
		}
		if err := json.Unmarshal(raw, &crd); err != nil {
			continue
		}

		entries = append(entries, ModelCatalogEntry{
			Name:         crd.Metadata.Name,
			Namespace:    crd.Metadata.Namespace,
			Source:       crd.Spec.Source,
			Models:       crd.Spec.Models,
			LastSyncTime: crd.Status.LastSyncTime,
		})
	}

	return entries, nil
}
