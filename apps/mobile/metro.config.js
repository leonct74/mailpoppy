// Metro resolves the two shared packages straight from the monorepo (this app
// lives at apps/mobile, the engine packages at ../../packages). They are consumed
// as raw TypeScript source (no build step), so we (a) add their package dirs to
// watchFolders and (b) alias the scope names to those dirs. This keeps the mobile
// client's API surface in lockstep with the backend — there is exactly one source
// of truth for @mailpoppy/core + @mailpoppy/api-client.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

const sharedPackages = {
  "@mailpoppy/core": path.resolve(projectRoot, "../../packages/core"),
  "@mailpoppy/api-client": path.resolve(projectRoot, "../../packages/api-client"),
};

// Let Metro crawl the monorepo's package sources (they live outside the app root).
config.watchFolders = [...(config.watchFolders ?? []), ...Object.values(sharedPackages)];

// Resolve the @mailpoppy/* imports to those package dirs (each has a package.json
// whose "exports"/"main" points at ./src/index.ts).
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  ...sharedPackages,
};

module.exports = config;
