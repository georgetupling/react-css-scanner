import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const REPO_ROOT = process.cwd();
const FIXTURE_ROOT = path.join(REPO_ROOT, "test", "fixtures", "bundlers");

test(
  "Vite default CSS splitting matches css-class-unreachable runtime model",
  {
    skip: missingFixtureDependenciesReason("vite-default"),
  },
  async () => {
    const fixtureDir = fixturePath("vite-default");

    runFixtureBuild(fixtureDir);
    const manifest = await readViteManifest(fixtureDir);
    const entry = findManifestEntry(manifest, (item) => item.isEntry);
    const lazyEntry = findManifestEntry(manifest, (item) =>
      normalizePath(item.src ?? "").endsWith("src/lazy/LazyPanel.tsx"),
    );

    assert.ok(entry.css?.length, "expected entry CSS in Vite manifest");
    assert.ok(lazyEntry.css?.length, "expected lazy CSS in Vite manifest");
    assert.equal(
      intersects(entry.css ?? [], lazyEntry.css ?? []),
      false,
      "default Vite build should keep lazy CSS out of the initial entry CSS assets",
    );

    const findings = await scanFixture(fixtureDir);
    assert.ok(
      hasCssClassUnreachableFinding(findings, "default-lazy-only"),
      "scanner should report initial usage of CSS that Vite loads only with the lazy chunk",
    );
  },
);

test(
  "Vite cssCodeSplit false build matches css-class-unreachable runtime model",
  {
    skip: missingFixtureDependenciesReason("vite-css-code-split-false"),
  },
  async () => {
    const fixtureDir = fixturePath("vite-css-code-split-false");

    runFixtureBuild(fixtureDir);
    const manifest = await readViteManifest(fixtureDir);
    const entry = findManifestEntry(manifest, (item) => item.isEntry);
    const lazyEntry = findManifestEntry(manifest, (item) =>
      normalizePath(item.src ?? "").endsWith("src/lazy/LazyPanel.tsx"),
    );

    assert.ok(entry, "expected an HTML entry in the Vite manifest");
    assert.ok(
      Object.values(manifest).some((item) => normalizePath(item.src ?? "") === "style.css"),
      "expected single extracted CSS asset in the Vite manifest",
    );
    assert.equal(
      lazyEntry.css?.length ?? 0,
      0,
      "cssCodeSplit false should not emit a separate lazy CSS asset",
    );

    const findings = await scanFixture(fixtureDir);
    assert.equal(
      hasCssClassUnreachableFinding(findings, "false-lazy-only"),
      false,
      "scanner should not report lazy CSS as unreachable when Vite extracts all CSS initially",
    );
  },
);

function fixturePath(fixtureName) {
  return path.join(FIXTURE_ROOT, fixtureName);
}

function missingFixtureDependenciesReason(fixtureName) {
  const fixtureDir = fixturePath(fixtureName);
  const viteBinaryPath =
    process.platform === "win32"
      ? path.join(fixtureDir, "node_modules", ".bin", "vite.cmd")
      : path.join(fixtureDir, "node_modules", ".bin", "vite");
  return existsSync(viteBinaryPath)
    ? false
    : `install fixture dependencies first: npm --prefix ${path.relative(REPO_ROOT, fixtureDir)} install`;
}

function runFixtureBuild(fixtureDir) {
  const result = spawnSync(fixtureBuildCommand(), fixtureBuildArgs(), {
    cwd: fixtureDir,
    encoding: "utf8",
    shell: false,
  });
  assert.equal(
    result.status,
    0,
    `fixture build failed\nerror:\n${result.error?.message ?? ""}\nstdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`,
  );
}

async function readViteManifest(fixtureDir) {
  const manifestPath = path.join(fixtureDir, "dist", ".vite", "manifest.json");
  return JSON.parse(await readFile(manifestPath, "utf8"));
}

function findManifestEntry(manifest, predicate) {
  const match = Object.values(manifest).find(predicate);
  assert.ok(match, "expected matching Vite manifest entry");
  return match;
}

async function scanFixture(fixtureDir) {
  const outputFilePath = path.join(fixtureDir, "dist", "scan-report.json");
  const result = spawnSync(
    "node",
    [
      path.join(REPO_ROOT, "dist", "cli.js"),
      "--json",
      "--output-file",
      outputFilePath,
      "--overwrite-output",
      fixtureDir,
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      shell: false,
    },
  );
  assert.ok(
    result.status === 0 || result.status === 1,
    `scanner failed unexpectedly\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  const report = JSON.parse(await readFile(outputFilePath, "utf8"));
  return report.findings ?? [];
}

function hasCssClassUnreachableFinding(findings, className) {
  return findings.some(
    (finding) =>
      finding.ruleId === "css-class-unreachable" && finding.data?.className === className,
  );
}

function intersects(left, right) {
  const rightSet = new Set(right);
  return left.some((item) => rightSet.has(item));
}

function normalizePath(value) {
  return value.split("\\").join("/");
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function fixtureBuildCommand() {
  return process.platform === "win32" ? "cmd.exe" : npmCommand();
}

function fixtureBuildArgs() {
  return process.platform === "win32" ? ["/d", "/s", "/c", "npm.cmd run build"] : ["run", "build"];
}
