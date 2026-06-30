import type { NextConfig } from "next";
import path from "node:path";

// This app lives in a monorepo that has a package-lock.json at the repo root AND one here in
// apps/web. With two lockfiles, Next infers the workspace root as the *monorepo root*, which makes
// the standalone output (added by the Firebase App Hosting adapter) nest under
// `.next/standalone/apps/web/…`. The adapter then looks for `.next/standalone/.next/routes-manifest.json`
// and fails with ENOENT. Pinning the file-tracing / Turbopack root to THIS directory flattens the
// standalone output to `.next/standalone/.next/…` where the adapter expects it. Harmless locally
// (local `next build` doesn't emit standalone). The build runs with cwd = apps/web.
const appRoot = path.resolve();

const nextConfig: NextConfig = {
  outputFileTracingRoot: appRoot,
  turbopack: {
    root: appRoot,
  },
};

export default nextConfig;
