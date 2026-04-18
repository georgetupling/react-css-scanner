import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { runCli } from "../support/cliTestUtils.js";

async function withTempDir(run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "scan-react-css-cli-test-"));

  try {
    await writeProjectFile(
      tempDir,
      "package.json",
      '{\n  "name": "cli-test",\n  "dependencies": {\n    "react": "^18.0.0"\n  }\n}\n',
    );
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

    assert.equal(result.code, 0);
    assert.match(result.stderr, /built-in defaults were used/i);
    assert.match(result.stdout, /Scan target:/);
    assert.match(result.stdout, /missing-css-class/);
  });
});

test("CLI fails clearly instead of reporting an empty scan when auto-discovery finds no source files", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "apps/web/package.json",
      '{\n  "name": "apps-web",\n  "dependencies": {\n    "react": "^18.0.0"\n  }\n}\n',
    );
    await writeProjectFile(tempDir, "apps/web/src/README.md", "# not a scan target");

    const result = await runCli([tempDir], tempDir);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /no project files were found to scan/i);
    assert.doesNotMatch(result.stdout, /Summary: 0 findings .* across 0 files/i);
  });
});

test("CLI treats the positional path as the project root for config discovery", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "apps/web/package.json",
      '{\n  "name": "apps-web",\n  "dependencies": {\n    "react": "^18.0.0"\n  }\n}\n',
    );
    await writeProjectFile(
      tempDir,
      "apps/web/src/App.tsx",
      'export function App() { return <div className="app-shell" />; }',
    );
    await writeProjectFile(tempDir, "apps/web/src/styles/global.css", ".app-shell {}");
    await writeProjectFile(
      tempDir,
      "apps/web/scan-react-css.json",
      `${JSON.stringify({ rootDir: ".", css: { global: ["src/styles/global.css"] } }, null, 2)}\n`,
    );

    const result = await runCli(["apps/web"], tempDir);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Config source: project-root/);
    assert.doesNotMatch(result.stdout, /missing-css-class/);
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

test("CLI resolves explicit config paths from the current working directory when focusing a subdirectory", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "apps/web/package.json",
      '{\n  "name": "apps-web",\n  "dependencies": {\n    "react": "^18.0.0"\n  }\n}\n',
    );
    await writeProjectFile(
      tempDir,
      "apps/web/src/App.tsx",
      'export function App() { return <div className="app-shell" />; }',
    );
    await writeProjectFile(tempDir, "apps/web/src/styles/global.css", ".app-shell {}");
    await writeProjectFile(
      tempDir,
      "scan-react-css.json",
      `${JSON.stringify({ rootDir: "apps/web", css: { global: ["src/styles/global.css"] } }, null, 2)}\n`,
    );

    const result = await runCli(
      ["--focus", "apps/web/src", "--config", "scan-react-css.json"],
      tempDir,
    );

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Config source: explicit-path/);
    assert.match(result.stdout, /Focus path: apps\/web\/src/i);
    assert.doesNotMatch(result.stdout, /missing-css-class/);
  });
});

test("CLI focus filters findings while retaining full-project indexing", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "apps/web/package.json",
      '{\n  "name": "apps-web",\n  "dependencies": {\n    "react": "^18.0.0"\n  }\n}\n',
    );
    await writeProjectFile(
      tempDir,
      "apps/web/src/feature/Feature.tsx",
      [
        'import "./Feature.css";',
        'export function Feature() { return <div className="feature" />; }',
      ].join("\n"),
    );
    await writeProjectFile(tempDir, "apps/web/src/feature/Feature.css", ".feature {}");
    await writeProjectFile(
      tempDir,
      "apps/web/src/other/Other.tsx",
      [
        'import "../feature/Feature.css";',
        'export function Other() { return <><div className="feature" /><div className="missingOutside" /></>; }',
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "apps/web/scan-react-css.json",
      `${JSON.stringify({ rootDir: ".", ownership: { namingConvention: "sibling" } }, null, 2)}\n`,
    );

    const result = await runCli(["apps/web", "--focus", "src/feature", "--json"], tempDir);

    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.summary.sourceFileCount, 2);
    assert.equal(payload.summary.cssFileCount, 1);
    assert.ok(
      payload.findings.some(
        (finding) =>
          finding.ruleId === "component-style-cross-component" &&
          finding.subject?.cssFilePath === "src/feature/Feature.css",
      ),
    );
    assert.ok(
      !payload.findings.some(
        (finding) =>
          finding.ruleId === "missing-css-class" && finding.subject?.className === "missingOutside",
      ),
    );
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
