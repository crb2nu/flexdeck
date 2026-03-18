package k8s

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/watch"
)

var modelCacheGVR = schema.GroupVersionResource{
	Group:    "ai.flexinfer",
	Version:  "v1alpha1",
	Resource: "modelcaches",
}

// FlexInferModelCache represents a ai.flexinfer/v1alpha1 ModelCache CRD.
// Lightweight mirror containing only fields FlexDeck renders.
type FlexInferModelCache struct {
	Name              string            `json:"name"`
	Namespace         string            `json:"namespace"`
	CreationTimestamp string            `json:"creationTimestamp"`
	Labels            map[string]string `json:"labels,omitempty"`
	Annotations       map[string]string `json:"annotations,omitempty"`
	Spec              ModelCacheSpec    `json:"spec"`
	Status            ModelCacheStatus  `json:"status"`
}

type ModelCacheSpec struct {
	Source            string              `json:"source"`
	StorageStrategy   string              `json:"storageStrategy,omitempty"`
	StorageSize       string              `json:"storageSize,omitempty"`
	ExistingClaimName *string             `json:"existingClaimName,omitempty"`
	Quantization      *MCQuantizationSpec `json:"quantization,omitempty"`
	Abliteration      *MCAbliterationSpec `json:"abliteration,omitempty"`
	Finetune          *MCFinetuneSpec     `json:"finetune,omitempty"`
	Publish           *MCPublishSpec      `json:"publish,omitempty"`
	Download          *MCDownloadSpec     `json:"download,omitempty"`
}

type MCQuantizationSpec struct {
	Format         string `json:"format"`
	GGUFType       string `json:"ggufType,omitempty"`
	Bits           *int32 `json:"bits,omitempty"`
	GroupSize      *int32 `json:"groupSize,omitempty"`
	UseGPU         bool   `json:"useGPU,omitempty"`
	TimeoutSeconds *int64 `json:"timeoutSeconds,omitempty"`
}

type MCAbliterationSpec struct {
	TargetLayers   *string  `json:"targetLayers,omitempty"`
	WeightMatrices []string `json:"weightMatrices,omitempty"`
	NumSamples     *int32   `json:"numSamples,omitempty"`
	UseGPU         bool     `json:"useGPU,omitempty"`
	TimeoutSeconds *int64   `json:"timeoutSeconds,omitempty"`
}

type MCFinetuneSpec struct {
	Mode         *string           `json:"mode,omitempty"`
	Dataset      MCFinetuneDataset `json:"dataset"`
	LoRA         *MCFinetuneLoRA   `json:"lora,omitempty"`
	Epochs       *int32            `json:"epochs,omitempty"`
	BatchSize    *int32            `json:"batchSize,omitempty"`
	LearningRate *string           `json:"learningRate,omitempty"`
	MaxSeqLen    *int32            `json:"maxSeqLen,omitempty"`
}

type MCFinetuneDataset struct {
	HuggingFace *string `json:"huggingFace,omitempty"`
	PVCName     *string `json:"pvcName,omitempty"`
	Split       *string `json:"split,omitempty"`
	MaxSamples  *int32  `json:"maxSamples,omitempty"`
}

type MCFinetuneLoRA struct {
	Rank    *int32  `json:"rank,omitempty"`
	Alpha   *int32  `json:"alpha,omitempty"`
	Dropout *string `json:"dropout,omitempty"`
}

type MCPublishSpec struct {
	Targets         []string `json:"targets"`
	OCIRef          *string  `json:"ociRef,omitempty"`
	HuggingFaceRepo *string  `json:"huggingFaceRepo,omitempty"`
}

type MCDownloadSpec struct {
	MaxMemoryGB  *int32 `json:"maxMemoryGB,omitempty"`
	HFTransfer   *bool  `json:"hfTransfer,omitempty"`
	BackoffLimit *int32 `json:"backoffLimit,omitempty"`
}

type ModelCacheStatus struct {
	Phase        string                `json:"phase,omitempty"`
	Path         string                `json:"path,omitempty"`
	SizeBytes    string                `json:"sizeBytes,omitempty"`
	Conditions   []ModelCacheCondition `json:"conditions,omitempty"`
	Quantization *MCQuantizationStatus `json:"quantization,omitempty"`
	Abliteration *MCAbliterationStatus `json:"abliteration,omitempty"`
	Finetune     *MCFinetuneStatus     `json:"finetune,omitempty"`
	Publish      *MCPublishStatus      `json:"publish,omitempty"`
}

type ModelCacheCondition struct {
	Type               string `json:"type"`
	Status             string `json:"status"`
	Reason             string `json:"reason,omitempty"`
	Message            string `json:"message,omitempty"`
	LastTransitionTime string `json:"lastTransitionTime,omitempty"`
}

type MCQuantizationStatus struct {
	Format              string `json:"format,omitempty"`
	Type                string `json:"type,omitempty"`
	OriginalSizeBytes   int64  `json:"originalSizeBytes,omitempty"`
	CompressedSizeBytes int64  `json:"compressedSizeBytes,omitempty"`
	CompressionRatio    string `json:"compressionRatio,omitempty"`
	QuantizationTime    string `json:"quantizationTime,omitempty"`
	Progress            *int32 `json:"progress,omitempty"`
	ProgressDetail      string `json:"progressDetail,omitempty"`
	StartedAt           string `json:"startedAt,omitempty"`
	FailureMessage      string `json:"failureMessage,omitempty"`
}

type MCAbliterationStatus struct {
	LayersModified   int32  `json:"layersModified,omitempty"`
	RefusalDirNorm   string `json:"refusalDirNorm,omitempty"`
	AbliterationTime string `json:"abliterationTime,omitempty"`
	Progress         *int32 `json:"progress,omitempty"`
	ProgressDetail   string `json:"progressDetail,omitempty"`
	StartedAt        string `json:"startedAt,omitempty"`
	FailureMessage   string `json:"failureMessage,omitempty"`
}

type MCFinetuneStatus struct {
	TrainLoss        string `json:"trainLoss,omitempty"`
	SamplesPerSecond string `json:"samplesPerSecond,omitempty"`
	EpochsCompleted  int32  `json:"epochsCompleted,omitempty"`
	TotalSteps       int32  `json:"totalSteps,omitempty"`
	FinetuneTime     string `json:"finetuneTime,omitempty"`
	Progress         *int32 `json:"progress,omitempty"`
	ProgressDetail   string `json:"progressDetail,omitempty"`
	StartedAt        string `json:"startedAt,omitempty"`
	FailureMessage   string `json:"failureMessage,omitempty"`
}

type MCPublishStatus struct {
	OCIDigest         string `json:"ociDigest,omitempty"`
	HuggingFaceCommit string `json:"huggingFaceCommit,omitempty"`
	PublishedAt       string `json:"publishedAt,omitempty"`
	Progress          *int32 `json:"progress,omitempty"`
	ProgressDetail    string `json:"progressDetail,omitempty"`
	StartedAt         string `json:"startedAt,omitempty"`
	FailureMessage    string `json:"failureMessage,omitempty"`
}

// ModelCacheWatchEvent represents a watch event for SSE streaming.
type ModelCacheWatchEvent struct {
	Type       string               `json:"type"` // ADDED, MODIFIED, DELETED
	ModelCache *FlexInferModelCache `json:"modelCache"`
}

// ListModelCaches queries ai.flexinfer/v1alpha1 ModelCache CRDs from the given namespace.
func (c *Client) ListModelCaches(ctx context.Context, namespace string) ([]FlexInferModelCache, error) {
	dynClient, err := c.dynamicClient()
	if err != nil {
		return nil, err
	}

	list, err := dynClient.Resource(modelCacheGVR).Namespace(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list ModelCache CRDs: %w", err)
	}

	return parseModelCacheList(list)
}

// GetModelCache retrieves a single ModelCache CRD by namespace and name.
func (c *Client) GetModelCache(ctx context.Context, namespace, name string) (*FlexInferModelCache, error) {
	dynClient, err := c.dynamicClient()
	if err != nil {
		return nil, err
	}

	obj, err := dynClient.Resource(modelCacheGVR).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get ModelCache %s/%s: %w", namespace, name, err)
	}

	return parseModelCache(obj)
}

// WatchModelCaches returns a channel of ModelCache watch events.
func (c *Client) WatchModelCaches(ctx context.Context, namespace string) (<-chan ModelCacheWatchEvent, error) {
	dynClient, err := c.dynamicClient()
	if err != nil {
		return nil, err
	}

	watcher, err := dynClient.Resource(modelCacheGVR).Namespace(namespace).Watch(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to watch ModelCache CRDs: %w", err)
	}

	ch := make(chan ModelCacheWatchEvent, 32)
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

				mc, err := parseModelCache(obj)
				if err != nil {
					slog.Warn("failed to parse ModelCache watch event", "error", err)
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

				ch <- ModelCacheWatchEvent{Type: eventType, ModelCache: mc}
			}
		}
	}()

	return ch, nil
}

func parseModelCache(obj *unstructured.Unstructured) (*FlexInferModelCache, error) {
	raw, err := json.Marshal(obj.Object)
	if err != nil {
		return nil, err
	}

	var crd struct {
		Metadata metav1.ObjectMeta `json:"metadata"`
		Spec     ModelCacheSpec    `json:"spec"`
		Status   ModelCacheStatus  `json:"status"`
	}
	if err := json.Unmarshal(raw, &crd); err != nil {
		return nil, err
	}

	return &FlexInferModelCache{
		Name:              crd.Metadata.Name,
		Namespace:         crd.Metadata.Namespace,
		CreationTimestamp: crd.Metadata.CreationTimestamp.Format("2006-01-02T15:04:05Z"),
		Labels:            crd.Metadata.Labels,
		Annotations:       crd.Metadata.Annotations,
		Spec:              crd.Spec,
		Status:            crd.Status,
	}, nil
}

func parseModelCacheList(list *unstructured.UnstructuredList) ([]FlexInferModelCache, error) {
	caches := make([]FlexInferModelCache, 0, len(list.Items))
	for _, item := range list.Items {
		mc, err := parseModelCache(&item)
		if err != nil {
			continue
		}
		caches = append(caches, *mc)
	}
	return caches, nil
}
