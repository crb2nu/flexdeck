export function __wbg_set_wasm(wasm: unknown): void;
export function surface_analyze_logs(payload: unknown): Array<{
  index: number;
  level: 'error' | 'warn' | 'info' | 'debug';
  matches_filter: boolean;
  matches_search: boolean;
}>;
export function surface_detect_log_level(line: string): 'error' | 'warn' | 'info' | 'debug';
export function surface_filter_label_selector(payload: unknown): number[];
export function surface_matches_label_selector(
  selector: Record<string, string>,
  labels: Record<string, string>,
): boolean;
export function surface_normalize_ci_job_status(
  status: string,
): 'pending' | 'running' | 'success' | 'failed' | 'manual' | 'skipped' | 'canceled';
export function surface_normalize_ci_pipeline_status(
  status: string,
): 'pending' | 'running' | 'success' | 'failed' | 'manual' | 'skipped' | 'canceled';
