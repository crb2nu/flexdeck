package workspace

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	BucketServices = "services"
	BucketLibs     = "libs"
)

// ScanOptions controls the local workspace inventory scan.
type ScanOptions struct {
	GitTimeout time.Duration
}

// Inventory is a read-only snapshot of top-level service and library repos.
type Inventory struct {
	Root         string       `json:"root"`
	GeneratedAt  time.Time    `json:"generatedAt"`
	Totals       Totals       `json:"totals"`
	Repositories []Repository `json:"repositories"`
	Errors       []string     `json:"errors,omitempty"`
}

// Totals summarizes repository counts for quick UI cards.
type Totals struct {
	Repositories int            `json:"repositories"`
	Services     int            `json:"services"`
	Libs         int            `json:"libs"`
	ByLanguage   map[string]int `json:"byLanguage,omitempty"`
}

// Repository describes one top-level repo-like directory in the workspace.
type Repository struct {
	Name             string       `json:"name"`
	Bucket           string       `json:"bucket"`
	Path             string       `json:"path"`
	PrimaryLanguage  string       `json:"primaryLanguage,omitempty"`
	PackageManagers  []string     `json:"packageManagers,omitempty"`
	Manifests        []Manifest   `json:"manifests,omitempty"`
	Docs             Docs         `json:"docs"`
	WorktreeCount    int          `json:"worktreeCount,omitempty"`
	Git              GitState     `json:"git"`
	Binding          *RepoBinding `json:"binding,omitempty"`
	DependsOn        []string     `json:"dependsOn,omitempty"` // workspace libs this service depends on (by lib dir name)
	UsedBy           []string     `json:"usedBy,omitempty"`    // services that depend on this lib (by service name)
	DiscoveryReasons []string     `json:"discoveryReasons,omitempty"`
	Errors           []string     `json:"errors,omitempty"`
}

// Manifest records a known safe-to-read metadata file.
type Manifest struct {
	Type string `json:"type"`
	Path string `json:"path"`
}

// Docs records local documentation/context markers without reading their bodies.
type Docs struct {
	Agents  bool `json:"agents"`
	Readme  bool `json:"readme"`
	Roadmap bool `json:"roadmap"`
	Loom    bool `json:"loom"`
}

// GitState records safe git metadata for a repository.
type GitState struct {
	IsRepository bool        `json:"isRepository"`
	Branch       string      `json:"branch,omitempty"`
	Clean        bool        `json:"clean"`
	DirtyCount   int         `json:"dirtyCount,omitempty"`
	Remotes      []GitRemote `json:"remotes,omitempty"`
	Errors       []string    `json:"errors,omitempty"`
}

// GitRemote contains a credential-sanitized remote URL.
type GitRemote struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

type manifestRule struct {
	file           string
	manifestType   string
	language       string
	packageManager string
}

var manifestRules = []manifestRule{
	{file: "go.mod", manifestType: "go-mod", language: "go", packageManager: "go"},
	{file: "package.json", manifestType: "package-json", language: "javascript", packageManager: "npm"},
	{file: "pyproject.toml", manifestType: "pyproject", language: "python", packageManager: "python"},
	{file: "Cargo.toml", manifestType: "cargo", language: "rust", packageManager: "cargo"},
	{file: "Makefile", manifestType: "makefile", packageManager: "make"},
	{file: ".gitlab-ci.yml", manifestType: "gitlab-ci"},
}

// Scan builds a read-only inventory for the services and libs buckets.
func Scan(ctx context.Context, root string, opts ScanOptions) (*Inventory, error) {
	root = filepath.Clean(strings.TrimSpace(root))
	if root == "." || root == "" {
		return nil, errors.New("workspace root is not configured")
	}
	if opts.GitTimeout <= 0 {
		opts.GitTimeout = 1500 * time.Millisecond
	}

	info, err := os.Stat(root)
	if err != nil {
		return nil, fmt.Errorf("workspace root unavailable: %w", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("workspace root is not a directory: %s", root)
	}

	inv := &Inventory{
		Root:        root,
		GeneratedAt: time.Now().UTC(),
		Totals: Totals{
			ByLanguage: map[string]int{},
		},
	}

	for _, bucket := range []string{BucketServices, BucketLibs} {
		repos, scanErrs := scanBucket(ctx, root, bucket, opts)
		inv.Repositories = append(inv.Repositories, repos...)
		inv.Errors = append(inv.Errors, scanErrs...)
	}

	sort.Slice(inv.Repositories, func(left, right int) bool {
		if inv.Repositories[left].Bucket != inv.Repositories[right].Bucket {
			return inv.Repositories[left].Bucket < inv.Repositories[right].Bucket
		}
		return inv.Repositories[left].Name < inv.Repositories[right].Name
	})
	computeAdoption(inv)
	populateTotals(inv)

	return inv, nil
}

func scanBucket(ctx context.Context, root, bucket string, opts ScanOptions) ([]Repository, []string) {
	bucketPath := filepath.Join(root, bucket)
	entries, err := os.ReadDir(bucketPath)
	if err != nil {
		return nil, []string{fmt.Sprintf("%s bucket unavailable: %v", bucket, err)}
	}

	var repos []Repository
	var errs []string
	for _, entry := range entries {
		if ctx.Err() != nil {
			errs = append(errs, ctx.Err().Error())
			break
		}
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}

		repoPath := filepath.Join(bucketPath, entry.Name())
		repo := inspectRepository(ctx, bucket, entry.Name(), repoPath, opts)
		if len(repo.DiscoveryReasons) == 0 {
			continue
		}
		repos = append(repos, repo)
	}

	return repos, errs
}

func inspectRepository(ctx context.Context, bucket, name, path string, opts ScanOptions) Repository {
	repo := Repository{
		Name:   name,
		Bucket: bucket,
		Path:   path,
		Docs: Docs{
			Agents:  exists(filepath.Join(path, "AGENTS.md")),
			Readme:  hasAny(path, "README.md", "README.markdown", "README.txt"),
			Roadmap: exists(filepath.Join(path, "ROADMAP.md")),
			Loom:    isDir(filepath.Join(path, ".loom")),
		},
	}

	seenManagers := map[string]struct{}{}
	for _, rule := range manifestRules {
		manifestPath := filepath.Join(path, rule.file)
		if !exists(manifestPath) {
			continue
		}
		repo.Manifests = append(repo.Manifests, Manifest{Type: rule.manifestType, Path: rule.file})
		repo.DiscoveryReasons = append(repo.DiscoveryReasons, rule.file)
		if repo.PrimaryLanguage == "" && rule.language != "" {
			repo.PrimaryLanguage = rule.language
		}
		if rule.packageManager != "" {
			seenManagers[rule.packageManager] = struct{}{}
		}
	}
	if repo.PrimaryLanguage == "javascript" && exists(filepath.Join(path, "tsconfig.json")) {
		repo.PrimaryLanguage = "typescript"
	}
	if exists(filepath.Join(path, "uv.lock")) {
		seenManagers["uv"] = struct{}{}
	}
	if exists(filepath.Join(path, "pnpm-lock.yaml")) {
		seenManagers["pnpm"] = struct{}{}
	}
	if exists(filepath.Join(path, "yarn.lock")) {
		seenManagers["yarn"] = struct{}{}
	}

	repo.PackageManagers = sortedKeys(seenManagers)
	repo.WorktreeCount = countChildDirs(filepath.Join(path, ".worktrees"))
	repo.Git = inspectGit(ctx, path, opts.GitTimeout)
	if repo.Git.IsRepository {
		repo.DiscoveryReasons = append(repo.DiscoveryReasons, ".git")
	}

	sort.Slice(repo.Manifests, func(left, right int) bool {
		return repo.Manifests[left].Path < repo.Manifests[right].Path
	})
	sort.Strings(repo.DiscoveryReasons)

	repo.Binding = deriveBinding(repo)

	return repo
}

func inspectGit(ctx context.Context, path string, timeout time.Duration) GitState {
	state := GitState{
		IsRepository: exists(filepath.Join(path, ".git")),
		Clean:        true,
	}
	if !state.IsRepository {
		return state
	}

	statusOut, err := runGit(ctx, timeout, path, "status", "--short", "--branch")
	if err != nil {
		state.Errors = append(state.Errors, err.Error())
		return state
	}
	state.Branch, state.DirtyCount = parseGitStatus(statusOut)
	state.Clean = state.DirtyCount == 0

	remoteOut, err := runGit(ctx, timeout, path, "remote", "-v")
	if err != nil {
		state.Errors = append(state.Errors, err.Error())
		return state
	}
	state.Remotes = parseGitRemotes(remoteOut)

	return state
}

func runGit(ctx context.Context, timeout time.Duration, repoPath string, args ...string) (string, error) {
	gitCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmdArgs := append([]string{"-C", repoPath}, args...)
	cmd := exec.CommandContext(gitCtx, "git", cmdArgs...)
	output, err := cmd.CombinedOutput()
	if gitCtx.Err() != nil {
		return "", fmt.Errorf("git %s timed out", strings.Join(args, " "))
	}
	if err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			message = err.Error()
		}
		return "", fmt.Errorf("git %s failed: %s", strings.Join(args, " "), message)
	}
	return string(output), nil
}

func parseGitStatus(output string) (string, int) {
	scanner := bufio.NewScanner(strings.NewReader(output))
	branch := ""
	dirty := 0
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "## ") {
			branch = cleanBranchLine(strings.TrimPrefix(line, "## "))
			continue
		}
		dirty++
	}
	return branch, dirty
}

func cleanBranchLine(line string) string {
	if strings.HasPrefix(line, "No commits yet on ") {
		return strings.TrimPrefix(line, "No commits yet on ")
	}
	if idx := strings.Index(line, "..."); idx >= 0 {
		return line[:idx]
	}
	if idx := strings.Index(line, " ["); idx >= 0 {
		return line[:idx]
	}
	return line
}

func parseGitRemotes(output string) []GitRemote {
	seen := map[string]GitRemote{}
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		remote := GitRemote{Name: fields[0], URL: sanitizeRemoteURL(fields[1])}
		key := remote.Name + "\x00" + remote.URL
		seen[key] = remote
	}
	remotes := make([]GitRemote, 0, len(seen))
	for _, remote := range seen {
		remotes = append(remotes, remote)
	}
	sort.Slice(remotes, func(left, right int) bool {
		if remotes[left].Name != remotes[right].Name {
			return remotes[left].Name < remotes[right].Name
		}
		return remotes[left].URL < remotes[right].URL
	})
	return remotes
}

func sanitizeRemoteURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if strings.Contains(raw, "://") {
		parsed, err := url.Parse(raw)
		if err == nil {
			parsed.User = nil
			return parsed.String()
		}
	}

	if at := strings.LastIndex(raw, "@"); at > 0 && strings.Contains(raw[:at], ":") {
		return raw[at+1:]
	}
	return raw
}

func populateTotals(inv *Inventory) {
	inv.Totals.Repositories = len(inv.Repositories)
	for _, repo := range inv.Repositories {
		switch repo.Bucket {
		case BucketServices:
			inv.Totals.Services++
		case BucketLibs:
			inv.Totals.Libs++
		}
		if repo.PrimaryLanguage != "" {
			inv.Totals.ByLanguage[repo.PrimaryLanguage]++
		}
	}
	if len(inv.Totals.ByLanguage) == 0 {
		inv.Totals.ByLanguage = nil
	}
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func isDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func hasAny(base string, names ...string) bool {
	for _, name := range names {
		if exists(filepath.Join(base, name)) {
			return true
		}
	}
	return false
}

func countChildDirs(path string) int {
	entries, err := os.ReadDir(path)
	if err != nil {
		return 0
	}
	count := 0
	for _, entry := range entries {
		if entry.IsDir() {
			count++
		}
	}
	return count
}

func sortedKeys(values map[string]struct{}) []string {
	if len(values) == 0 {
		return nil
	}
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
