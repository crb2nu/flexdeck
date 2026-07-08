package workspace

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

// GitLabScanOptions configures a GitLab-backed inventory scan.
type GitLabScanOptions struct {
	BaseURL     string
	Token       string
	Client      *http.Client
	Buckets     []string // top-level groups to inventory, e.g. ["services","libs"]
	Concurrency int
}

type glProject struct {
	ID                int    `json:"id"`
	Path              string `json:"path"`
	PathWithNamespace string `json:"path_with_namespace"`
	DefaultBranch     string `json:"default_branch"`
	WebURL            string `json:"web_url"`
}

type glTreeEntry struct {
	Name string `json:"name"`
	Type string `json:"type"` // "blob" | "tree"
}

// ScanGitLab builds the workspace inventory from the GitLab API instead of the
// local filesystem. Unlike the filesystem scan it sees EVERY repo under the
// configured buckets (groups) with real git metadata (default branch, remote),
// independent of what is synced to disk. Per-repo manifests/docs come from the
// repository tree and the primary language from the GitLab languages API.
func ScanGitLab(ctx context.Context, opts GitLabScanOptions) (*Inventory, error) {
	base := strings.TrimRight(strings.TrimSpace(opts.BaseURL), "/")
	if base == "" {
		return nil, fmt.Errorf("gitlab url is not configured")
	}
	if strings.TrimSpace(opts.Token) == "" {
		return nil, fmt.Errorf("gitlab token is not configured")
	}
	client := opts.Client
	if client == nil {
		client = http.DefaultClient
	}
	buckets := opts.Buckets
	if len(buckets) == 0 {
		buckets = []string{BucketServices, BucketLibs}
	}
	bucketSet := make(map[string]bool, len(buckets))
	for _, b := range buckets {
		bucketSet[b] = true
	}
	concurrency := opts.Concurrency
	if concurrency <= 0 {
		concurrency = 16
	}

	gl := &gitlabAPI{base: base, token: opts.Token, client: client}

	projects, err := gl.listProjects(ctx)
	if err != nil {
		return nil, fmt.Errorf("gitlab projects: %w", err)
	}

	// Keep only top-level repos directly under a requested bucket group
	// (services/<repo>, libs/<repo>) — skip nested subgroup projects.
	type target struct {
		project glProject
		bucket  string
	}
	var targets []target
	for _, p := range projects {
		parts := strings.Split(p.PathWithNamespace, "/")
		if len(parts) != 2 || !bucketSet[parts[0]] {
			continue
		}
		targets = append(targets, target{project: p, bucket: parts[0]})
	}

	repos := make([]Repository, len(targets))
	// sources[idx] holds each repo's adoption-relevant manifest contents, fetched
	// via the raw-file API so adoption can be computed without a local checkout.
	sources := make([]map[string]string, len(targets))
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	for i := range targets {
		wg.Add(1)
		sem <- struct{}{}
		go func(idx int) {
			defer wg.Done()
			defer func() { <-sem }()
			repos[idx], sources[idx] = gl.buildRepository(ctx, targets[idx].project, targets[idx].bucket)
		}(i)
	}
	wg.Wait()

	// Key the fetched manifest sources by repo name now, while sources[] is still
	// aligned with repos[] (the slice is sorted below, breaking index alignment).
	srcByName := make(map[string]map[string]string, len(repos))
	for idx := range repos {
		srcByName[repos[idx].Name] = sources[idx]
	}

	// A scan that outlived its context produced a partial inventory: cancelled
	// tree/languages calls leave repos with scanner errors and no manifests.
	// Refuse to return it — the caller's cache layer would otherwise serve the
	// partial result for its full TTL + stale window. Failing here lets the
	// previous (complete) stale value keep serving instead.
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("scan incomplete: %w", err)
	}

	sort.Slice(repos, func(a, b int) bool {
		if repos[a].Bucket != repos[b].Bucket {
			return repos[a].Bucket < repos[b].Bucket
		}
		return repos[a].Name < repos[b].Name
	})

	inv := &Inventory{
		Root:         base,
		GeneratedAt:  time.Now().UTC(),
		Repositories: repos,
		Totals:       Totals{Repositories: len(repos), ByLanguage: map[string]int{}},
	}
	for _, r := range repos {
		switch r.Bucket {
		case BucketServices:
			inv.Totals.Services++
		case BucketLibs:
			inv.Totals.Libs++
		}
		if r.PrimaryLanguage != "" {
			inv.Totals.ByLanguage[r.PrimaryLanguage]++
		}
	}

	// Library adoption from the fetched manifests (srcByName, keyed above): the
	// shared matcher resolves identifiers from libs and scans consumer dependency
	// text — no local checkout required. A lib is both a depended-on identifier
	// and a consumer (it can depend on other libs), so it feeds both maps.
	identifierToLib := map[string]string{}
	identifierToContract := map[string]libraryContractSource{}
	consumerText := map[string]string{}
	consumerSources := map[string]map[string]string{}
	for i := range inv.Repositories {
		repo := &inv.Repositories[i]
		if repo.Bucket == BucketLibs {
			currentVersion := versionFromManifestSources(srcByName[repo.Name])
			for _, identifier := range libraryIdentifiersFromSources(repo.Name, srcByName[repo.Name]) {
				if identifier != "" {
					identifierToLib[identifier] = repo.Name
					identifierToContract[identifier] = libraryContractSource{
						name:           repo.Name,
						currentVersion: currentVersion,
					}
				}
			}
		}
		if repo.Bucket == BucketServices || repo.Bucket == BucketLibs {
			consumerSources[repo.Name] = srcByName[repo.Name]
			consumerText[repo.Name] = concatManifestSources(srcByName[repo.Name])
		}
	}
	matchAdoption(inv, identifierToLib, consumerText)
	matchLibraryContracts(inv, identifierToContract, consumerSources)

	return inv, nil
}

type gitlabAPI struct {
	base   string
	token  string
	client *http.Client
}

func (g *gitlabAPI) get(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, g.base+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("PRIVATE-TOKEN", g.token)
	resp, err := g.client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (g *gitlabAPI) listProjects(ctx context.Context) ([]glProject, error) {
	var all []glProject
	for page := 1; page <= 20; page++ {
		var batch []glProject
		// simple=true payloads still carry everything glProject needs (id,
		// paths, default_branch, web_url) at roughly half the response time.
		path := fmt.Sprintf("/api/v4/projects?simple=true&per_page=100&page=%d&order_by=path&sort=asc", page)
		if err := g.get(ctx, path, &batch); err != nil {
			return nil, err
		}
		all = append(all, batch...)
		if len(batch) < 100 {
			break
		}
	}
	return all, nil
}

// buildRepository returns the repo metadata plus its adoption-relevant manifest
// contents (go.mod / package.json / pyproject.toml / web/package.json), fetched
// via the raw-file API for the files the tree confirms exist.
func (g *gitlabAPI) buildRepository(ctx context.Context, p glProject, bucket string) (Repository, map[string]string) {
	repo := Repository{
		Name:   p.Path,
		Bucket: bucket,
		Path:   p.PathWithNamespace,
		Git: GitState{
			IsRepository: true,
			Branch:       p.DefaultBranch,
			Clean:        true, // GitLab has no working tree; nothing to be "dirty"
			Remotes:      []GitRemote{{Name: "origin", URL: p.WebURL}},
		},
		DiscoveryReasons: []string{"gitlab"},
	}

	var sources map[string]string

	// Repository root tree -> manifests + docs + package managers.
	if p.DefaultBranch != "" {
		var tree []glTreeEntry
		treePath := fmt.Sprintf(
			"/api/v4/projects/%d/repository/tree?per_page=100&ref=%s",
			p.ID, url.QueryEscape(p.DefaultBranch),
		)
		if err := g.get(ctx, treePath, &tree); err != nil {
			repo.Errors = append(repo.Errors, fmt.Sprintf("tree: %v", err))
		} else {
			names := applyTreeMetadata(&repo, tree)
			sources = g.fetchAdoptionManifests(ctx, p.ID, p.DefaultBranch, names)
		}
	}

	// Languages -> authoritative primary language (overrides manifest guess).
	var langs map[string]float64
	if err := g.get(ctx, fmt.Sprintf("/api/v4/projects/%d/languages", p.ID), &langs); err != nil {
		repo.Errors = append(repo.Errors, fmt.Sprintf("languages: %v", err))
	} else if len(langs) > 0 {
		repo.PrimaryLanguage = strings.ToLower(topLanguage(langs))
	}

	repo.Binding = deriveBinding(repo)

	return repo, sources
}

// adoptionManifestFiles are the dependency manifests scanned for library
// adoption. web/package.json is fetched only when a web/ tree entry is present.
var adoptionManifestFiles = []string{"go.mod", "package.json", "pyproject.toml"}

// fetchAdoptionManifests pulls the raw contents of the adoption manifests that
// the tree confirms exist, so no fetch wastes a call on a missing file.
func (g *gitlabAPI) fetchAdoptionManifests(ctx context.Context, projectID int, branch string, names map[string]bool) map[string]string {
	sources := map[string]string{}
	for _, file := range adoptionManifestFiles {
		if !names[file] {
			continue
		}
		if content, err := g.getRaw(ctx, projectID, branch, file); err == nil && content != "" {
			sources[file] = content
		}
	}
	// A frontend lives under web/; its package.json carries npm lib adoption.
	if names["web"] {
		if content, err := g.getRaw(ctx, projectID, branch, "web/package.json"); err == nil && content != "" {
			sources["web/package.json"] = content
		}
	}
	return sources
}

// getRaw fetches a repository file's raw bytes (capped) via the GitLab files API.
func (g *gitlabAPI) getRaw(ctx context.Context, projectID int, branch, file string) (string, error) {
	path := fmt.Sprintf("/api/v4/projects/%d/repository/files/%s/raw?ref=%s",
		projectID, url.PathEscape(file), url.QueryEscape(branch))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, g.base+path, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("PRIVATE-TOKEN", g.token)
	resp, err := g.client.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxManifestBytes))
	if err != nil {
		return "", err
	}
	return string(body), nil
}

// concatManifestSources joins a repo's fetched manifest contents into one blob
// for substring identifier matching.
func concatManifestSources(sources map[string]string) string {
	if len(sources) == 0 {
		return ""
	}
	var builder strings.Builder
	for _, content := range sources {
		builder.WriteString(content)
		builder.WriteByte('\n')
	}
	return builder.String()
}

func applyTreeMetadata(repo *Repository, tree []glTreeEntry) map[string]bool {
	names := make(map[string]bool, len(tree))
	for _, e := range tree {
		names[e.Name] = true
	}
	for _, rule := range manifestRules {
		if !names[rule.file] {
			continue
		}
		repo.Manifests = append(repo.Manifests, Manifest{Type: rule.manifestType, Path: rule.file})
		if rule.language != "" && repo.PrimaryLanguage == "" {
			repo.PrimaryLanguage = rule.language
		}
		if rule.packageManager != "" {
			repo.PackageManagers = appendUnique(repo.PackageManagers, rule.packageManager)
		}
		repo.DiscoveryReasons = appendUnique(repo.DiscoveryReasons, rule.file)
	}
	repo.Docs = Docs{
		Agents:  names["AGENTS.md"],
		Readme:  names["README.md"] || names["README"] || names["readme.md"],
		Roadmap: names["ROADMAP.md"],
		Loom:    names[".loom"] || names["LOOM.md"] || names["loom.md"],
	}
	return names
}

func topLanguage(langs map[string]float64) string {
	keys := make([]string, 0, len(langs))
	for k := range langs {
		keys = append(keys, k)
	}
	sort.Strings(keys) // deterministic tie-break
	best := ""
	bestVal := -1.0
	for _, k := range keys {
		if langs[k] > bestVal {
			bestVal = langs[k]
			best = k
		}
	}
	return best
}

func appendUnique(s []string, v string) []string {
	for _, x := range s {
		if x == v {
			return s
		}
	}
	return append(s, v)
}
