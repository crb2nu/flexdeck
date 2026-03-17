/* tslint:disable */
/* eslint-disable */

/**
 * WASM-friendly log reader
 */
export class WasmLogReader {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Get all lines
     */
    all_lines(): string[];
    /**
     * Append new content and return new lines as JSON array
     */
    append(content: string): string[];
    /**
     * Get lines around a specific line number
     */
    context(line_num: number, before: number, after: number): string[];
    /**
     * Create an empty log reader
     */
    static empty(): WasmLogReader;
    /**
     * Filter lines by pattern (regex)
     */
    filter(pattern: string): string[];
    /**
     * Check if empty
     */
    is_empty(): boolean;
    /**
     * Get total line count
     */
    len(): number;
    /**
     * Create a new log reader from initial content
     */
    constructor(content: string);
    /**
     * Search for lines containing substring, returns JSON array of [lineNum, content]
     */
    search(substring: string): any;
    /**
     * Get the last n lines
     */
    tail(n: number): string[];
}

/**
 * Apply a fuzzy patch to a file
 */
export function apply_fuzzy_patch(patch: string, file: string, threshold: number): any;

/**
 * Report the capabilities exposed by the WASM binding.
 */
export function capabilities(): any;

/**
 * Auto-detect content type and chunk when supported by the WASM binding
 */
export function chunk_auto(content: string, file_path: string, max_tokens?: number | null): any;

/**
 * Chunk markdown content at heading boundaries
 */
export function chunk_markdown(content: string, max_tokens?: number | null): any;

/**
 * Chunk plain text by paragraphs and sentences
 */
export function chunk_text(content: string, max_tokens?: number | null): any;

/**
 * Compute cosine similarity between two vectors
 */
export function cosine_similarity(a: Float32Array, b: Float32Array): number;

/**
 * Compute cosine similarity matrix (flattened)
 * Input: two flat arrays with vectors of `dimensions` each
 * Output: flat array of size (a_count * b_count)
 */
export function cosine_similarity_matrix_flat(a: Float32Array, b: Float32Array, dimensions: number): Float32Array;

/**
 * Detect content type from file path
 */
export function detect_content_type(file_path: string): string;

/**
 * Compute dot product of two vectors
 */
export function dot_product(a: Float32Array, b: Float32Array): number;

/**
 * Extract MCP Streamable HTTP metadata from a raw header block.
 */
export function extract_mcp_http_meta(headers: Uint8Array): any;

/**
 * Extract MCP Streamable HTTP metadata from string headers.
 */
export function extract_mcp_http_meta_str(headers: string): any;

/**
 * Convert a JavaScript object to TOML string
 */
export function json_to_toml(obj: any): string;

/**
 * Convert JSON value to TOON string
 */
export function json_to_toon(obj: any): string;

/**
 * Merge two TOML strings, with overlay values taking precedence
 */
export function merge_toml(base: string, overlay: string): any;

/**
 * Normalize vectors to unit length (L2 normalization)
 */
export function normalize_l2(embeddings: Float32Array, dimensions: number): Float32Array;

/**
 * Parse JSON-RPC messages from NDJSON
 */
export function parse_jsonrpc_batch(data: Uint8Array): any;

/**
 * Parse JSON-RPC messages from string
 */
export function parse_jsonrpc_batch_str(data: string): any;

/**
 * Parse JSON-RPC messages from line-delimited framing.
 */
export function parse_jsonrpc_lines(data: Uint8Array): any;

/**
 * Parse JSON-RPC messages from string framing.
 */
export function parse_jsonrpc_lines_str(data: string): any;

/**
 * Parse newline-delimited JSON (NDJSON)
 */
export function parse_ndjson(data: Uint8Array): any;

/**
 * Parse NDJSON from string
 */
export function parse_ndjson_str(data: string): any;

/**
 * Parse SSE events from an event stream.
 */
export function parse_sse_events(data: Uint8Array): any;

/**
 * Parse SSE events from string data.
 */
export function parse_sse_events_str(data: string): any;

/**
 * Parse TOML string and return as JavaScript object
 */
export function parse_toml(toml_str: string): any;

/**
 * Parse TOON string and return as JavaScript object
 */
export function parse_toon(toon_str: string): any;

/**
 * Serialize JSON-RPC messages into line-delimited framing.
 */
export function serialize_jsonrpc_lines(messages: any): Uint8Array;

/**
 * Compute string similarity using edit distance
 */
export function string_similarity(a: string, b: string): number;

/**
 * Analyze a batch of log lines for filter and search matches.
 */
export function surface_analyze_logs(payload: any): any;

/**
 * Detect a log level using FlexDeck-inspired heuristics.
 */
export function surface_detect_log_level(line: string): string;

/**
 * Return matching indexes for a selector across many label sets.
 */
export function surface_filter_label_selector(payload: any): any;

/**
 * Check whether a label set matches a selector map.
 */
export function surface_matches_label_selector(selector: any, labels: any): boolean;

/**
 * Normalize CI job status tokens into a small stable vocabulary.
 */
export function surface_normalize_ci_job_status(status: string): string;

/**
 * Normalize CI pipeline status tokens into a small stable vocabulary.
 */
export function surface_normalize_ci_pipeline_status(status: string): string;

/**
 * Convert a JavaScript object to TOON string
 */
export function to_toon(obj: any): string;

/**
 * Validate TOML syntax without fully parsing
 */
export function validate_toml(toml_str: string): boolean;

/**
 * Validate TOON syntax without fully parsing
 */
export function validate_toon(toon_str: string): boolean;

/**
 * Get version information
 */
export function version(): string;
