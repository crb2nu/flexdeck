/* @ts-self-types="./fi_accel_wasm.d.ts" */

import initWasm from "./fi_accel_wasm_bg.wasm?init";
import * as wasmBindings from "./fi_accel_wasm_bg.js";

// Vite's `?init` loader expects the full WebAssembly import object.
// wasm-bindgen names the import module after the JS shim filename, so we
// explicitly provide that mapping for both the window bundle and the worker bundle.
const wasm = await initWasm({ "./fi_accel_wasm_bg.js": wasmBindings });
wasmBindings.__wbg_set_wasm(wasm);
wasm.__wbindgen_start();

export {
    WasmLogReader, apply_fuzzy_patch, capabilities, chunk_auto, chunk_markdown, chunk_text, cosine_similarity, cosine_similarity_matrix_flat, detect_content_type, dot_product, extract_mcp_http_meta, extract_mcp_http_meta_str, json_to_toml, json_to_toon, merge_toml, normalize_l2, parse_jsonrpc_batch, parse_jsonrpc_batch_str, parse_jsonrpc_lines, parse_jsonrpc_lines_str, parse_ndjson, parse_ndjson_str, parse_sse_events, parse_sse_events_str, parse_toml, parse_toon, serialize_jsonrpc_lines, string_similarity, surface_analyze_logs, surface_detect_log_level, surface_filter_label_selector, surface_matches_label_selector, surface_normalize_ci_job_status, surface_normalize_ci_pipeline_status, to_toon, validate_toml, validate_toon, version
} from "./fi_accel_wasm_bg.js";
