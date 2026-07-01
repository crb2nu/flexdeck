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
	Kind     string `yaml:"kind"`
	Metadata struct {
		Name string `yaml:"name"`
	} `yaml:"metadata"`
	Rules []struct {
		APIGroups []string `yaml:"apiGroups"`
		Resources []string `yaml:"resources"`
		Verbs     []string `yaml:"verbs"`
	} `yaml:"rules"`
}

type deploymentManifest struct {
	Kind string `yaml:"kind"`
	Spec struct {
		Selector struct {
			MatchLabels map[string]string `yaml:"matchLabels"`
		} `yaml:"selector"`
		Template struct {
			Spec struct {
				ServiceAccountName string `yaml:"serviceAccountName"`
				Containers         []struct {
					Name string `yaml:"name"`
					Env  []struct {
						Name  string `yaml:"name"`
						Value string `yaml:"value"`
					} `yaml:"env"`
					VolumeMounts []struct {
						Name      string `yaml:"name"`
						MountPath string `yaml:"mountPath"`
					} `yaml:"volumeMounts"`
				} `yaml:"containers"`
				Volumes []struct {
					Name                  string `yaml:"name"`
					PersistentVolumeClaim *struct {
						ClaimName string `yaml:"claimName"`
					} `yaml:"persistentVolumeClaim"`
					NFS *struct {
						Server string `yaml:"server"`
					} `yaml:"nfs"`
				} `yaml:"volumes"`
			} `yaml:"spec"`
		} `yaml:"template"`
	} `yaml:"spec"`
}

type serviceManifest struct {
	Kind string `yaml:"kind"`
	Spec struct {
		Selector map[string]string `yaml:"selector"`
	} `yaml:"spec"`
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

// TestFlexdeckClusterRoleIncludesGamingSessionReadAccess guards the RBAC grant
// that lets the fleet view read GamingSession CRDs. Without it, the gaming
// endpoint 403s and the node-mode surface is silently empty.
func TestFlexdeckClusterRoleIncludesGamingSessionReadAccess(t *testing.T) {
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
			if contains(rule.Resources, "gamingsessions") && contains(rule.Verbs, "get") && contains(rule.Verbs, "list") && contains(rule.Verbs, "watch") {
				return
			}
		}
	}

	t.Fatal("expected flexdeck ClusterRole to grant get/list/watch on ai.flexinfer gamingsessions")
}

func TestPublicReaderClusterRoleIsReadOnlyAndNonSensitive(t *testing.T) {
	content, err := os.ReadFile(filepath.Join("base", "public-serviceaccount.yaml"))
	if err != nil {
		t.Fatalf("read public serviceaccount manifest: %v", err)
	}

	var publicRole *rbacManifest
	decoder := yaml.NewDecoder(strings.NewReader(string(content)))
	for {
		var doc rbacManifest
		err := decoder.Decode(&doc)
		if err != nil {
			if err == io.EOF {
				break
			}
			t.Fatalf("decode public serviceaccount manifest: %v", err)
		}
		if doc.Kind == "ClusterRole" && doc.Metadata.Name == "flexdeck-public-reader" {
			publicRole = &doc
			break
		}
	}
	if publicRole == nil {
		t.Fatal("expected flexdeck-public-reader ClusterRole")
	}

	for _, rule := range publicRole.Rules {
		for _, verb := range rule.Verbs {
			if !contains([]string{"get", "list"}, verb) {
				t.Fatalf("public reader grants non-read-only verb %q in rule %+v", verb, rule)
			}
		}
		if contains(rule.Resources, "secrets") || contains(rule.Resources, "pods/log") || contains(rule.Resources, "configmaps") {
			t.Fatalf("public reader grants sensitive resource in rule %+v", rule)
		}
	}
}

func TestPublicDeploymentUsesLimitedServiceAccount(t *testing.T) {
	content, err := os.ReadFile(filepath.Join("base", "public-deployment.yaml"))
	if err != nil {
		t.Fatalf("read public deployment manifest: %v", err)
	}

	var deployment deploymentManifest
	if err := yaml.Unmarshal(content, &deployment); err != nil {
		t.Fatalf("decode public deployment manifest: %v", err)
	}
	if deployment.Kind != "Deployment" {
		t.Fatalf("expected Deployment, got %q", deployment.Kind)
	}
	if deployment.Spec.Template.Spec.ServiceAccountName != "flexdeck-public" {
		t.Fatalf("expected public deployment to use flexdeck-public service account, got %q", deployment.Spec.Template.Spec.ServiceAccountName)
	}
	if got := deployment.Spec.Selector.MatchLabels["app.kubernetes.io/component"]; got != "public-api" {
		t.Fatalf("expected public-api selector, got %q", got)
	}

	env := map[string]string{}
	if len(deployment.Spec.Template.Spec.Containers) == 0 {
		t.Fatal("expected at least one container")
	}
	for _, item := range deployment.Spec.Template.Spec.Containers[0].Env {
		env[item.Name] = item.Value
	}
	if env["K8S_READONLY"] != "true" {
		t.Fatalf("expected K8S_READONLY=true, got %q", env["K8S_READONLY"])
	}
	if _, ok := env["GITLAB_TOKEN"]; ok {
		t.Fatal("public deployment must not mount GITLAB_TOKEN")
	}
}

// TestPrimaryDeploymentLokiURLTargetsSingleBinaryService guards against
// regressing LOKI_URL to a service that does not exist in this cluster.
// Loki runs in single-binary mode here, exposed as loki:3100; the
// loki-gateway service only exists in SSD/distributed Helm deployments, so
// pointing at it made every Loki proxy call fail DNS and surface as a 502.
func TestPrimaryDeploymentLokiURLTargetsSingleBinaryService(t *testing.T) {
	content, err := os.ReadFile(filepath.Join("base", "deployment.yaml"))
	if err != nil {
		t.Fatalf("read deployment manifest: %v", err)
	}

	var deployment deploymentManifest
	if err := yaml.Unmarshal(content, &deployment); err != nil {
		t.Fatalf("decode deployment manifest: %v", err)
	}
	if len(deployment.Spec.Template.Spec.Containers) == 0 {
		t.Fatal("expected at least one container")
	}

	env := map[string]string{}
	for _, item := range deployment.Spec.Template.Spec.Containers[0].Env {
		env[item.Name] = item.Value
	}

	got, ok := env["LOKI_URL"]
	if !ok {
		t.Fatal("expected LOKI_URL to be set on the primary deployment")
	}
	const want = "http://loki.logging.svc.cluster.local:3100"
	if got != want {
		t.Fatalf("LOKI_URL = %q, want %q (loki-gateway service does not exist in single-binary mode)", got, want)
	}
	if strings.Contains(got, "loki-gateway") {
		t.Fatalf("LOKI_URL points at nonexistent loki-gateway service: %q", got)
	}
}

// TestPrimaryDeploymentHasNoNASStartupDependency guards against regressing the
// flexdeck server into a hard dependency on the workspace NFS export. On
// 2026-06-13 a NAS outage left the required `hard` NFS volume unmountable, so
// the pod was stuck ContainerCreating for ~14h, the Service had zero
// endpoints, and the entire dashboard returned 100% ingress errors. Stack
// Explorer now reads its inventory from the in-cluster GitLab API, so the pod
// must not mount any PVC/NFS-backed volume that could block startup when the
// NAS is down.
func TestPrimaryDeploymentHasNoNASStartupDependency(t *testing.T) {
	content, err := os.ReadFile(filepath.Join("base", "deployment.yaml"))
	if err != nil {
		t.Fatalf("read deployment manifest: %v", err)
	}

	var deployment deploymentManifest
	if err := yaml.Unmarshal(content, &deployment); err != nil {
		t.Fatalf("decode deployment manifest: %v", err)
	}

	for _, vol := range deployment.Spec.Template.Spec.Volumes {
		if vol.PersistentVolumeClaim != nil {
			t.Fatalf("primary deployment must not mount a PVC-backed volume (volume %q claims %q); it makes pod startup depend on external storage availability", vol.Name, vol.PersistentVolumeClaim.ClaimName)
		}
		if vol.NFS != nil {
			t.Fatalf("primary deployment must not mount an NFS-backed volume (volume %q server %q); it makes pod startup depend on NAS availability", vol.Name, vol.NFS.Server)
		}
	}

	for _, container := range deployment.Spec.Template.Spec.Containers {
		for _, mount := range container.VolumeMounts {
			if mount.MountPath == "/workspace" {
				t.Fatalf("container %q must not mount /workspace; the workspace NFS dependency caused the 2026-06-13 dashboard outage", container.Name)
			}
		}
	}
}

func TestPrimaryServiceDoesNotSelectPublicPods(t *testing.T) {
	content, err := os.ReadFile(filepath.Join("base", "service.yaml"))
	if err != nil {
		t.Fatalf("read service manifest: %v", err)
	}

	var service serviceManifest
	if err := yaml.Unmarshal(content, &service); err != nil {
		t.Fatalf("decode service manifest: %v", err)
	}
	if got := service.Spec.Selector["app.kubernetes.io/component"]; got != "server" {
		t.Fatalf("expected primary service to select only server pods, got component=%q", got)
	}
}

type redisRBACManifest struct {
	Kind string `yaml:"kind"`
	Spec struct {
		Strategy struct {
			Type string `yaml:"type"`
		} `yaml:"strategy"`
		Template struct {
			Spec struct {
				Containers []struct {
					Args         []string `yaml:"args"`
					VolumeMounts []struct {
						MountPath string `yaml:"mountPath"`
					} `yaml:"volumeMounts"`
				} `yaml:"containers"`
				Volumes []struct {
					PersistentVolumeClaim *struct {
						ClaimName string `yaml:"claimName"`
					} `yaml:"persistentVolumeClaim"`
				} `yaml:"volumes"`
			} `yaml:"spec"`
		} `yaml:"template"`
	} `yaml:"spec"`
}

// TestRedisRBACInstanceIsDurableAndNonEvicting guards the load-bearing
// properties of the dedicated RBAC Redis: AOF persistence on a PVC and a
// noeviction policy. Regressing any of these would silently lose RBAC users
// (the cache Redis uses allkeys-lru, which is why RBAC needs its own instance).
func TestRedisRBACInstanceIsDurableAndNonEvicting(t *testing.T) {
	content, err := os.ReadFile(filepath.Join("base", "redis-rbac.yaml"))
	if err != nil {
		t.Fatalf("read redis-rbac manifest: %v", err)
	}

	var pvcFound bool
	var deployment *redisRBACManifest
	decoder := yaml.NewDecoder(strings.NewReader(string(content)))
	for {
		var doc redisRBACManifest
		err := decoder.Decode(&doc)
		if err != nil {
			if err == io.EOF {
				break
			}
			t.Fatalf("decode redis-rbac manifest: %v", err)
		}
		switch doc.Kind {
		case "PersistentVolumeClaim":
			pvcFound = true
		case "Deployment":
			d := doc
			deployment = &d
		}
	}

	if !pvcFound {
		t.Fatal("expected redis-rbac to declare a PersistentVolumeClaim for durable storage")
	}
	if deployment == nil {
		t.Fatal("expected a redis-rbac Deployment")
	}
	if deployment.Spec.Strategy.Type != "Recreate" {
		t.Fatalf("redis-rbac strategy = %q, want Recreate (RWO PVC cannot attach to two pods)", deployment.Spec.Strategy.Type)
	}
	if len(deployment.Spec.Template.Spec.Containers) == 0 {
		t.Fatal("expected at least one container in redis-rbac")
	}

	args := deployment.Spec.Template.Spec.Containers[0].Args
	if !argPairPresent(args, "--appendonly", "yes") {
		t.Fatalf("redis-rbac must run with --appendonly yes (AOF durability); args=%v", args)
	}
	if !argPairPresent(args, "--maxmemory-policy", "noeviction") {
		t.Fatalf("redis-rbac must run with --maxmemory-policy noeviction (never evict the user set); args=%v", args)
	}

	var pvcVolume bool
	for _, vol := range deployment.Spec.Template.Spec.Volumes {
		if vol.PersistentVolumeClaim != nil {
			pvcVolume = true
		}
	}
	if !pvcVolume {
		t.Fatal("expected redis-rbac pod to mount its PersistentVolumeClaim")
	}
}

// TestPrimaryDeploymentWiresRBACRedisURL ensures the flexdeck server points RBAC
// persistence at the dedicated redis-rbac service rather than the LRU cache.
func TestPrimaryDeploymentWiresRBACRedisURL(t *testing.T) {
	content, err := os.ReadFile(filepath.Join("base", "deployment.yaml"))
	if err != nil {
		t.Fatalf("read deployment manifest: %v", err)
	}

	var deployment deploymentManifest
	if err := yaml.Unmarshal(content, &deployment); err != nil {
		t.Fatalf("decode deployment manifest: %v", err)
	}
	if len(deployment.Spec.Template.Spec.Containers) == 0 {
		t.Fatal("expected at least one container")
	}

	env := map[string]string{}
	for _, item := range deployment.Spec.Template.Spec.Containers[0].Env {
		env[item.Name] = item.Value
	}
	const want = "redis://redis-rbac.flexdeck.svc.cluster.local:6379/0"
	if got := env["RBAC_REDIS_URL"]; got != want {
		t.Fatalf("RBAC_REDIS_URL = %q, want %q", got, want)
	}
}

// argPairPresent reports whether args contains flag immediately followed by value.
func argPairPresent(args []string, flag, value string) bool {
	for i, a := range args {
		if a == flag && i+1 < len(args) && args[i+1] == value {
			return true
		}
	}
	return false
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
