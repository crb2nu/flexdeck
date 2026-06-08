package handlers

import (
	"context"
	"strings"

	"github.com/flexinfer/flexdeck/internal/k8s"
	"github.com/flexinfer/flexdeck/internal/workspace"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

var (
	bindingGitRepositoryGVR = schema.GroupVersionResource{
		Group: "source.toolkit.fluxcd.io", Version: "v1", Resource: "gitrepositories",
	}
	bindingKustomizationGVR = schema.GroupVersionResource{
		Group: "kustomize.toolkit.fluxcd.io", Version: "v1", Resource: "kustomizations",
	}
)

// fluxBindingTargets lists live Flux GitRepository sources and Kustomizations
// and builds a project-path keyed lookup used to verify repository bindings. It
// is best-effort: any missing client or list error yields a nil map so the
// caller leaves bindings at their inferred confidence.
func (h *Handler) fluxBindingTargets(ctx context.Context, kc *k8s.Client) map[string]workspace.FluxTarget {
	if kc == nil {
		return nil
	}
	dynamicClient, err := h.newDynamicClient(kc.Config())
	if err != nil {
		return nil
	}

	gitRepos, err := dynamicClient.Resource(bindingGitRepositoryGVR).Namespace("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil
	}

	var kustomizations []unstructured.Unstructured
	if list, err := dynamicClient.Resource(bindingKustomizationGVR).Namespace("").List(ctx, metav1.ListOptions{}); err == nil {
		kustomizations = list.Items
	}

	return buildFluxTargets(gitRepos.Items, kustomizations)
}

// buildFluxTargets is the pure join: it normalizes each GitRepository URL to a
// project path and attaches the owning Kustomization. One source can own many
// Kustomizations, so selection is deterministic — the Kustomization whose name
// matches the repo basename wins, otherwise the lexicographically smallest.
func buildFluxTargets(gitRepos, kustomizations []unstructured.Unstructured) map[string]workspace.FluxTarget {
	targets := map[string]workspace.FluxTarget{}
	sourceKeyToPath := map[string]string{}

	for i := range gitRepos {
		obj := &gitRepos[i]
		rawURL, _, _ := unstructured.NestedString(obj.Object, "spec", "url")
		projectPath := workspace.ProjectPathFromURL(rawURL)
		if projectPath == "" {
			continue
		}
		key := strings.ToLower(projectPath)
		if _, exists := targets[key]; exists {
			continue // first source for a path wins
		}
		targets[key] = workspace.FluxTarget{
			ProjectPath:     key,
			SourceName:      obj.GetName(),
			SourceNamespace: obj.GetNamespace(),
		}
		sourceKeyToPath[obj.GetNamespace()+"/"+obj.GetName()] = key
	}

	byPath := map[string][]fluxKustomizationInfo{}
	for i := range kustomizations {
		obj := &kustomizations[i]
		sourceName, _, _ := unstructured.NestedString(obj.Object, "spec", "sourceRef", "name")
		if sourceName == "" {
			continue
		}
		sourceNamespace, _, _ := unstructured.NestedString(obj.Object, "spec", "sourceRef", "namespace")
		if sourceNamespace == "" {
			sourceNamespace = obj.GetNamespace()
		}
		key, ok := sourceKeyToPath[sourceNamespace+"/"+sourceName]
		if !ok {
			continue
		}
		targetNamespace, _, _ := unstructured.NestedString(obj.Object, "spec", "targetNamespace")
		byPath[key] = append(byPath[key], fluxKustomizationInfo{name: obj.GetName(), targetNamespace: targetNamespace})
	}

	for key, candidates := range byPath {
		basename := key
		if idx := strings.LastIndex(key, "/"); idx >= 0 {
			basename = key[idx+1:]
		}
		chosen := pickKustomization(candidates, basename)
		target := targets[key]
		target.Kustomization = chosen.name
		target.TargetNamespace = chosen.targetNamespace
		targets[key] = target
	}

	return targets
}

type fluxKustomizationInfo struct{ name, targetNamespace string }

func pickKustomization(candidates []fluxKustomizationInfo, basename string) fluxKustomizationInfo {
	var best fluxKustomizationInfo
	for _, candidate := range candidates {
		if candidate.name == basename {
			return candidate
		}
		if best.name == "" || candidate.name < best.name {
			best = candidate
		}
	}
	return best
}
