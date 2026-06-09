// Bundle-composition guard + landing-page size budget.
//
// WHY: heavy vendor libs (three.js ~146 kB gz, yaml ~32 kB gz) were being
// pulled onto route bundles by ordinary static imports. We split them out with
// lazy()/dynamic import() (MRs !180, !181). A future static `import` would
// silently undo that and re-bloat the page. This guard fails CI if it does.
//
// HOW: drive Vite's programmatic build and read the authoritative Rollup chunk
// graph — `chunk.imports` (static deps) vs `chunk.dynamicImports` (lazy deps) —
// instead of grepping minified JS. We assert each heavy vendor chunk is NOT in
// the *static* import closure of the route(s) that must stay lean, and track the
// landing-page initial JS payload against a budget.
//
// Run: `npm run perf:bundle` (from web/). Emits web/perf/bundle-budget.json and
// web/perf/bundle-performance.json (GitLab metrics report). Exits non-zero on a
// regression.

import { build } from 'vite';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('../../', import.meta.url));
const distDir = resolve(webRoot, 'dist');
const perfDir = resolve(webRoot, 'perf');

// --- Budget config -----------------------------------------------------------
// Heavy vendor chunks that MUST stay out of the listed routes' static closures.
// `route` is the source module that backs a lazy route (or '*' = any chunk).
const DEFERRED_VENDORS = [
  {
    chunk: 'vendor-three',
    label: 'three.js',
    // Dashboard is the landing route (/). three.js only renders in the opt-in 3D
    // view, so it must be a dynamic import, never static on the landing chunk.
    route: 'components/Dashboard/index.tsx',
  },
  {
    chunk: 'vendor-yaml',
    label: 'yaml',
    // yaml only parses on-demand CI-config previews — must not be static anywhere.
    route: '*',
  },
];

// Landing-page (route "/") initial JS budget, gzipped. Current footprint is
// ~101 kB gz; 160 kB leaves ~60 kB headroom for legitimate growth while still
// tripping decisively if a heavy lib (e.g. three.js ~146 kB gz) lands statically.
// Adjust intentionally — a bump should be a conscious decision, not a reflex.
const LANDING_JS_GZ_BUDGET_BYTES = 160 * 1024;

const norm = (p) => (p ? p.replace(/\\/g, '/') : p);

async function run() {
  const result = await build({ root: webRoot, logLevel: 'warn' });
  const out = Array.isArray(result) ? result[0] : result;
  const chunks = out.output.filter((o) => o.type === 'chunk');
  const byFile = new Map(chunks.map((c) => [c.fileName, c]));

  const findChunkByModule = (suffix) =>
    chunks.find(
      (c) =>
        norm(c.facadeModuleId)?.endsWith(suffix) ||
        (c.moduleIds || []).some((m) => norm(m).endsWith(suffix)),
    );
  const findVendorChunk = (name) => chunks.find((c) => c.fileName.includes(`${name}-`) || c.fileName.includes(`${name}.`));

  // Transitive STATIC import closure of a chunk (follows chunk.imports only).
  const staticClosure = (startFile) => {
    const seen = new Set();
    const stack = [startFile];
    while (stack.length) {
      const f = stack.pop();
      if (!f || seen.has(f)) continue;
      seen.add(f);
      for (const imp of byFile.get(f)?.imports || []) stack.push(imp);
    }
    return seen;
  };

  const gzOf = (file) => {
    try {
      return gzipSync(readFileSync(resolve(distDir, file))).length;
    } catch {
      return 0;
    }
  };
  const sumGz = (files) => [...files].filter((f) => f.endsWith('.js')).reduce((n, f) => n + gzOf(f), 0);

  const failures = [];
  const warnings = [];
  const vendorStatus = {};

  // --- Assertion: heavy vendors stay deferred --------------------------------
  for (const v of DEFERRED_VENDORS) {
    const vendorChunk = findVendorChunk(v.chunk);
    if (!vendorChunk) {
      warnings.push(`${v.label}: no "${v.chunk}" chunk found — dependency removed or renamed; nothing to guard.`);
      vendorStatus[v.chunk] = 'absent';
      continue;
    }
    const vendorFile = vendorChunk.fileName;

    if (v.route === '*') {
      const staticImporter = chunks.find((c) => (c.imports || []).includes(vendorFile));
      if (staticImporter) {
        failures.push(
          `${v.label} (${v.chunk}) is STATICALLY imported by ${staticImporter.fileName} — it must be loaded via dynamic import(). ` +
            `Replace the static \`import\` with a lazy/dynamic import.`,
        );
        vendorStatus[v.chunk] = 'static';
      } else {
        vendorStatus[v.chunk] = 'deferred';
      }
    } else {
      const routeChunk = findChunkByModule(v.route);
      if (!routeChunk) {
        warnings.push(`${v.label}: route module "${v.route}" not found as a chunk — cannot verify.`);
        vendorStatus[v.chunk] = 'unknown';
        continue;
      }
      const closure = staticClosure(routeChunk.fileName);
      if (closure.has(vendorFile)) {
        failures.push(
          `${v.label} (${v.chunk}) is in the STATIC import closure of route "${v.route}" (${routeChunk.fileName}) — ` +
            `it must only load on demand. Convert the import to lazy()/dynamic import().`,
        );
        vendorStatus[v.chunk] = 'static-on-route';
      } else {
        vendorStatus[v.chunk] = 'deferred';
      }
    }
  }

  // --- Budget: landing-page initial JS ---------------------------------------
  const entryChunk = chunks.find((c) => c.isEntry);
  const dashboardChunk = findChunkByModule('components/Dashboard/index.tsx');
  const entryClosure = entryChunk ? staticClosure(entryChunk.fileName) : new Set();
  const landingClosure = new Set(entryClosure);
  if (dashboardChunk) for (const f of staticClosure(dashboardChunk.fileName)) landingClosure.add(f);

  const entryGz = sumGz(entryClosure);
  const landingGz = sumGz(landingClosure);

  if (landingGz > LANDING_JS_GZ_BUDGET_BYTES) {
    failures.push(
      `Landing-page initial JS is ${(landingGz / 1024).toFixed(1)} kB gz, over the ${(LANDING_JS_GZ_BUDGET_BYTES / 1024).toFixed(0)} kB budget. ` +
        `Find what grew (likely a new static import of a heavy lib) or raise the budget intentionally.`,
    );
  }

  // --- Report ----------------------------------------------------------------
  const report = {
    generatedAt: new Date().toISOString(),
    budgets: { landingJsGzBytes: LANDING_JS_GZ_BUDGET_BYTES },
    metrics: {
      entryInitialJsGzBytes: entryGz,
      landingInitialJsGzBytes: landingGz,
      totalChunks: chunks.length,
    },
    deferredVendors: vendorStatus,
    failures,
    warnings,
  };

  const performanceReport = {
    version: '1.0',
    metrics: [
      { name: 'bundle_landing_initial_js_gz', value: Math.round(landingGz / 1024), unit: 'KiB' },
      { name: 'bundle_entry_initial_js_gz', value: Math.round(entryGz / 1024), unit: 'KiB' },
      { name: 'bundle_total_chunks', value: chunks.length, unit: 'count' },
      ...DEFERRED_VENDORS.map((v) => ({
        name: `bundle_${v.chunk.replace(/-/g, '_')}_deferred`,
        value: vendorStatus[v.chunk] === 'deferred' ? 1 : 0,
        unit: 'bool',
      })),
    ],
  };

  await mkdir(perfDir, { recursive: true });
  await writeFile(resolve(perfDir, 'bundle-budget.json'), JSON.stringify(report, null, 2));
  await writeFile(resolve(perfDir, 'bundle-performance.json'), JSON.stringify(performanceReport, null, 2));

  // --- Console summary -------------------------------------------------------
  console.log('Bundle budget guard');
  console.log(`  entry initial JS:   ${(entryGz / 1024).toFixed(1)} kB gz`);
  console.log(`  landing (/) JS:     ${(landingGz / 1024).toFixed(1)} kB gz  (budget ${(LANDING_JS_GZ_BUDGET_BYTES / 1024).toFixed(0)} kB)`);
  for (const v of DEFERRED_VENDORS) {
    console.log(`  ${v.label.padEnd(10)} ${v.chunk}: ${vendorStatus[v.chunk]}`);
  }
  for (const w of warnings) console.log(`  ⚠ ${w}`);

  if (failures.length) {
    console.error('\n✖ Bundle budget FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('\n✓ Bundle budget OK — heavy vendors deferred, landing page within budget.');
}

run().catch((err) => {
  console.error('bundle-budget: build/analysis failed:', err);
  process.exit(1);
});
