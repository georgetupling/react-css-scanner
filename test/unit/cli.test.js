import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { TestProjectBuilder } from "../support/TestProjectBuilder.js";

const execFileAsync = promisify(execFile);
const CLI_PATH = path.resolve("dist/cli.js");

test("CLI writes JSON output to the default report file", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./App.css";\nexport function App() { return <main className="shell">Hello</main>; }\n',
    )
    .withCssFile("src/App.css", ".shell { display: block; }\n")
    .build();

  try {
    const { stdout } = await runCli(["--json"], { cwd: project.rootDir });
    const output = await readJsonFile(project.filePath("scan-react-css-output.json"));

    assert.equal(output.rootDir, project.rootDir);
    assert.equal(output.failed, false);
    assert.equal(output.summary.sourceFileCount, 1);
    assert.equal(output.summary.cssFileCount, 1);
    assert.equal(output.summary.classReferenceCount, 1);
    assert.equal(output.summary.classDefinitionCount, 1);
    assert.deepEqual(output.findings, []);
    assert.equal("analysis" in output, false);
    assert.match(stdout, /JSON report written to /);
    assert.doesNotMatch(stdout.trimStart(), /^\{/);
  } finally {
    await project.cleanup();
  }
});

test("CLI suffixes JSON output files instead of overwriting", async () => {
  const project = await new TestProjectBuilder().build();

  try {
    await writeFile(project.filePath("scan-react-css-output.json"), "existing\n", "utf8");

    const { stdout } = await runCli(["--json"], { cwd: project.rootDir });
    const originalContent = await readFile(project.filePath("scan-react-css-output.json"), "utf8");
    const output = await readJsonFile(project.filePath("scan-react-css-output-1.json"));

    assert.equal(originalContent, "existing\n");
    assert.equal(output.rootDir, project.rootDir);
    assert.match(stdout, /scan-react-css-output-1\.json/);
  } finally {
    await project.cleanup();
  }
});

test("CLI writes JSON output to a custom output file", async () => {
  const project = await new TestProjectBuilder().build();

  try {
    const outputPath = project.filePath("reports/custom-report.json");
    const { stdout } = await runCli([project.rootDir, "--json", "--output-file", outputPath]);
    const output = await readJsonFile(outputPath);

    assert.equal(output.rootDir, project.rootDir);
    assert.match(stdout, /custom-report\.json/);
  } finally {
    await project.cleanup();
  }
});

test("CLI overwrites JSON output when requested", async () => {
  const project = await new TestProjectBuilder().build();

  try {
    const outputPath = project.filePath("report.json");
    await writeFile(outputPath, "existing\n", "utf8");

    const { stdout } = await runCli([
      project.rootDir,
      "--json",
      "--output-file",
      outputPath,
      "--overwrite-output",
    ]);
    const output = await readJsonFile(outputPath);

    assert.equal(output.rootDir, project.rootDir);
    assert.match(stdout, /report\.json/);
  } finally {
    await project.cleanup();
  }
});

test("CLI reports JSON output write failures clearly", async () => {
  const project = await new TestProjectBuilder().build();

  try {
    const error = await captureRejectedCliRun([
      project.rootDir,
      "--json",
      "--output-file",
      project.rootDir,
      "--overwrite-output",
    ]);

    assert.equal(error.code, 1);
    assert.equal(error.stdout, "");
    assert.match(error.stderr, /Failed to write JSON report to /);
  } finally {
    await project.cleanup();
  }
});

test("CLI discovers scan-react-css config from the command directory", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      rules: {
        "missing-css-class": "off",
      },
    })
    .withSourceFile(
      "app/src/App.tsx",
      'export function App() { return <main className="missing">Hello</main>; }\n',
    )
    .build();

  try {
    const outputPath = project.filePath("report.json");
    await runCli([project.filePath("app"), "--json", "--output-file", outputPath], {
      cwd: project.rootDir,
    });
    const output = await readJsonFile(outputPath);

    assert.equal(output.config.source.kind, "project");
    assert.deepEqual(output.findings, []);
  } finally {
    await project.cleanup();
  }
});

test("CLI resolves relative --config paths from the command directory", async () => {
  const project = await new TestProjectBuilder()
    .withFile(
      "config/custom.scan-react-css.json",
      JSON.stringify({
        failOnSeverity: "error",
        rules: {
          "missing-css-class": "warn",
        },
      }),
    )
    .withSourceFile(
      "app/src/App.tsx",
      'export function App() { return <main className="missing">Hello</main>; }\n',
    )
    .build();

  try {
    const outputPath = project.filePath("report.json");
    await runCli(
      [
        project.filePath("app"),
        "--config",
        "config/custom.scan-react-css.json",
        "--json",
        "--output-file",
        outputPath,
      ],
      { cwd: project.rootDir },
    );
    const output = await readJsonFile(outputPath);

    assert.deepEqual(output.config.source, {
      kind: "explicit",
      path: "config/custom.scan-react-css.json",
    });
    assert.equal(output.findings[0].severity, "warn");
    assert.equal(output.failed, false);
  } finally {
    await project.cleanup();
  }
});

test("CLI reports unknown config keys as errors", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      externalCss: {
        providers: [],
      },
    })
    .withSourceFile("src/App.tsx", "export function App() { return null; }\n")
    .build();

  try {
    const outputPath = project.filePath("report.json");
    const error = await captureRejectedCliRun(
      [project.rootDir, "--json", "--output-file", outputPath],
      { cwd: project.rootDir },
    );
    const output = await readJsonFile(outputPath);

    assert.equal(error.code, 1);
    assert.equal(output.failed, true);
    assert.equal(output.diagnostics[0].code, "config.unknown-key");
    assert.match(output.diagnostics[0].message, /unknown config key "externalCss"/);
  } finally {
    await project.cleanup();
  }
});

test("CLI groups human-readable findings by file and prints summary last", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./App.css";\nexport function App() { return <main className="missing">Hello</main>; }\n',
    )
    .withCssFile("src/App.css", ".unused { display: block; }\n")
    .build();

  try {
    const error = await captureRejectedCliRun([project.rootDir]);
    const output = error.stdout;

    assert.equal(error.code, 1);
    assert.match(output, /scan-react-css reboot scan/);
    assert.ok(output.includes("src/App.css\n  [warn] unused-css-class at src/App.css:1"));
    assert.ok(output.includes("src/App.tsx\n  [error] missing-css-class at src/App.tsx:2"));
    assert.match(output, /src\/App\.css[\s\S]*\n\nsrc\/App\.tsx/);
    assert.ok(output.indexOf("Summary\n") > output.indexOf("src/App.tsx\n"));
    assert.ok(output.includes("Summary\n  Source files: 1"));
    assert.equal(output.includes("\u001b["), false);
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
    const outputPath = project.filePath("report.json");
    const error = await captureRejectedCliRun(
      [project.rootDir, "--json", "--output-file", outputPath],
      { cwd: project.rootDir },
    );
    assert.equal(error.code, 1);

    const output = await readJsonFile(outputPath);
    assert.equal(output.failed, true);
    assert.equal(output.summary.findingsBySeverity.warn, 1);
    assert.equal(output.findings[0].severity, "warn");
    assert.match(error.stdout, /JSON report written to /);
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
    const defaultOutputPath = project.filePath("default-report.json");
    await runCli([project.rootDir, "--json", "--output-file", defaultOutputPath]);
    const defaultOutput = await readJsonFile(defaultOutputPath);
    assert.deepEqual(defaultOutput.findings, []);
    assert.equal(defaultOutput.summary.findingCount, 0);
    assert.equal(defaultOutput.summary.findingsBySeverity.debug, 0);

    const debugOutputPath = project.filePath("debug-report.json");
    await runCli([project.rootDir, "--json", "--output-file", debugOutputPath, "--debug"]);
    const debugOutput = await readJsonFile(debugOutputPath);
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

test("CLI rejects output-file options without JSON mode", async () => {
  for (const args of [
    [".", "--output-file", "report.json"],
    [".", "--overwrite-output"],
  ]) {
    const error = await captureRejectedCliRun(args);

    assert.equal(error.code, 2);
    assert.match(error.stderr, /--output-file and --overwrite-output require --json\./);
    assert.equal(error.stdout, "");
  }
});

test("CLI rejects --output-file without a value", async () => {
  const error = await captureRejectedCliRun([".", "--json", "--output-file"]);

  assert.equal(error.code, 2);
  assert.match(error.stderr, /--output-file requires a path value\./);
  assert.equal(error.stdout, "");
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
    const focusedOutputPath = project.filePath("focused-report.json");
    await runCli(
      [project.rootDir, "--focus", "src/components", "--json", "--output-file", focusedOutputPath],
      { cwd: project.rootDir },
    );
    const focusedOutput = await readJsonFile(focusedOutputPath);

    assert.equal(focusedOutput.failed, false);
    assert.equal(focusedOutput.summary.sourceFileCount, 3);
    assert.equal(focusedOutput.summary.findingCount, 0);
    assert.deepEqual(focusedOutput.findings, []);

    const pageError = await captureRejectedCliRun(
      [
        project.rootDir,
        "--focus",
        "src/pages",
        "--json",
        "--output-file",
        project.filePath("page-report.json"),
      ],
      { cwd: project.rootDir },
    );
    const pageOutput = await readJsonFile(project.filePath("page-report.json"));

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
      "--output-file",
      project.filePath("report.json"),
    ]);
    const output = await readJsonFile(project.filePath("report.json"));
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
    const outputPath = project.filePath("report.json");
    const error = await captureRejectedCliRun([
      project.filePath("src/App.tsx"),
      "--json",
      "--output-file",
      outputPath,
    ]);
    const output = await readJsonFile(outputPath);

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
    const outputPath = project.filePath("report.json");
    const error = await captureRejectedCliRun([
      project.filePath("missing-root"),
      "--json",
      "--output-file",
      outputPath,
    ]);
    const output = await readJsonFile(outputPath);

    assert.equal(error.code, 1);
    assert.equal(error.stderr, "");
    assert.equal(output.failed, true);
    assert.equal(output.diagnostics[0].code, "discovery.root-not-found");
    assert.match(output.diagnostics[0].message, /scan root does not exist or cannot be accessed/);
  } finally {
    await project.cleanup();
  }
});

function runCli(args, options = {}) {
  return execFileAsync(process.execPath, [CLI_PATH, ...args], {
    cwd: options.cwd,
    windowsHide: true,
  });
}

async function captureRejectedCliRun(args, options = {}) {
  try {
    await runCli(args, options);
  } catch (error) {
    return error;
  }

  assert.fail("expected CLI command to fail");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
