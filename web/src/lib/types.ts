// Barrel for the flexdeck frontend domain types.
//
// The previous single 1039-line module was split into per-domain modules under
// ./types/. This barrel re-exports them so existing `import { ... } from
// "../lib/types"` sites keep working unchanged. Prefer importing from a
// specific ./types/<domain> module for new code.
export * from "./types/k8s";
export * from "./types/dashboard";
export * from "./types/litellm";
export * from "./types/flexinfer";
export * from "./types/modelcache";
export * from "./types/models";
export * from "./types/agents";
export * from "./types/hud";
export * from "./types/alertmanager";
export * from "./types/enterprise";
