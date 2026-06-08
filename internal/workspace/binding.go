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
	Namespace     string            `json:"namespace,omitempty"`     // inferred Kubernetes namespace
	FluxSource    string            `json:"fluxSource,omitempty"`    // inferred Flux GitRepository source name
	Kustomization string            `json:"kustomization,omitempty"` // inferred Flux Kustomization name
	MatchKey      string            `json:"matchKey,omitempty"`      // normalized host/path for live cross-reference
	Signals       []string          `json:"signals,omitempty"`       // which inputs produced this binding
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
