import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { runCli } from "./support/cliTestUtils.js";

async function withTempDir(run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "react-css-scanner-cli-test-"));

  try {
    await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeProjectFile(rootDir, relativePath, content) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

test("CLI rejects invalid json/min-severity flag combinations", async () => {
  await withTempDir(async (tempDir) => {
    const result = await runCli([tempDir, "--json", "--output-min-severity", "warning"], tempDir);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /only applies to human-readable output/i);
  });
});

test("CLI rejects --output-file without --json", async () => {
  await withTempDir(async (tempDir) => {
    const result = await runCli([tempDir, "--output-file", "report.json"], tempDir);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /requires --json/i);
  });
});

test("CLI emits default-config warning and human-readable output", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      'export function App() { return <div className="missing" />; }',
    );

    const result = await runCli([tempDir], tempDir);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /built-in defaults were used/i);
    assert.match(result.stdout, /Scan target:/);
    assert.match(result.stdout, /missing-css-class/);
  });
});

test("CLI writes JSON output to a suffixed file when overwrite is disabled", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(tempDir, "src/App.tsx", "export function App() { return null; }");
    await writeFile(path.join(tempDir, "report.json"), "existing", "utf8");

    const result = await runCli([tempDir, "--json", "--output-file", "report.json"], tempDir);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /report-1\.json/i);

    const savedJson = await readFile(path.join(tempDir, "report-1.json"), "utf8");
    const parsed = JSON.parse(savedJson);
    assert.ok(parsed.summary);
    assert.ok(Array.isArray(parsed.findings));
  });
});

test("CLI supports config summary modes for JSON output", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(tempDir, "src/App.tsx", "export function App() { return null; }");

    const offResult = await runCli([tempDir, "--json", "--config-summary", "off"], tempDir);
    const offPayload = JSON.parse(offResult.stdout);
    assert.ok(!("config" in offPayload));

    const verboseResult = await runCli([tempDir, "--json", "--config-summary", "verbose"], tempDir);
    const verbosePayload = JSON.parse(verboseResult.stdout);
    assert.equal(verbosePayload.config.rootDir, ".");
    assert.ok(verbosePayload.config.source);
  });
});

test("CLI applies output-min-severity only to human-readable output", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      [
        'import "./App.css";',
        "const isOpen = true;",
        'export function App() { return <div className={`used ${isOpen ? "open" : "used"}`} />; }',
      ].join("\n"),
    );
    await writeProjectFile(tempDir, "src/App.css", [".used {}", ".open {}"].join("\n"));

    const result = await runCli([tempDir, "--output-min-severity", "error"], tempDir);

    assert.equal(result.code, 0);
    assert.doesNotMatch(result.stdout, /dynamic-class-reference/);
  });
});
