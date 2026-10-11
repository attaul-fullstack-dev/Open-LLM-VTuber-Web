// Registers the test resolve hook (see resolve-loader.mjs).
//
// Usage:
//   node --import ./tests/register-loader.mjs --test tests/*.test.ts tests/*.test.mjs
//
// Kept as a separate entry point so the loader is opt-in and the plain
// `node --test` invocation keeps working exactly as before.

import { register } from "node:module";

register("./resolve-loader.mjs", import.meta.url);
