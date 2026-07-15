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
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sidecarRoot = resolve(here, "..");
const buildDir = join(sidecarRoot, "build");
// src-tauri lives in the desktop app (one level up from node-sidecar).
const binariesDir = resolve(sidecarRoot, "..", "src-tauri", "binaries");

// Node's stable SEA fuse sentinel (see nodejs.org/api/single-executable-applications).
const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

// Cross-target: `--win32` builds the win32-x64 sidecar FROM macOS/Linux — the SEA
// blob is platform-portable (useCodeCache:false, no snapshot), so it's injected into
// the official win-x64 node.exe of the SAME version as the node running this script.
const targetWin32 = process.argv.includes("--win32");

/** Map the current host to the Rust target triple Tauri appends to externalBin. */
function targetTriple() {
  if (targetWin32) return "x86_64-pc-windows-msvc";
  if (process.env.TAURI_TARGET_TRIPLE) return process.env.TAURI_TARGET_TRIPLE;
  const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch;
  if (process.platform === "darwin") return `${arch}-apple-darwin`;
  if (process.platform === "win32") return `${arch}-pc-windows-msvc`;
  if (process.platform === "linux") return `${arch}-unknown-linux-gnu`;
  throw new Error(`unsupported platform ${process.platform}`);
}

/**
 * Fetch (and cache) the official Windows x64 node of THIS node's exact version,
 * integrity-checked against nodejs.org's SHASUMS256.txt. Returns the node.exe path.
 */
function fetchWindowsNode() {
  const v = process.versions.node; // blob generator and SEA base MUST match versions
  const name = `node-v${v}-win-x64`;
  const cacheDir = join(buildDir, "node-cache");
  const exePath = join(cacheDir, `${name}-node.exe`);
  if (existsSync(exePath)) return exePath;
  mkdirSync(cacheDir, { recursive: true });
  const zipPath = join(cacheDir, `${name}.zip`);
  const base = `https://nodejs.org/dist/v${v}`;
  console.log(`[win32] downloading ${base}/${name}.zip`);
  run("curl", ["-fsSL", "-o", zipPath, `${base}/${name}.zip`]);
  const sums = execFileSync("curl", ["-fsSL", `${base}/SHASUMS256.txt`]).toString();
  const expected = sums.split("\n").find((l) => l.trim().endsWith(`${name}.zip`))?.split(/\s+/)[0];
  if (!expected) throw new Error(`no SHASUMS256 entry for ${name}.zip`);
  const actual = execFileSync("shasum", ["-a", "256", zipPath]).toString().split(/\s+/)[0];
  if (actual !== expected) throw new Error(`checksum mismatch for ${name}.zip: got ${actual}, expected ${expected}`);
  console.log(`[win32] sha256 verified: ${actual}`);
  run("unzip", ["-j", "-o", "-q", zipPath, `${name}/node.exe`, "-d", cacheDir]);
  copyFileSync(join(cacheDir, "node.exe"), exePath);
  return exePath;
}

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: "inherit" });
}

async function main() {
  // Regenerate the embedded backend bundle (template + Lambda zip) so the binary
  // can deploy the backend with no cdk at runtime — runs regardless of how this
  // build was invoked (the desktop calls this script directly, not via npm).
  console.log("[0/5] generate backend bundle");
  execFileSync(process.execPath, [join(sidecarRoot, "scripts", "build-backend-bundle.mjs")], { stdio: "inherit" });

  const triple = targetTriple();

  // Regenerate the AgentsPoppy extension manifest (apps/desktop/extension.json) from
  // the live permissionSet() so the container host's declared scope can't drift. The
  // manifest names the TARGET's backend binary (cross-target packages carry their own).
  console.log("[0b/5] generate extension manifest");
  execFileSync(process.execPath, ["--import", "tsx", join(sidecarRoot, "scripts", "build-manifest.ts")], {
    stdio: "inherit",
    env: { ...process.env, MAILPOPPY_BACKEND_TRIPLE: triple },
  });

  const isWin = targetWin32 || process.platform === "win32";
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
  if (targetWin32) {
    copyFileSync(fetchWindowsNode(), outBin);
  } else {
    const macArch = triple.startsWith("aarch64") ? "arm64" : "x86_64";
    const isFat =
      process.platform === "darwin" &&
      execFileSync("lipo", ["-archs", process.execPath]).toString().trim().split(/\s+/).length > 1;
    if (isFat) {
      run("lipo", [process.execPath, "-thin", macArch, "-output", outBin]);
    } else {
      copyFileSync(process.execPath, outBin);
    }
  }
  chmodSync(outBin, 0o755);

  // 4. macOS targets: strip the existing signature before injecting the blob.
  //    (PE/Windows binaries carry no Mach-O signature — nothing to strip.)
  const macTarget = !targetWin32 && process.platform === "darwin";
  if (macTarget) {
    console.log("[4/5] codesign --remove-signature");
    run("codesign", ["--remove-signature", outBin]);
  } else {
    console.log("[4/5] (no signature to strip for this target)");
  }

  // 5. Inject the SEA blob; re-sign (ad-hoc) on macOS targets so macOS will run it.
  console.log("[5/5] postject inject" + (macTarget ? " + re-sign" : ""));
  await inject(outBin, "NODE_SEA_BLOB", readFileSync(blobPath), {
    sentinelFuse: SEA_FUSE,
    machoSegmentName: macTarget ? "NODE_SEA" : undefined,
  });
  if (macTarget) {
    run("codesign", ["--sign", "-", outBin]);
  }

  console.log(`\n✅ sidecar binary ready: ${outBin}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
