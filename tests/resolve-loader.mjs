// Node ESM resolve hook that lets the existing Node test runner load the
// same source graph the Vite bundler builds.
//
// Why this exists: `node --test tests/*.test.ts` runs the TypeScript sources
// directly (Node >= 22.18 strips types natively), but Node's ESM resolver is
// stricter than Vite's. Two patterns the codebase legitimately uses fail under
// Node while building fine in production:
//
//   1. extensionless relative imports  ->  `from './response-face-bus'`
//   2. tsconfig path aliases           ->  `from '@/utils/foo'`
//
// Both are used by shipped production code, so the tests that transitively
// import them could not execute at all. Their assertions existed but never
// ran, which hid real regressions instead of catching them.
//
// This hook is deliberately failure-first: it defers to Node's own resolver
// and only intervenes when that resolution *fails*. Every test that already
// passed keeps exactly the resolution behaviour it had, so this cannot
// silently change how working tests load code.
//
// Used via: node --import ./tests/register-loader.mjs --test ...

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..");

const ALIAS_ROOTS = [
  path.join(PROJECT_ROOT, "src", "renderer", "src"),
  path.join(PROJECT_ROOT, "src"),
];

// Order matters: the build resolves TypeScript first, so keep that order.
const EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

function isFile(candidate) {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function withExtensions(filePath) {
  const candidates = [];
  for (const extension of EXTENSIONS) {
    candidates.push(filePath + extension);
  }
  for (const extension of EXTENSIONS) {
    candidates.push(path.join(filePath, "index" + extension));
  }
  return candidates;
}

function resolveRelative(specifier, parentURL) {
  if (!parentURL) return null;
  let basePath;
  try {
    basePath = fileURLToPath(new URL(specifier, parentURL));
  } catch {
    return null;
  }
  for (const candidate of withExtensions(path.resolve(basePath))) {
    if (isFile(candidate)) {
      return pathToFileURL(candidate).href;
    }
  }
  return null;
}

function resolveAlias(specifier) {
  const withoutPrefix = specifier.replace(/^@\//, "");
  for (const root of ALIAS_ROOTS) {
    const basePath = path.resolve(root, withoutPrefix);
    for (const candidate of withExtensions(basePath)) {
      if (isFile(candidate)) {
        return pathToFileURL(candidate).href;
      }
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    // Only module-not-found is fixable here; anything else is a real error
    // in the imported file and must surface unchanged.
    if (!error || error.code !== "ERR_MODULE_NOT_FOUND") throw error;
  }

  const fixed =
    (specifier.startsWith("@/") || specifier === "@"
      ? resolveAlias(specifier)
      : null) ??
    (specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier.startsWith("/")
      ? resolveRelative(specifier, context.parentURL)
      : null);

  if (fixed) {
    return {
      url: fixed,
      shortCircuit: true,
      format: fixed.endsWith(".json") ? "json" : undefined,
    };
  }

  throw new Error(
    `Module not found and the test loader could not repair it: '${specifier}' ` +
      `(imported from ${context.parentURL ?? "unknown"})`,
  );
}
