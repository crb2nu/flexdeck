package workspace

import (
	"bufio"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// maxManifestBytes caps how much of a manifest we read when resolving library
// identifiers and adoption — dependency manifests are small; this guards
// against accidentally slurping a huge file.
const maxManifestBytes = 512 * 1024

var (
	goModuleRe = regexp.MustCompile(`(?m)^\s*module\s+(\S+)`)
	// jsonNameRe matches a package.json top-level "name" (compact or pretty);
	// tomlNameRe matches a pyproject [project]/[tool.poetry] name.
	jsonNameRe = regexp.MustCompile(`"name"\s*:\s*"([^"]+)"`)
	tomlNameRe = regexp.MustCompile(`(?m)^\s*name\s*=\s*"([^"]+)"`)
)

// computeAdoption maps which services depend on which workspace libraries by
// matching library identifiers against the text of each service's dependency
// manifests. It is best-effort: it reads only known manifest files and any
// unreadable file is skipped. Identifiers are resolved per ecosystem because a
// library's directory name rarely equals its package name (e.g. `py-observability`
// publishes `flexinfer-observability`, `visual-kit` publishes `@flexinfer/visual-kit`).
func computeAdoption(inv *Inventory) {
	if inv == nil {
		return
	}

	// identifierToLib maps every detectable identifier of a library to its
	// directory name, so a single substring scan covers all ecosystems.
	identifierToLib := map[string]string{}
	for i := range inv.Repositories {
		repo := &inv.Repositories[i]
		if repo.Bucket != BucketLibs {
			continue
		}
		for _, identifier := range libraryIdentifiers(repo) {
			if identifier != "" {
				identifierToLib[identifier] = repo.Name
			}
		}
	}
	if len(identifierToLib) == 0 {
		return
	}

	// Both services and libs can consume a library: libs depend on other libs
	// (lib→lib adoption), so each contributes its dependency-manifest text.
	consumerText := map[string]string{}
	for i := range inv.Repositories {
		repo := &inv.Repositories[i]
		if repo.Bucket == BucketServices || repo.Bucket == BucketLibs {
			consumerText[repo.Name] = consumerManifestText(repo)
		}
	}

	matchAdoption(inv, identifierToLib, consumerText)
}

// matchAdoption populates DependsOn/UsedBy/UsedByLibs from resolved library
// identifiers and per-consumer dependency-manifest text. It is pure (no
// file/network IO) so the filesystem and GitLab-API scanners share one matching
// implementation: identifierToLib maps each library identifier (module path,
// package name, `libs/<dir>`) to the library's repo name; consumerText maps a
// consuming repo name (service or lib) to its concatenated manifest text.
//
// Both services and libs are consumers: a service depending on a lib records the
// service under the lib's UsedBy (service-only, so the contract-coverage metric
// keeps meaning "wired into a running service"), while a lib depending on another
// lib records the consumer under UsedByLibs. Either way the consumer's own
// DependsOn lists the libs it uses.
func matchAdoption(inv *Inventory, identifierToLib map[string]string, consumerText map[string]string) {
	if inv == nil || len(identifierToLib) == 0 {
		return
	}

	usedByServices := map[string]map[string]bool{}
	usedByLibs := map[string]map[string]bool{}
	for i := range inv.Repositories {
		repo := &inv.Repositories[i]
		if repo.Bucket != BucketServices && repo.Bucket != BucketLibs {
			continue
		}
		manifestText := consumerText[repo.Name]
		if manifestText == "" {
			continue
		}

		depends := map[string]bool{}
		for identifier, libName := range identifierToLib {
			if libName == repo.Name {
				continue
			}
			if strings.Contains(manifestText, identifier) {
				depends[libName] = true
			}
		}
		if len(depends) == 0 {
			continue
		}
		repo.DependsOn = sortedKeysOfSet(depends)

		consumers := usedByServices
		if repo.Bucket == BucketLibs {
			consumers = usedByLibs
		}
		for libName := range depends {
			if consumers[libName] == nil {
				consumers[libName] = map[string]bool{}
			}
			consumers[libName][repo.Name] = true
		}
	}

	for i := range inv.Repositories {
		repo := &inv.Repositories[i]
		if repo.Bucket != BucketLibs {
			continue
		}
		if services := usedByServices[repo.Name]; len(services) > 0 {
			repo.UsedBy = sortedKeysOfSet(services)
		}
		if libs := usedByLibs[repo.Name]; len(libs) > 0 {
			repo.UsedByLibs = sortedKeysOfSet(libs)
		}
	}
}

// libraryIdentifiers returns the strings that a consuming service's manifest
// would contain when it depends on this library: the relative `libs/<dir>` path
// (used by Go replace/require), the Go module path, and the Python/Node package
// names.
func libraryIdentifiers(repo *Repository) []string {
	identifiers := []string{"libs/" + repo.Name}
	if module := goModulePath(filepath.Join(repo.Path, "go.mod")); module != "" {
		identifiers = append(identifiers, module)
	}
	if name := manifestName(filepath.Join(repo.Path, "pyproject.toml")); name != "" {
		identifiers = append(identifiers, name)
	}
	if name := manifestName(filepath.Join(repo.Path, "package.json")); name != "" {
		identifiers = append(identifiers, name)
	}
	return identifiers
}

// consumerManifestText concatenates the contents of a consuming repo's dependency
// manifests (a service or a lib) so identifiers can be matched regardless of
// ecosystem.
func consumerManifestText(repo *Repository) string {
	var builder strings.Builder
	for _, rel := range []string{"go.mod", "pyproject.toml", "package.json", filepath.Join("web", "package.json")} {
		if content := readManifest(filepath.Join(repo.Path, rel)); content != "" {
			builder.WriteString(content)
			builder.WriteByte('\n')
		}
	}
	return builder.String()
}

func goModulePath(path string) string {
	return moduleFromGoMod(readManifest(path))
}

func manifestName(path string) string {
	return nameFromManifestContent(readManifest(path))
}

// moduleFromGoMod extracts the module path from go.mod content (pure, no IO).
func moduleFromGoMod(content string) string {
	if content == "" {
		return ""
	}
	if match := goModuleRe.FindStringSubmatch(content); match != nil {
		return match[1]
	}
	return ""
}

// nameFromManifestContent extracts a package name from package.json or
// pyproject.toml content (pure, no IO).
func nameFromManifestContent(content string) string {
	if content == "" {
		return ""
	}
	if match := jsonNameRe.FindStringSubmatch(content); match != nil {
		return match[1]
	}
	if match := tomlNameRe.FindStringSubmatch(content); match != nil {
		return match[1]
	}
	return ""
}

// libraryIdentifiersFromSources resolves a library's identifiers from already-
// fetched manifest contents (the GitLab-API path), mirroring libraryIdentifiers
// which reads them from disk.
func libraryIdentifiersFromSources(name string, sources map[string]string) []string {
	identifiers := []string{"libs/" + name}
	if module := moduleFromGoMod(sources["go.mod"]); module != "" {
		identifiers = append(identifiers, module)
	}
	if n := nameFromManifestContent(sources["package.json"]); n != "" {
		identifiers = append(identifiers, n)
	}
	if n := nameFromManifestContent(sources["pyproject.toml"]); n != "" {
		identifiers = append(identifiers, n)
	}
	return identifiers
}

func readManifest(path string) string {
	file, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer func() { _ = file.Close() }()

	reader := bufio.NewReader(file)
	buf := make([]byte, maxManifestBytes)
	n, _ := reader.Read(buf)
	return string(buf[:n])
}

func sortedKeysOfSet(set map[string]bool) []string {
	if len(set) == 0 {
		return nil
	}
	keys := make([]string, 0, len(set))
	for key := range set {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
