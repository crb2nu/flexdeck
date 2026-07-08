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

func TestComputeAdoptionLibToLib(t *testing.T) {
	t.Parallel()

	root := t.TempDir()

	// A shared lib consumed by BOTH a service and another lib. The service lands
	// in UsedBy; the consuming lib lands in UsedByLibs — they must not bleed into
	// each other (UsedBy stays the contract-coverage / service-adoption metric).
	writeFile(t, filepath.Join(root, "libs", "mcp-go", "go.mod"), "module gitlab.flexinfer.ai/libs/mcp-go\n")
	writeFile(t, filepath.Join(root, "services", "loom-core", "go.mod"),
		"module example.com/loom-core\n\nrequire gitlab.flexinfer.ai/libs/mcp-go v0.2.0\n")
	writeFile(t, filepath.Join(root, "libs", "fi-accel", "go.mod"),
		"module gitlab.flexinfer.ai/libs/fi-accel\n\nrequire gitlab.flexinfer.ai/libs/mcp-go v0.2.0\n")

	inv, err := Scan(context.Background(), root, ScanOptions{})
	if err != nil {
		t.Fatalf("Scan returned error: %v", err)
	}

	mcpGo := findRepo(t, inv, "libs", "mcp-go")
	if !equalStrings(mcpGo.UsedBy, []string{"loom-core"}) {
		t.Errorf("mcp-go usedBy = %#v, want [loom-core] (service adopters only)", mcpGo.UsedBy)
	}
	if !equalStrings(mcpGo.UsedByLibs, []string{"fi-accel"}) {
		t.Errorf("mcp-go usedByLibs = %#v, want [fi-accel]", mcpGo.UsedByLibs)
	}

	fiAccel := findRepo(t, inv, "libs", "fi-accel")
	if !equalStrings(fiAccel.DependsOn, []string{"mcp-go"}) {
		t.Errorf("fi-accel dependsOn = %#v, want [mcp-go]", fiAccel.DependsOn)
	}
	// fi-accel is consumed by no one — both adopter lists stay empty.
	if len(fiAccel.UsedBy) != 0 || len(fiAccel.UsedByLibs) != 0 {
		t.Errorf("fi-accel usedBy=%#v usedByLibs=%#v, want both empty", fiAccel.UsedBy, fiAccel.UsedByLibs)
	}
}

func TestComputeLibraryContractVersionDrift(t *testing.T) {
	t.Parallel()

	root := t.TempDir()

	writeFile(t, filepath.Join(root, "libs", "visual-kit", "package.json"), `{"name":"@flexinfer/visual-kit","version":"1.2.0"}`)
	writeFile(t, filepath.Join(root, "libs", "mcp-go", "go.mod"), "module gitlab.flexinfer.ai/libs/mcp-go\n")
	writeFile(t, filepath.Join(root, "services", "aligned", "package.json"),
		`{"name":"aligned","dependencies":{"@flexinfer/visual-kit":"^1.2.0"}}`)
	writeFile(t, filepath.Join(root, "services", "stale", "package.json"),
		`{"name":"stale","dependencies":{"@flexinfer/visual-kit":"^1.1.0"}}`)
	writeFile(t, filepath.Join(root, "services", "go-consumer", "go.mod"),
		"module example.com/go-consumer\n\nrequire gitlab.flexinfer.ai/libs/mcp-go v0.4.0\n")

	inv, err := Scan(context.Background(), root, ScanOptions{})
	if err != nil {
		t.Fatalf("Scan returned error: %v", err)
	}

	aligned := findRepo(t, inv, "services", "aligned")
	if got := aligned.LibraryContracts; len(got) != 1 || got[0].Library != "visual-kit" || got[0].Requirement != "^1.2.0" || got[0].CurrentVersion != "1.2.0" || got[0].Status != "aligned" {
		t.Fatalf("aligned libraryContracts = %#v, want visual-kit aligned", got)
	}

	stale := findRepo(t, inv, "services", "stale")
	if got := stale.LibraryContracts; len(got) != 1 || got[0].Library != "visual-kit" || got[0].Requirement != "^1.1.0" || got[0].CurrentVersion != "1.2.0" || got[0].Status != "drift" {
		t.Fatalf("stale libraryContracts = %#v, want visual-kit drift", got)
	}

	goConsumer := findRepo(t, inv, "services", "go-consumer")
	if got := goConsumer.LibraryContracts; len(got) != 1 || got[0].Library != "mcp-go" || got[0].Requirement != "v0.4.0" || got[0].CurrentVersion != "" || got[0].Status != "unknown" {
		t.Fatalf("go-consumer libraryContracts = %#v, want mcp-go unknown", got)
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
