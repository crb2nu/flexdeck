package workspace

import (
	"context"
	"path/filepath"
	"testing"
)

func TestComputeAdoptionAcrossEcosystems(t *testing.T) {
	t.Parallel()

	root := t.TempDir()

	// Go library + a service that requires it by module path.
	writeFile(t, filepath.Join(root, "libs", "mcp-go", "go.mod"), "module gitlab.flexinfer.ai/libs/mcp-go\n")
	writeFile(t, filepath.Join(root, "services", "loom-core", "go.mod"),
		"module example.com/loom-core\n\nrequire gitlab.flexinfer.ai/libs/mcp-go v0.2.0\n")

	// Node library (dir name != package name) + a service that depends on it.
	writeFile(t, filepath.Join(root, "libs", "visual-kit", "package.json"), `{"name":"@flexinfer/visual-kit","version":"1.0.0"}`)
	writeFile(t, filepath.Join(root, "services", "site", "package.json"),
		`{"name":"site","dependencies":{"@flexinfer/visual-kit":"^1.0.0"}}`)

	// A library nobody uses, and a service that depends on nothing.
	writeFile(t, filepath.Join(root, "libs", "lonely", "go.mod"), "module gitlab.flexinfer.ai/libs/lonely\n")
	writeFile(t, filepath.Join(root, "services", "standalone", "go.mod"), "module example.com/standalone\n")

	inv, err := Scan(context.Background(), root, ScanOptions{})
	if err != nil {
		t.Fatalf("Scan returned error: %v", err)
	}

	loom := findRepo(t, inv, "services", "loom-core")
	if !equalStrings(loom.DependsOn, []string{"mcp-go"}) {
		t.Errorf("loom-core dependsOn = %#v, want [mcp-go]", loom.DependsOn)
	}
	site := findRepo(t, inv, "services", "site")
	if !equalStrings(site.DependsOn, []string{"visual-kit"}) {
		t.Errorf("site dependsOn = %#v, want [visual-kit]", site.DependsOn)
	}

	mcpGo := findRepo(t, inv, "libs", "mcp-go")
	if !equalStrings(mcpGo.UsedBy, []string{"loom-core"}) {
		t.Errorf("mcp-go usedBy = %#v, want [loom-core]", mcpGo.UsedBy)
	}
	visualKit := findRepo(t, inv, "libs", "visual-kit")
	if !equalStrings(visualKit.UsedBy, []string{"site"}) {
		t.Errorf("visual-kit usedBy = %#v, want [site]", visualKit.UsedBy)
	}

	if lonely := findRepo(t, inv, "libs", "lonely"); len(lonely.UsedBy) != 0 {
		t.Errorf("lonely usedBy = %#v, want empty", lonely.UsedBy)
	}
	if standalone := findRepo(t, inv, "services", "standalone"); len(standalone.DependsOn) != 0 {
		t.Errorf("standalone dependsOn = %#v, want empty", standalone.DependsOn)
	}
}

func TestLibraryIdentifiersResolvesPackageNames(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	writeFile(t, filepath.Join(root, "go.mod"), "module gitlab.flexinfer.ai/libs/mcp-go\n")
	writeFile(t, filepath.Join(root, "pyproject.toml"), "[project]\nname = \"flexinfer-observability\"\n")
	writeFile(t, filepath.Join(root, "package.json"), `{"name":"@flexinfer/visual-kit"}`)

	repo := &Repository{Name: "kit", Bucket: BucketLibs, Path: root}
	ids := libraryIdentifiers(repo)

	for _, want := range []string{"libs/kit", "gitlab.flexinfer.ai/libs/mcp-go", "flexinfer-observability", "@flexinfer/visual-kit"} {
		if !contains(ids, want) {
			t.Errorf("identifiers %#v missing %q", ids, want)
		}
	}
}
