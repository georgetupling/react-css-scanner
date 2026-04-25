import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { TestProjectBuilder } from "../support/TestProjectBuilder.js";

const execFileAsync = promisify(execFile);
const CLI_PATH = path.resolve("dist/cli.js");

test("CLI emits human-readable JSON without raw analysis", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./App.css";\nexport function App() { return <main className="shell">Hello</main>; }\n',
    )
    .withCssFile("src/App.css", ".shell { display: block; }\n")
    .build();

  try {
    const { stdout } = await runCli([project.rootDir, "--json"]);
    const output = JSON.parse(stdout);

    assert.equal(output.rootDir, project.rootDir);
    assert.equal(output.failed, false);
    assert.equal(output.summary.sourceFileCount, 1);
    assert.equal(output.summary.cssFileCount, 1);
    assert.equal(output.summary.classReferenceCount, 1);
    assert.equal(output.summary.classDefinitionCount, 1);
    assert.deepEqual(output.findings, []);
    assert.equal("analysis" in output, false);
  } finally {
    await project.cleanup();
  }
});

test("CLI exit code follows configured fail threshold", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      failOnSeverity: "warn",
      rules: {
        "missing-css-class": "warn",
      },
    })
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <main className="missing">Hello</main>; }\n',
    )
    .build();

  try {
    const error = await captureRejectedCliRun([project.rootDir, "--json"]);
    assert.equal(error.code, 1);

    const output = JSON.parse(error.stdout);
    assert.equal(output.failed, true);
    assert.equal(output.summary.findingsBySeverity.warn, 1);
    assert.equal(output.findings[0].severity, "warn");
  } finally {
    await project.cleanup();
  }
});

test("CLI hides debug findings unless debug output is requested", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <Unknown render={() => <div className="hidden" />} />; }\n',
    )
    .build();

  try {
    const defaultRun = await runCli([project.rootDir, "--json"]);
    const defaultOutput = JSON.parse(defaultRun.stdout);
    assert.deepEqual(defaultOutput.findings, []);
    assert.equal(defaultOutput.summary.findingCount, 0);
    assert.equal(defaultOutput.summary.findingsBySeverity.debug, 0);

    const debugRun = await runCli([project.rootDir, "--json", "--debug"]);
    const debugOutput = JSON.parse(debugRun.stdout);
    assert.equal(debugOutput.findings[0].ruleId, "unsupported-syntax-affecting-analysis");
    assert.equal(debugOutput.findings[0].severity, "debug");
    assert.equal(debugOutput.summary.findingsBySeverity.debug, 1);
  } finally {
    await project.cleanup();
  }
});

test("CLI rejects unknown options before scanning", async () => {
  const error = await captureRejectedCliRun(["--definitely-unknown", "--json"]);

  assert.equal(error.code, 2);
  assert.match(error.stderr, /Unknown option: --definitely-unknown/);
  assert.match(error.stderr, /Usage: scan-react-css/);
  assert.equal(error.stdout, "");
});

test("CLI rejects historical options that are recognized but not yet restored", async () => {
  const historicalOptions = [
    ["--output-file", "report.json"],
    ["--overwrite-output"],
    ["--print-config", "on"],
    ["--verbosity", "high"],
    ["--output-min-severity", "warn"],
  ];

  for (const args of historicalOptions) {
    const error = await captureRejectedCliRun([".", ...args, "--json"]);

    assert.equal(error.code, 2);
    assert.match(
      error.stderr,
      new RegExp(
        `${escapeRegExp(args[0])} is recognized, but is not supported in this build yet\\.`,
      ),
    );
    assert.equal(error.stdout, "");
  }
});

test("CLI --focus filters findings after full project analysis", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      rules: {
        "single-component-style-not-colocated": "off",
      },
    })
    .withSourceFile(
      "src/components/Button.tsx",
      'import "../styles/global.css";\nexport function Button() { return <button className="global utility">Button</button>; }\n',
    )
    .withSourceFile(
      "src/pages/Home.tsx",
      'export function Home() { return <main className="missing-page">Home</main>; }\n',
    )
    .withCssFile(
      "src/styles/global.css",
      ".global { display: block; }\n.utility { display: inline-flex; }\n",
    )
    .build();

  try {
    const focusedRun = await runCli([project.rootDir, "--focus", "src/components", "--json"]);
    const focusedOutput = JSON.parse(focusedRun.stdout);

    assert.equal(focusedOutput.failed, false);
    assert.equal(focusedOutput.summary.sourceFileCount, 3);
    assert.equal(focusedOutput.summary.findingCount, 0);
    assert.deepEqual(focusedOutput.findings, []);

    const pageError = await captureRejectedCliRun([
      project.rootDir,
      "--focus",
      "src/pages",
      "--json",
    ]);
    const pageOutput = JSON.parse(pageError.stdout);

    assert.equal(pageError.code, 1);
    assert.equal(pageOutput.failed, true);
    assert.equal(pageOutput.summary.sourceFileCount, 3);
    assert.equal(pageOutput.findings.length, 1);
    assert.equal(pageOutput.findings[0].data.className, "missing-page");
  } finally {
    await project.cleanup();
  }
});

test("CLI --focus accepts comma-separated and repeated focus values", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/components/Button.tsx",
      'export function Button() { return <button className="missing-button">Button</button>; }\n',
    )
    .withSourceFile(
      "src/pages/Home.tsx",
      'export function Home() { return <main className="missing-page">Home</main>; }\n',
    )
    .withSourceFile(
      "src/layout/Shell.tsx",
      'export function Shell() { return <div className="missing-shell" />; }\n',
    )
    .build();

  try {
    const error = await captureRejectedCliRun([
      project.rootDir,
      "--focus",
      "src/components,src/pages",
      "--focus",
      "src/layout",
      "--json",
    ]);
    const output = JSON.parse(error.stdout);
    const classNames = output.findings.map((finding) => finding.data.className).sort();

    assert.equal(error.code, 1);
    assert.deepEqual(classNames, ["missing-button", "missing-page", "missing-shell"]);
  } finally {
    await project.cleanup();
  }
});

test("CLI rejects --focus without a value", async () => {
  const error = await captureRejectedCliRun([".", "--focus", "--json"]);

  assert.equal(error.code, 2);
  assert.match(error.stderr, /--focus requires a path or glob value\./);
  assert.equal(error.stdout, "");
});

test("CLI rejects missing option values before scanning", async () => {
  const error = await captureRejectedCliRun(["--config", "--json"]);

  assert.equal(error.code, 2);
  assert.match(error.stderr, /--config requires a path value\./);
  assert.equal(error.stdout, "");
});

test("CLI reports file roots cleanly in JSON mode", async () => {
  const project = await new TestProjectBuilder().build();

  try {
    const error = await captureRejectedCliRun([project.filePath("src/App.tsx"), "--json"]);
    const output = JSON.parse(error.stdout);

    assert.equal(error.code, 1);
    assert.equal(error.stderr, "");
    assert.equal(output.failed, true);
    assert.equal(output.diagnostics[0].code, "discovery.root-not-directory");
    assert.match(output.diagnostics[0].message, /scan root must be a directory/);
  } finally {
    await project.cleanup();
  }
});

test("CLI reports missing roots cleanly in JSON mode", async () => {
  const project = await new TestProjectBuilder().build();

  try {
    const error = await captureRejectedCliRun([project.filePath("missing-root"), "--json"]);
    const output = JSON.parse(error.stdout);

    assert.equal(error.code, 1);
    assert.equal(error.stderr, "");
    assert.equal(output.failed, true);
    assert.equal(output.diagnostics[0].code, "discovery.root-not-found");
    assert.match(output.diagnostics[0].message, /scan root does not exist or cannot be accessed/);
  } finally {
    await project.cleanup();
  }
});

function runCli(args) {
  return execFileAsync(process.execPath, [CLI_PATH, ...args], {
    windowsHide: true,
  });
}

async function captureRejectedCliRun(args) {
  try {
    await runCli(args);
  } catch (error) {
    return error;
  }

  assert.fail("expected CLI command to fail");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
