package workspace

import "strings"

// BindingKind classifies how a repository relates to a runtime cluster target.
type BindingKind string

const (
	// BindingKindService marks a deployable service repo with an inferred
	// cluster target (namespace + Flux source).
	BindingKindService BindingKind = "service"
	// BindingKindLibrary marks a library repo that is consumed by services
	// rather than deployed to a cluster.
	BindingKindLibrary BindingKind = "library"
	// BindingKindUnknown marks a repo we cannot confidently classify.
	BindingKindUnknown BindingKind = "unknown"
)

// BindingConfidence describes how trustworthy the inferred cluster target is.
// This slice derives bindings only from inventory metadata (names, GitLab
// paths, remotes), so the strongest level it emits is "inferred". A later
// slice can raise this to "verified" by cross-referencing live Flux/K8s state.
type BindingConfidence string

const (
	// BindingConfidenceVerified means the target was confirmed against live
	// cluster/Flux state. Reserved for a future cross-reference slice.
	BindingConfidenceVerified BindingConfidence = "verified"
	// BindingConfidenceInferred means the target was guessed from naming and
	// remote conventions and has not been verified against the cluster.
	BindingConfidenceInferred BindingConfidence = "inferred"
	// BindingConfidenceNone means no cluster target applies (e.g. libraries).
	BindingConfidenceNone BindingConfidence = "none"
)

// RepoBinding is a read-only, heuristic mapping from a repository to a likely
// runtime/cluster identity. Every field is best-effort and derived from data
// the scanner already collected; it adds no new filesystem or network reads.
type RepoBinding struct {
	Kind          BindingKind       `json:"kind"`
	Confidence    BindingConfidence `json:"confidence"`
	GitLabProject string            `json:"gitlabProject,omitempty"` // group/repo, e.g. services/flexdeck
	Namespace     string            `json:"namespace,omitempty"`     // Kubernetes namespace (inferred, or verified targetNamespace)
	FluxSource    string            `json:"fluxSource,omitempty"`    // Flux GitRepository source name
	FluxNamespace string            `json:"fluxNamespace,omitempty"` // namespace of the Flux GitRepository (verified only)
	Kustomization string            `json:"kustomization,omitempty"` // Flux Kustomization name
	MatchKey      string            `json:"matchKey,omitempty"`      // normalized host/path for live cross-reference
	Workload      *Workload         `json:"workload,omitempty"`      // live K8s Deployment health (verified only)
	Signals       []string          `json:"signals,omitempty"`       // which inputs produced this binding
}

// Workload summarizes the live Kubernetes workloads that a service's Flux source
// manages (Deployments, StatefulSets, DaemonSets, Jobs, CronJobs): which
// namespaces they run in, per-kind counts, and aggregate replica health. Jobs
// and CronJobs have no replica model, so they add presence + counts but not to
// Ready/Desired; a failed Job still folds into Status.
type Workload struct {
	Namespaces   []string `json:"namespaces,omitempty"`   // namespaces the workloads run in
	Deployments  int      `json:"deployments,omitempty"`  // number of Deployments
	StatefulSets int      `json:"statefulSets,omitempty"` // number of StatefulSets
	DaemonSets   int      `json:"daemonSets,omitempty"`   // number of DaemonSets
	Jobs         int      `json:"jobs,omitempty"`         // number of Flux-managed Jobs
	CronJobs     int      `json:"cronJobs,omitempty"`     // number of Flux-managed CronJobs
	Ready        int      `json:"ready"`                  // sum of ready replicas across replica-backed kinds
	Desired      int      `json:"desired"`                // sum of desired replicas across replica-backed kinds
	Status       string   `json:"status,omitempty"`       // rollout health: healthy | progressing | degraded
	Reason       string   `json:"reason,omitempty"`       // pod container reason explaining a non-healthy status (e.g. CrashLoopBackOff, ImagePullBackOff)
}

// Rollout health states for Workload.Status, ordered by severity.
const (
	WorkloadHealthy     = "healthy"
	WorkloadProgressing = "progressing"
	WorkloadDegraded    = "degraded"
)

// FluxTarget is a cluster-agnostic description of a live Flux GitRepository (and
// its owning Kustomization and workloads) that a repository may bind to. It is
// built by the handler layer from live cluster state and passed to
// EnrichBindings so this package stays free of any Kubernetes dependency.
type FluxTarget struct {
	ProjectPath     string    // normalized group/repo, host-stripped (e.g. services/flexdeck)
	SourceName      string    // GitRepository name
	SourceNamespace string    // GitRepository namespace (e.g. flux-system)
	Kustomization   string    // owning Kustomization name, if resolved
	TargetNamespace string    // Kustomization spec.targetNamespace, if set
	Workload        *Workload // live Deployment health across the source's kustomizations
}

// EnrichBindings upgrades inferred service bindings to verified when their
// GitLab project path matches a live Flux source. The join is path-based
// (host-independent) because Flux sources use an internal git host while repo
// remotes use the public one. Libraries and unmatched services are left
// unchanged, so this is safe to skip entirely when no cluster data is present.
func EnrichBindings(inv *Inventory, targetsByPath map[string]FluxTarget) {
	if inv == nil || len(targetsByPath) == 0 {
		return
	}
	for i := range inv.Repositories {
		binding := inv.Repositories[i].Binding
		if binding == nil || binding.Kind != BindingKindService || binding.GitLabProject == "" {
			continue
		}
		target, ok := targetsByPath[strings.ToLower(binding.GitLabProject)]
		if !ok {
			continue
		}
		binding.Confidence = BindingConfidenceVerified
		binding.FluxSource = target.SourceName
		binding.FluxNamespace = target.SourceNamespace
		binding.Signals = appendUnique(binding.Signals, "flux-source")
		if target.Kustomization != "" {
			binding.Kustomization = target.Kustomization
			binding.Signals = appendUnique(binding.Signals, "flux-kustomization")
		}
		if target.TargetNamespace != "" {
			binding.Namespace = target.TargetNamespace
		}
		if target.Workload != nil {
			binding.Workload = target.Workload
			// The namespace the Deployments actually run in is the most
			// authoritative signal — override the inferred/targetNamespace guess
			// when it is unambiguous.
			if len(target.Workload.Namespaces) == 1 {
				binding.Namespace = target.Workload.Namespaces[0]
			}
			binding.Signals = appendUnique(binding.Signals, "k8s-workload")
		}
	}
}

// ProjectPathFromURL extracts the normalized group/repo path from a git URL,
// stripping host, credentials, and the .git suffix. This is the host-independent
// key used to join repositories to live Flux GitRepository sources.
func ProjectPathFromURL(raw string) string {
	_, projectPath := parseRemoteIdentity(raw)
	return projectPath
}

// deriveBinding infers a repository's cluster relationship from already-known
// inventory fields. It is pure and side-effect free.
func deriveBinding(repo Repository) *RepoBinding {
	switch repo.Bucket {
	case BucketLibs:
		binding := &RepoBinding{
			Kind:       BindingKindLibrary,
			Confidence: BindingConfidenceNone,
			Signals:    []string{"bucket"},
		}
		if project := gitlabProjectFor(repo); project != "" {
			binding.GitLabProject = project
		}
		return binding

	case BucketServices:
		name := sanitizeLabel(repo.Name)
		if name == "" {
			return &RepoBinding{Kind: BindingKindUnknown, Confidence: BindingConfidenceNone}
		}

		binding := &RepoBinding{
			Kind:          BindingKindService,
			Confidence:    BindingConfidenceInferred,
			Namespace:     name,
			FluxSource:    name,
			Kustomization: name,
			Signals:       []string{"repo-name"},
		}

		host, projectPath := remoteIdentity(repo)
		if projectPath != "" {
			binding.GitLabProject = projectPath
			binding.Signals = append(binding.Signals, "gitlab-path")
		} else {
			binding.GitLabProject = repo.Bucket + "/" + repo.Name
		}
		if host != "" && projectPath != "" {
			binding.MatchKey = strings.ToLower(host + "/" + projectPath)
			binding.Signals = append(binding.Signals, "remote-url")
		}
		return binding

	default:
		return &RepoBinding{Kind: BindingKindUnknown, Confidence: BindingConfidenceNone}
	}
}

// gitlabProjectFor returns the group/repo project path for a repo, preferring a
// parsed remote and falling back to the bucket/name convention.
func gitlabProjectFor(repo Repository) string {
	if _, projectPath := remoteIdentity(repo); projectPath != "" {
		return projectPath
	}
	if repo.Name != "" {
		return repo.Bucket + "/" + repo.Name
	}
	return ""
}

// remoteIdentity parses the preferred remote (origin, else first) into a host
// and group/repo project path. Either value may be empty.
func remoteIdentity(repo Repository) (host, projectPath string) {
	return parseRemoteIdentity(preferredRemote(repo.Git.Remotes))
}

func preferredRemote(remotes []GitRemote) string {
	for _, remote := range remotes {
		if remote.Name == "origin" {
			return remote.URL
		}
	}
	if len(remotes) > 0 {
		return remotes[0].URL
	}
	return ""
}

// parseRemoteIdentity extracts the host and group/repo path from a git remote.
// It handles scheme URLs (https://host/group/repo.git), scp-like remotes
// (git@host:group/repo.git), and bare host:path forms. Credentials and the
// trailing .git suffix are stripped.
func parseRemoteIdentity(raw string) (host, projectPath string) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", ""
	}

	if idx := strings.Index(raw, "://"); idx >= 0 {
		rest := raw[idx+3:]
		if at := strings.LastIndex(rest, "@"); at >= 0 {
			rest = rest[at+1:]
		}
		if slash := strings.Index(rest, "/"); slash >= 0 {
			host, projectPath = rest[:slash], rest[slash+1:]
		} else {
			host = rest
		}
	} else if at := strings.LastIndex(raw, "@"); at >= 0 {
		host, projectPath = splitHostColonPath(raw[at+1:])
	} else if strings.Contains(raw, ":") {
		host, projectPath = splitHostColonPath(raw)
	} else {
		projectPath = raw
	}

	host = strings.TrimSpace(host)
	projectPath = strings.TrimSuffix(strings.Trim(strings.TrimSpace(projectPath), "/"), ".git")
	return host, projectPath
}

func splitHostColonPath(value string) (string, string) {
	if colon := strings.Index(value, ":"); colon >= 0 {
		return value[:colon], strings.TrimPrefix(value[colon+1:], "/")
	}
	return value, ""
}

// sanitizeLabel reduces an arbitrary repo name to a DNS-1123-ish label suitable
// for use as an inferred namespace or Flux source name.
func sanitizeLabel(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var builder strings.Builder
	prevDash := false
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			builder.WriteRune(r)
			prevDash = false
		default:
			if builder.Len() > 0 && !prevDash {
				builder.WriteByte('-')
				prevDash = true
			}
		}
	}
	return strings.Trim(builder.String(), "-")
}
