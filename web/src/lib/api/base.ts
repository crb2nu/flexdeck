const PUBLIC_SUBPATH_HOSTS = new Set([
  "www.flexinfer.ai",
  "codyblevins.com",
  "www.codyblevins.com",
]);

export function getApiBasePath(): string {
  if (typeof window === "undefined") {
    return "/api";
  }

  const { hostname, pathname } = window.location;
  const useSubpathApi =
    PUBLIC_SUBPATH_HOSTS.has(hostname) || pathname.startsWith("/flexdeck");

  return useSubpathApi ? "/flexdeck/api" : "/api";
}
