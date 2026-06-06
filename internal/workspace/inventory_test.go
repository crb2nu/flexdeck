package workspace

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestScanClassifiesTopLevelServicesAndLibs(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	writeFile(t, filepath.Join(root, "services", "api", "go.mod"), "module example.com/api\n")
	writeFile(t, filepath.Join(root, "services", "api", "README.md"), "# API\n")
	writeFile(t, filepath.Join(root, "services", "api", "AGENTS.md"), "# Agent notes\n")
	writeFile(t, filepath.Join(root, "services", "api", ".worktrees", "feature", "marker"), "x\n")
	writeFile(t, filepath.Join(root, "libs", "visual-kit", "package.json"), `{"name":"visual-kit"}`)
	writeFile(t, filepath.Join(root, "libs", "visual-kit", "tsconfig.json"), "{}")
	writeFile(t, filepath.Join(root, "libs", "visual-kit", "ROADMAP.md"), "# Roadmap\n")
	writeFile(t, filepath.Join(root, "libs", "scratch", "notes.txt"), "not a repo\n")
	writeFile(t, filepath.Join(root, "services", ".hidden", "go.mod"), "module hidden\n")

	inv, err := Scan(context.Background(), root, ScanOptions{})
	if err != nil {
		t.Fatalf("Scan returned error: %v", err)
	}

	if inv.Totals.Repositories != 2 || inv.Totals.Services != 1 || inv.Totals.Libs != 1 {
		t.Fatalf("unexpected totals: %#v", inv.Totals)
	}
	api := findRepo(t, inv, "services", "api")
	if api.PrimaryLanguage != "go" {
		t.Fatalf("api primary language = %q, want go", api.PrimaryLanguage)
	}
	if !api.Docs.Agents || !api.Docs.Readme {
		t.Fatalf("expected api docs markers, got %#v", api.Docs)
	}
	if api.WorktreeCount != 1 {
		t.Fatalf("api worktree count = %d, want 1", api.WorktreeCount)
	}

	visualKit := findRepo(t, inv, "libs", "visual-kit")
	if visualKit.PrimaryLanguage != "typescript" {
		t.Fatalf("visual-kit primary language = %q, want typescript", visualKit.PrimaryLanguage)
	}
	if !contains(visualKit.PackageManagers, "npm") {
		t.Fatalf("expected npm package manager, got %#v", visualKit.PackageManagers)
	}
}

func TestScanCapturesGitStatusAndSanitizesRemoteCredentials(t *testing.T) {
	t.Parallel()

	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not available")
	}

	root := t.TempDir()
	repoPath := filepath.Join(root, "services", "demo")
	writeFile(t, filepath.Join(repoPath, "package.json"), `{"name":"demo"}`)
	run(t, repoPath, "git", "init")
	run(t, repoPath, "git", "remote", "add", "origin", "https://oauth2:secret-token@gitlab.flexinfer.ai/services/demo.git")

	inv, err := Scan(context.Background(), root, ScanOptions{})
	if err != nil {
		t.Fatalf("Scan returned error: %v", err)
	}

	repo := findRepo(t, inv, "services", "demo")
	if !repo.Git.IsRepository {
		t.Fatal("expected git repository")
	}
	if repo.Git.Clean {
		t.Fatalf("expected dirty git state from untracked package.json, got %#v", repo.Git)
	}
	if len(repo.Git.Remotes) != 1 {
		t.Fatalf("expected one sanitized remote, got %#v", repo.Git.Remotes)
	}
	if strings.Contains(repo.Git.Remotes[0].URL, "secret-token") || strings.Contains(repo.Git.Remotes[0].URL, "oauth2") {
		t.Fatalf("remote URL leaked credentials: %q", repo.Git.Remotes[0].URL)
	}
	if repo.Git.Remotes[0].URL != "https://gitlab.flexinfer.ai/services/demo.git" {
		t.Fatalf("unexpected sanitized remote URL: %q", repo.Git.Remotes[0].URL)
	}
}

func TestScanReturnsErrorWhenRootIsUnavailable(t *testing.T) {
	t.Parallel()

	_, err := Scan(context.Background(), filepath.Join(t.TempDir(), "missing"), ScanOptions{})
	if err == nil {
		t.Fatal("expected error for missing workspace root")
	}
}

func findRepo(t *testing.T, inv *Inventory, bucket, name string) Repository {
	t.Helper()
	for _, repo := range inv.Repositories {
		if repo.Bucket == bucket && repo.Name == name {
			return repo
		}
	}
	t.Fatalf("missing repo %s/%s in %#v", bucket, name, inv.Repositories)
	return Repository{}
}

func writeFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("failed to create parent dir for %s: %v", path, err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("failed to write %s: %v", path, err)
	}
}

func run(t *testing.T, dir, name string, args ...string) {
	t.Helper()
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("%s %s failed: %v\n%s", name, strings.Join(args, " "), err, string(output))
	}
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
