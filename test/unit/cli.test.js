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
