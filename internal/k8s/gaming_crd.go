package k8s

import (
	"context"
	"encoding/json"
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// GamingSession represents an ai.flexinfer/v1alpha2 GamingSession CRD.
//
// A GamingSession claims a GPU node for game streaming (Sunshine/Moonlight)
// instead of LLM inference. While one is Active, the node's inference models
// are scaled to zero and a hostNetwork runtime pod binds the Moonlight ports.
// This is a lightweight mirror of the controller's type — only the fields
// FlexDeck needs to render the fleet view.
type GamingSession struct {
	Name              string              `json:"name"`
	Namespace         string              `json:"namespace"`
	CreationTimestamp string              `json:"creationTimestamp"`
	Spec              GamingSessionSpec   `json:"spec"`
	Status            GamingSessionStatus `json:"status"`
	Labels            map[string]string   `json:"labels,omitempty"`
	Annotations       map[string]string   `json:"annotations,omitempty"`
}

type GamingSessionSpec struct {
	// Mode is the requested node mode, e.g. "gaming".
	Mode string `json:"mode,omitempty"`
	// NodeName is the GPU node claimed for the session.
	NodeName string `json:"nodeName,omitempty"`
}

type GamingSessionStatus struct {
	// Phase is the reconciled lifecycle state, e.g. Pending, Active, Terminating.
	Phase string `json:"phase,omitempty"`
	// ObservedMode reflects the mode the controller has actually applied.
	ObservedMode string `json:"observedMode,omitempty"`
	// RuntimePod is the hostNetwork Sunshine/Moonlight pod serving the stream.
	RuntimePod string `json:"runtimePod,omitempty"`
	// ActivatedAt is the RFC3339 timestamp the session became Active.
	ActivatedAt string `json:"activatedAt,omitempty"`
	// Message is a human-readable status detail.
	Message string `json:"message,omitempty"`
}

var gamingSessionGVR = schema.GroupVersionResource{
	Group:    "ai.flexinfer",
	Version:  "v1alpha2",
	Resource: "gamingsessions",
}

// ListGamingSessions queries ai.flexinfer/v1alpha2 GamingSession CRDs from the
// given namespace. An empty namespace lists across all namespaces.
func (c *Client) ListGamingSessions(ctx context.Context, namespace string) ([]GamingSession, error) {
	dynClient, err := c.dynamicClient()
	if err != nil {
		return nil, err
	}

	list, err := dynClient.Resource(gamingSessionGVR).Namespace(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list GamingSession CRDs: %w", err)
	}

	return parseGamingSessionList(list)
}

func parseGamingSession(obj *unstructured.Unstructured) (*GamingSession, error) {
	raw, err := json.Marshal(obj.Object)
	if err != nil {
		return nil, err
	}

	var crd struct {
		Metadata metav1.ObjectMeta   `json:"metadata"`
		Spec     GamingSessionSpec   `json:"spec"`
		Status   GamingSessionStatus `json:"status"`
	}
	if err := json.Unmarshal(raw, &crd); err != nil {
		return nil, err
	}

	return &GamingSession{
		Name:              crd.Metadata.Name,
		Namespace:         crd.Metadata.Namespace,
		CreationTimestamp: crd.Metadata.CreationTimestamp.Format("2006-01-02T15:04:05Z"),
		Spec:              crd.Spec,
		Status:            crd.Status,
		Labels:            crd.Metadata.Labels,
		Annotations:       crd.Metadata.Annotations,
	}, nil
}

func parseGamingSessionList(list *unstructured.UnstructuredList) ([]GamingSession, error) {
	sessions := make([]GamingSession, 0, len(list.Items))
	for i := range list.Items {
		session, err := parseGamingSession(&list.Items[i])
		if err != nil {
			continue
		}
		sessions = append(sessions, *session)
	}
	return sessions, nil
}
