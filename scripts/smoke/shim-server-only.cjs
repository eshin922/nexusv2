// Preload shim: intercept `server-only` requires from smoke scripts.
// The `server-only` npm package throws in Node runtime by design (its
// export map only serves a non-throwing shim in bundler contexts).
// Smoke scripts run in plain Node and need to import the same
// production modules that declare `import "server-only"`.
//
// Usage: node --require ./scripts/smoke/shim-server-only.cjs …
//
// This shim ONLY affects the current Node process; production bundles
// (Next.js webpack + turbopack) resolve `server-only` normally and
// still enforce the boundary at build time.
const Module = require("node:module");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "server-only") return require.resolve("./_server-only-noop.cjs");
  return origResolve.call(this, request, parent, ...rest);
};
