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

	usedBy := map[string]map[string]bool{}
	for i := range inv.Repositories {
		repo := &inv.Repositories[i]
		if repo.Bucket != BucketServices {
			continue
		}
		manifestText := serviceManifestText(repo)
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
		for libName := range depends {
			if usedBy[libName] == nil {
				usedBy[libName] = map[string]bool{}
			}
			usedBy[libName][repo.Name] = true
		}
	}

	for i := range inv.Repositories {
		repo := &inv.Repositories[i]
		if repo.Bucket != BucketLibs {
			continue
		}
		if services := usedBy[repo.Name]; len(services) > 0 {
			repo.UsedBy = sortedKeysOfSet(services)
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

// serviceManifestText concatenates the contents of a service's dependency
// manifests so identifiers can be matched regardless of ecosystem.
func serviceManifestText(repo *Repository) string {
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
	content := readManifest(path)
	if content == "" {
		return ""
	}
	if match := goModuleRe.FindStringSubmatch(content); match != nil {
		return match[1]
	}
	return ""
}

func manifestName(path string) string {
	content := readManifest(path)
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
