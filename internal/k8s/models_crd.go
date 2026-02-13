package k8s

import (
	"context"
	"encoding/json"
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
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

var modelGVR = schema.GroupVersionResource{
	Group:    "flexinfer.ai",
	Version:  "v1alpha2",
	Resource: "models",
}

// ListFlexInferModels queries flexinfer.ai/v1alpha2 Model CRDs from the given namespace.
func (c *Client) ListFlexInferModels(ctx context.Context, namespace string) ([]FlexInferModel, error) {
	dynClient, err := dynamic.NewForConfig(c.restConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create dynamic client: %w", err)
	}

	list, err := dynClient.Resource(modelGVR).Namespace(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list Model CRDs: %w", err)
	}

	models := make([]FlexInferModel, 0, len(list.Items))
	for _, item := range list.Items {
		raw, err := json.Marshal(item.Object)
		if err != nil {
			continue
		}

		var crd struct {
			Metadata metav1.ObjectMeta    `json:"metadata"`
			Spec     FlexInferModelSpec   `json:"spec"`
			Status   FlexInferModelStatus `json:"status"`
		}
		if err := json.Unmarshal(raw, &crd); err != nil {
			continue
		}

		models = append(models, FlexInferModel{
			Name:              crd.Metadata.Name,
			Namespace:         crd.Metadata.Namespace,
			CreationTimestamp: crd.Metadata.CreationTimestamp.Format("2006-01-02T15:04:05Z"),
			Spec:              crd.Spec,
			Status:            crd.Status,
			Labels:            crd.Metadata.Labels,
			Annotations:       crd.Metadata.Annotations,
		})
	}

	return models, nil
}
