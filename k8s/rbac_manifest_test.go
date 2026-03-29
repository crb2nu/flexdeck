package k8s_test

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

type rbacManifest struct {
	Kind string `yaml:"kind"`
	Rules []struct {
		APIGroups []string `yaml:"apiGroups"`
		Resources []string `yaml:"resources"`
		Verbs     []string `yaml:"verbs"`
	} `yaml:"rules"`
}

func TestFlexdeckClusterRoleIncludesModelCacheReadAccess(t *testing.T) {
	content, err := os.ReadFile(filepath.Join("base", "serviceaccount.yaml"))
	if err != nil {
		t.Fatalf("read serviceaccount manifest: %v", err)
	}

	decoder := yaml.NewDecoder(strings.NewReader(string(content)))
	for {
		var doc rbacManifest
		err := decoder.Decode(&doc)
		if err != nil {
			if err == io.EOF {
				break
			}
			t.Fatalf("decode serviceaccount manifest: %v", err)
		}
		if doc.Kind != "ClusterRole" {
			continue
		}
		for _, rule := range doc.Rules {
			if !contains(rule.APIGroups, "ai.flexinfer") && !contains(rule.APIGroups, "flexinfer.ai") {
				continue
			}
			if contains(rule.Resources, "modelcaches") && contains(rule.Verbs, "get") && contains(rule.Verbs, "list") && contains(rule.Verbs, "watch") {
				return
			}
		}
	}

	t.Fatal("expected flexdeck ClusterRole to grant get/list/watch on ai.flexinfer modelcaches")
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
