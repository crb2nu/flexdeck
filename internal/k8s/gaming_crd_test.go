package k8s

import (
	"context"
	"testing"
	"time"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func gamingSessionObject(name, namespace string, spec map[string]any, status map[string]any) *unstructured.Unstructured {
	obj := map[string]any{
		"apiVersion": "ai.flexinfer/v1alpha2",
		"kind":       "GamingSession",
		"metadata": map[string]any{
			"name":      name,
			"namespace": namespace,
		},
		"spec": spec,
	}
	if status != nil {
		obj["status"] = status
	}
	return &unstructured.Unstructured{Object: obj}
}

func TestParseGamingSessionMapsFields(t *testing.T) {
	created := time.Date(2026, 7, 1, 13, 18, 15, 0, time.UTC)
	obj := &unstructured.Unstructured{
		Object: map[string]any{
			"apiVersion": "ai.flexinfer/v1alpha2",
			"kind":       "GamingSession",
			"metadata": map[string]any{
				"name":              "gaming-7900xtx",
				"namespace":         "flexinfer-system",
				"creationTimestamp": created.Format(time.RFC3339),
				"labels": map[string]any{
					"kustomize.toolkit.fluxcd.io/name": "flexinfer-models",
				},
			},
			"spec": map[string]any{
				"mode":     "gaming",
				"nodeName": "cblevins-7900xtx",
			},
			"status": map[string]any{
				"phase":        "Active",
				"observedMode": "gaming",
				"runtimePod":   "flexinfer-runtime-gfx1100-pbsks",
				"activatedAt":  "2026-07-01T13:18:44Z",
				"message":      "node in gaming mode",
			},
		},
	}

	session, err := parseGamingSession(obj)
	if err != nil {
		t.Fatalf("parseGamingSession() returned error: %v", err)
	}
	if session.Name != "gaming-7900xtx" || session.Namespace != "flexinfer-system" {
		t.Fatalf("unexpected identity: %+v", session)
	}
	if session.Spec.Mode != "gaming" || session.Spec.NodeName != "cblevins-7900xtx" {
		t.Fatalf("spec did not round-trip: %+v", session.Spec)
	}
	if session.Status.Phase != "Active" || session.Status.ObservedMode != "gaming" {
		t.Fatalf("status phase/mode did not round-trip: %+v", session.Status)
	}
	if session.Status.RuntimePod != "flexinfer-runtime-gfx1100-pbsks" {
		t.Fatalf("runtimePod did not round-trip: %+v", session.Status)
	}
	if session.Status.ActivatedAt != "2026-07-01T13:18:44Z" || session.Status.Message != "node in gaming mode" {
		t.Fatalf("status detail did not round-trip: %+v", session.Status)
	}
	if session.Labels["kustomize.toolkit.fluxcd.io/name"] != "flexinfer-models" {
		t.Fatalf("labels did not round-trip: %+v", session.Labels)
	}
}

func TestListGamingSessionsSkipsMalformedCRDs(t *testing.T) {
	client := newDynamicFlexInferClient(
		gamingSessionObject("gaming-7900xtx", "flexinfer-system",
			map[string]any{"mode": "gaming", "nodeName": "cblevins-7900xtx"},
			map[string]any{"phase": "Active", "observedMode": "gaming"},
		),
		&unstructured.Unstructured{
			Object: map[string]any{
				"apiVersion": "ai.flexinfer/v1alpha2",
				"kind":       "GamingSession",
				"metadata": map[string]any{
					"name":      "broken",
					"namespace": "flexinfer-system",
				},
				"spec": "not-an-object",
			},
		},
	)

	sessions, err := client.ListGamingSessions(context.Background(), "flexinfer-system")
	if err != nil {
		t.Fatalf("ListGamingSessions() returned error: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("expected one valid session, got %d", len(sessions))
	}
	if sessions[0].Name != "gaming-7900xtx" || sessions[0].Spec.NodeName != "cblevins-7900xtx" {
		t.Fatalf("unexpected session parsed: %+v", sessions[0])
	}
	if sessions[0].Status.Phase != "Active" {
		t.Fatalf("expected Active phase, got %+v", sessions[0].Status)
	}
}
