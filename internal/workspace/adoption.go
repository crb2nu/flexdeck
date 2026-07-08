package workspace

import (
	"bufio"
	"encoding/json"
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
	goModuleRe  = regexp.MustCompile(`(?m)^\s*module\s+(\S+)`)
	goRequireRe = regexp.MustCompile(`(?m)^\s*(?:require\s+)?(\S+)\s+(v[0-9][^\s]*)`)
	// jsonNameRe matches a package.json top-level "name" (compact or pretty);
	// tomlNameRe matches a pyproject [project]/[tool.poetry] name.
	jsonNameRe     = regexp.MustCompile(`"name"\s*:\s*"([^"]+)"`)
	tomlNameRe     = regexp.MustCompile(`(?m)^\s*name\s*=\s*"([^"]+)"`)
	tomlVersionRe  = regexp.MustCompile(`(?m)^\s*version\s*=\s*"([^"]+)"`)
	versionTokenRe = regexp.MustCompile(`v?[0-9]+(?:\.[0-9]+){0,3}(?:[-+][0-9A-Za-z.-]+)?`)
)

type libraryContractSource struct {
	name           string
	currentVersion string
}

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
	identifierToContract := map[string]libraryContractSource{}
	for i := range inv.Repositories {
		repo := &inv.Repositories[i]
		if repo.Bucket != BucketLibs {
			continue
		}
		sources := repoManifestSources(repo)
		currentVersion := versionFromManifestSources(sources)
		for _, identifier := range libraryIdentifiersFromSources(repo.Name, sources) {
			if identifier != "" {
				identifierToLib[identifier] = repo.Name
				identifierToContract[identifier] = libraryContractSource{
					name:           repo.Name,
					currentVersion: currentVersion,
				}
			}
		}
	}
	if len(identifierToLib) == 0 {
		return
	}

	// Both services and libs can consume a library: libs depend on other libs
	// (lib→lib adoption), so each contributes its dependency-manifest text.
	consumerText := map[string]string{}
	consumerSources := map[string]map[string]string{}
	for i := range inv.Repositories {
		repo := &inv.Repositories[i]
		if repo.Bucket == BucketServices || repo.Bucket == BucketLibs {
			sources := repoManifestSources(repo)
			consumerSources[repo.Name] = sources
			consumerText[repo.Name] = concatManifestSources(sources)
		}
	}

	matchAdoption(inv, identifierToLib, consumerText)
	matchLibraryContracts(inv, identifierToContract, consumerSources)
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
	return libraryIdentifiersFromSources(repo.Name, repoManifestSources(repo))
}

func repoManifestSources(repo *Repository) map[string]string {
	sources := map[string]string{}
	for _, rel := range adoptionManifestFiles {
		if content := readManifest(filepath.Join(repo.Path, rel)); content != "" {
			sources[rel] = content
		}
	}
	if content := readManifest(filepath.Join(repo.Path, "web", "package.json")); content != "" {
		sources["web/package.json"] = content
	}
	return sources
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
	if name, _ := packageJSONNameVersion(content); name != "" {
		return name
	}
	if match := jsonNameRe.FindStringSubmatch(content); match != nil {
		return match[1]
	}
	if match := tomlNameRe.FindStringSubmatch(content); match != nil {
		return match[1]
	}
	return ""
}

func versionFromManifestSources(sources map[string]string) string {
	for _, file := range []string{"package.json", "pyproject.toml"} {
		if version := versionFromManifestContent(sources[file]); version != "" {
			return version
		}
	}
	return ""
}

func versionFromManifestContent(content string) string {
	if content == "" {
		return ""
	}
	if _, version := packageJSONNameVersion(content); version != "" {
		return version
	}
	if match := tomlVersionRe.FindStringSubmatch(content); match != nil {
		return match[1]
	}
	return ""
}

func packageJSONNameVersion(content string) (string, string) {
	var manifest struct {
		Name    string `json:"name"`
		Version string `json:"version"`
	}
	if err := json.Unmarshal([]byte(content), &manifest); err != nil {
		return "", ""
	}
	return manifest.Name, manifest.Version
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

func matchLibraryContracts(inv *Inventory, identifierToLib map[string]libraryContractSource, consumerSources map[string]map[string]string) {
	if inv == nil || len(identifierToLib) == 0 {
		return
	}

	for i := range inv.Repositories {
		repo := &inv.Repositories[i]
		if repo.Bucket != BucketServices && repo.Bucket != BucketLibs {
			continue
		}
		contractsByKey := map[string]LibraryContract{}
		for manifest, content := range consumerSources[repo.Name] {
			for _, contract := range contractsFromManifest(manifest, content, identifierToLib) {
				if contract.Library == repo.Name {
					continue
				}
				key := contract.Library + "\x00" + contract.Manifest
				existing, exists := contractsByKey[key]
				if !exists || contractStatusRank(contract.Status) > contractStatusRank(existing.Status) {
					contractsByKey[key] = contract
				}
			}
		}
		if len(contractsByKey) == 0 {
			continue
		}
		repo.LibraryContracts = make([]LibraryContract, 0, len(contractsByKey))
		for _, contract := range contractsByKey {
			repo.LibraryContracts = append(repo.LibraryContracts, contract)
		}
		sort.Slice(repo.LibraryContracts, func(left, right int) bool {
			if repo.LibraryContracts[left].Status != repo.LibraryContracts[right].Status {
				return contractStatusRank(repo.LibraryContracts[left].Status) > contractStatusRank(repo.LibraryContracts[right].Status)
			}
			if repo.LibraryContracts[left].Library != repo.LibraryContracts[right].Library {
				return repo.LibraryContracts[left].Library < repo.LibraryContracts[right].Library
			}
			return repo.LibraryContracts[left].Manifest < repo.LibraryContracts[right].Manifest
		})
	}
}

func contractsFromManifest(manifest, content string, identifierToLib map[string]libraryContractSource) []LibraryContract {
	switch manifest {
	case "package.json", "web/package.json":
		return contractsFromPackageJSON(manifest, content, identifierToLib)
	case "go.mod":
		return contractsFromGoMod(manifest, content, identifierToLib)
	default:
		return nil
	}
}

func contractsFromPackageJSON(manifest, content string, identifierToLib map[string]libraryContractSource) []LibraryContract {
	var pkg struct {
		Dependencies         map[string]string `json:"dependencies"`
		DevDependencies      map[string]string `json:"devDependencies"`
		PeerDependencies     map[string]string `json:"peerDependencies"`
		OptionalDependencies map[string]string `json:"optionalDependencies"`
	}
	if err := json.Unmarshal([]byte(content), &pkg); err != nil {
		return nil
	}

	var contracts []LibraryContract
	for _, deps := range []map[string]string{pkg.Dependencies, pkg.DevDependencies, pkg.PeerDependencies, pkg.OptionalDependencies} {
		for name, requirement := range deps {
			source, ok := identifierToLib[name]
			if !ok {
				continue
			}
			contracts = append(contracts, makeLibraryContract(source, manifest, requirement))
		}
	}
	return contracts
}

func contractsFromGoMod(manifest, content string, identifierToLib map[string]libraryContractSource) []LibraryContract {
	var contracts []LibraryContract
	for _, match := range goRequireRe.FindAllStringSubmatch(content, -1) {
		if len(match) < 3 {
			continue
		}
		source, ok := identifierToLib[match[1]]
		if !ok {
			continue
		}
		contracts = append(contracts, makeLibraryContract(source, manifest, match[2]))
	}
	return contracts
}

func makeLibraryContract(source libraryContractSource, manifest, requirement string) LibraryContract {
	return LibraryContract{
		Library:        source.name,
		Manifest:       manifest,
		Requirement:    strings.TrimSpace(requirement),
		CurrentVersion: source.currentVersion,
		Status:         libraryContractStatus(requirement, source.currentVersion),
	}
}

func libraryContractStatus(requirement, currentVersion string) string {
	if strings.TrimSpace(requirement) == "" || strings.TrimSpace(currentVersion) == "" {
		return "unknown"
	}
	required := normalizeVersion(requirement)
	current := normalizeVersion(currentVersion)
	if required == "" || current == "" {
		return "unknown"
	}
	if required == current {
		return "aligned"
	}
	return "drift"
}

func normalizeVersion(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	lower := strings.ToLower(value)
	for _, prefix := range []string{"workspace:", "file:", "link:", "portal:", "npm:"} {
		if strings.HasPrefix(lower, prefix) {
			return ""
		}
	}
	if strings.ContainsAny(value, " <>|") {
		if strings.Count(value, ".") < 1 {
			return ""
		}
	}
	token := versionTokenRe.FindString(value)
	token = strings.TrimPrefix(token, "v")
	return token
}

func contractStatusRank(status string) int {
	switch status {
	case "drift":
		return 3
	case "unknown":
		return 2
	case "aligned":
		return 1
	default:
		return 0
	}
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
