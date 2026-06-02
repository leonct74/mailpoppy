#!/usr/bin/env node
/**
 * Build the provisioning sidecar into a single self-contained executable so the
 * packaged Tauri app can ship it as an `externalBin` and end users never need
 * Node installed.
 *
 * Pipeline: esbuild (bundle ESM + workspace deps → one CJS) → Node 22 SEA
 * (Single Executable Application) → codesign (macOS ad-hoc). The output is named
 * with the Rust target triple Tauri expects, e.g.
 *   src-tauri/binaries/mailpoppy-sidecar-aarch64-apple-darwin
 *
 * Run from the node-sidecar workspace:  node scripts/build-sidecar.mjs
 */
import * as esbuild from "esbuild";
import { inject } from "postject";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sidecarRoot = resolve(here, "..");
const buildDir = join(sidecarRoot, "build");
// src-tauri lives in the desktop app (one level up from node-sidecar).
const binariesDir = resolve(sidecarRoot, "..", "src-tauri", "binaries");

// Node's stable SEA fuse sentinel (see nodejs.org/api/single-executable-applications).
const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

/** Map the current host to the Rust target triple Tauri appends to externalBin. */
function targetTriple() {
  if (process.env.TAURI_TARGET_TRIPLE) return process.env.TAURI_TARGET_TRIPLE;
  const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch;
  if (process.platform === "darwin") return `${arch}-apple-darwin`;
  if (process.platform === "win32") return `${arch}-pc-windows-msvc`;
  if (process.platform === "linux") return `${arch}-unknown-linux-gnu`;
  throw new Error(`unsupported platform ${process.platform}`);
}

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: "inherit" });
}

async function main() {
  const triple = targetTriple();
  const isWin = process.platform === "win32";
  const binName = `mailpoppy-sidecar-${triple}${isWin ? ".exe" : ""}`;
  const bundlePath = join(buildDir, "sidecar.cjs");
  const blobPath = join(buildDir, "sidecar.blob");
  const seaConfigPath = join(buildDir, "sea-config.json");
  const outBin = join(binariesDir, binName);

  mkdirSync(buildDir, { recursive: true });
  mkdirSync(binariesDir, { recursive: true });

  // 1. Bundle everything (fastify, AWS SDK v3, @mailpoppy/core) into one CJS file.
  console.log("[1/5] esbuild bundle →", bundlePath);
  await esbuild.build({
    entryPoints: [join(sidecarRoot, "src", "index.ts")],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    outfile: bundlePath,
    // SEA runs the bundle as CJS; keep all third-party code inlined.
    logLevel: "warning",
  });

  // 2. Generate the SEA preparation blob from the bundle.
  console.log("[2/5] SEA blob →", blobPath);
  writeFileSync(
    seaConfigPath,
    JSON.stringify(
      { main: bundlePath, output: blobPath, disableExperimentalSEAWarning: true, useCodeCache: false },
      null,
      2,
    ),
  );
  run(process.execPath, ["--experimental-sea-config", seaConfigPath]);

  // 3. Start from the current Node binary. On macOS the system Node is often a
  //    *universal* (fat) binary; postject's SEA sentinel then appears once per
  //    slice ("Multiple occurrences of sentinel"). Thin it to the target arch.
  console.log("[3/5] stage node binary →", outBin);
  const macArch = triple.startsWith("aarch64") ? "arm64" : "x86_64";
  const isFat =
    process.platform === "darwin" &&
    execFileSync("lipo", ["-archs", process.execPath]).toString().trim().split(/\s+/).length > 1;
  if (isFat) {
    run("lipo", [process.execPath, "-thin", macArch, "-output", outBin]);
  } else {
    copyFileSync(process.execPath, outBin);
  }
  chmodSync(outBin, 0o755);

  // 4. macOS: strip the existing signature before injecting the blob.
  if (process.platform === "darwin") {
    console.log("[4/5] codesign --remove-signature");
    run("codesign", ["--remove-signature", outBin]);
  } else {
    console.log("[4/5] (no signature to strip on this platform)");
  }

  // 5. Inject the SEA blob and re-sign (ad-hoc) so macOS will run it.
  console.log("[5/5] postject inject + re-sign");
  await inject(outBin, "NODE_SEA_BLOB", readFileSync(blobPath), {
    sentinelFuse: SEA_FUSE,
    machoSegmentName: process.platform === "darwin" ? "NODE_SEA" : undefined,
  });
  if (process.platform === "darwin") {
    run("codesign", ["--sign", "-", outBin]);
  }

  console.log(`\n✅ sidecar binary ready: ${outBin}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
