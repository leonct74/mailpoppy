// This app (apps/mobile) consumes the two shared engine packages
// (@mailpoppy/core, @mailpoppy/api-client) as raw TypeScript source from
// ../../packages — one source of truth, kept in lockstep with the backend (no
// build step). Configure Metro the canonical Expo-monorepo way so resolution is
// identical in the dev server AND the production `export:embed` step the iOS
// archive / Release build runs.
//
// Why useWatchman:false — watchman on this machine is broken (it fails to load
// libsodium.23.dylib and exits), so Metro's watchman-backed file crawl silently
// returns an incomplete map: the dev server limped along but `xcodebuild
// archive` (-> expo export:embed) crawled none of ../../packages, producing
// "Unable to resolve module @mailpoppy/core". Forcing Metro's built-in Node
// filesystem crawler makes the crawl deterministic and machine-independent.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Crawl with Node instead of the (broken) watchman binary on this machine.
config.resolver.useWatchman = false;

// NOTE: the companion fix lives in app.json -> expo.experiments.onDemandFilesystem
// = false. During `expo export:embed` Expo's withMetroMultiPlatform discards
// watchFolders down to just projectRoot when the on-demand filesystem is on,
// which drops ../../packages from the file map and makes packages/core "not
// watched" in the archive build (the dev server is unaffected — it doesn't
// export). It reads that flag from the app config and overwrites any
// metro.config value, so it MUST be disabled in app.json, not here.

// Watch the whole monorepo so the shared package sources (outside the app root,
// reached via the workspace symlink under node_modules) are in the file map.
config.watchFolders = [monorepoRoot];

// Resolve from the app's node_modules and the hoisted root node_modules.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Map the two shared scope names straight to their real TypeScript entry files.
// The workspace symlink lives at <root>/node_modules/@mailpoppy/core, but Metro's
// crawler indexes the package by its REAL path (packages/core) and skips the
// symlink path, so standard node_modules resolution can't find it. Resolving to
// the real path — which IS in the crawled file map (thanks to useWatchman:false
// + the monorepo watchFolder) — works identically in the dev server and
// export:embed. Both packages export only their root (verified: no subpath
// imports), so an exact file alias is correct and sidesteps exports/type-module
// quirks.
const sharedEntries = {
  "@mailpoppy/core": path.resolve(monorepoRoot, "packages/core/src/index.ts"),
  "@mailpoppy/api-client": path.resolve(monorepoRoot, "packages/api-client/src/index.ts"),
};
const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const entry = sharedEntries[moduleName];
  if (entry) return { type: "sourceFile", filePath: entry };
  return (upstreamResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
