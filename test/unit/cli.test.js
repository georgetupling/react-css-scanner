import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
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
    const reportPath = await findOnlyDefaultReport(project);
    const output = await readJsonFile(reportPath);

    assert.equal(output.rootDir, project.rootDir);
    assert.equal(output.failed, false);
    assert.equal(output.summary.sourceFileCount, 1);
    assert.equal(output.summary.cssFileCount, 1);
    assert.equal(output.summary.classReferenceCount, 1);
    assert.equal(output.summary.classDefinitionCount, 1);
    assert.deepEqual(output.findings, []);
    assert.equal("analysis" in output, false);
    assert.match(stdout, /JSON report written to /);
    assert.match(
      stdout,
      /scan-react-css-reports[\\/]+report-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.json/,
    );
    assert.doesNotMatch(stdout.trimStart(), /^\{/);
  } finally {
    await project.cleanup();
  }
});

test("CLI suffixes JSON output files instead of overwriting a custom report", async () => {
  const project = await new TestProjectBuilder().build();

  try {
    const reportPath = project.filePath("scan-react-css-reports/report-existing.json");
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, "existing\n", "utf8");

    const { stdout } = await runCli(
      ["--json", "--output-file", "scan-react-css-reports/report-existing.json"],
      { cwd: project.rootDir },
    );
    const originalContent = await readFile(reportPath, "utf8");
    const output = await readJsonFile(
      project.filePath("scan-react-css-reports/report-existing-1.json"),
    );

    assert.equal(originalContent, "existing\n");
    assert.equal(output.rootDir, project.rootDir);
    assert.match(stdout, /report-existing-1\.json/);
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

test("CLI includes performance timings when requested in JSON output", async () => {
  const project = await new TestProjectBuilder().build();

  try {
    const outputPath = project.filePath("report.json");
    await runCli([project.rootDir, "--json", "--timings", "--output-file", outputPath]);
    const output = await readJsonFile(outputPath);

    assert.equal(typeof output.performance.totalMs, "number");
    assert.ok(output.performance.totalMs >= 0);
    assert.ok(
      output.performance.stages.some(
        (stage) => stage.stage === "reachability" && typeof stage.durationMs === "number",
      ),
    );
  } finally {
    await project.cleanup();
  }
});

test("CLI includes performance timings when requested in text output", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./App.css";\nexport function App() { return <main className="shell">Hello</main>; }\n',
    )
    .withCssFile("src/App.css", ".shell { display: block; }\n")
    .build();

  try {
    const { stdout } = await runCli([project.rootDir, "--timings"]);

    assert.match(stdout, /Timings\n/);
    assert.match(stdout, /reachability: \d+(?:\.\d)?ms \(Building reachability graph\)/);
    assert.match(stdout, /total: \d+(?:\.\d)?ms/);
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
    assert.equal(output.diagnostics[0].code, "config.unknown-external-css-key");
    assert.match(output.diagnostics[0].message, /unknown externalCss key "providers"/);
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

test("CLI supports low verbosity finding table output", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <main className="missing">Hello</main>; }\n',
    )
    .build();

  try {
    const error = await captureRejectedCliRun([project.rootDir, "--verbosity", "low"]);
    const output = error.stdout;

    assert.equal(error.code, 1);
    assert.match(output, /Findings\nseverity\s+rule\s+confidence\s+location\s+message/);
    assert.match(output, /error\s+missing-css-class\s+high\s+src\/App\.tsx:1/);
    assert.doesNotMatch(output, /src\/App\.tsx\n {2}\[error\] missing-css-class/);
  } finally {
    await project.cleanup();
  }
});

test("CLI supports high verbosity finding blocks", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <main className="missing">Hello</main>; }\n',
    )
    .build();

  try {
    const error = await captureRejectedCliRun([project.rootDir, "--verbosity", "high"]);
    const output = error.stdout;

    assert.equal(error.code, 1);
    assert.match(output, /Finding 1: error missing-css-class/);
    assert.match(output, /Location: src\/App\.tsx:1/);
    assert.match(output, /Confidence: high/);
    assert.match(output, /Subject: class-reference/);
    assert.match(output, /Details:\n {4}className: missing/);
    assert.match(output, /rawExpressionText: "missing"/);
  } finally {
    await project.cleanup();
  }
});

test("CLI accepts verbosity with JSON but warns that it has no effect", async () => {
  const project = await new TestProjectBuilder().build();

  try {
    const outputPath = project.filePath("report.json");
    const { stderr } = await runCli([
      project.rootDir,
      "--json",
      "--verbosity",
      "high",
      "--output-file",
      outputPath,
    ]);
    const output = await readJsonFile(outputPath);

    assert.equal(output.rootDir, project.rootDir);
    assert.match(stderr, /Warning: --verbosity has no effect with --json\./);
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

test("CLI hides debug findings in CLI output", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <Unknown render={() => <div className="hidden" />} />; }\n',
    )
    .build();

  try {
    const defaultOutputPath = project.filePath("default-report.json");
    await runCli(["--json", "--output-file", defaultOutputPath], { cwd: project.rootDir });
    const defaultOutput = await readJsonFile(defaultOutputPath);
    assert.deepEqual(defaultOutput.findings, []);
    assert.equal(defaultOutput.summary.findingCount, 0);
    assert.equal(defaultOutput.summary.findingsBySeverity.debug, 0);
  } finally {
    await project.cleanup();
  }
});

test("CLI hides dynamic class reference findings by default and can print debug output", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      "export function App(props) { return <main className={props.className}>Hello</main>; }\n",
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
    await runCli(["--json", "--output-file", debugOutputPath, "--output-min-severity", "debug"], {
      cwd: project.rootDir,
    });
    const debugOutput = await readJsonFile(debugOutputPath);

    assert.equal(debugOutput.findings.length, 1);
    assert.equal(debugOutput.findings[0].ruleId, "dynamic-class-reference");
    assert.equal(debugOutput.findings[0].severity, "debug");
    assert.equal(debugOutput.summary.findingCount, 1);
    assert.equal(debugOutput.summary.findingsBySeverity.debug, 1);

    await writeFile(
      project.filePath("scan-react-css.json"),
      `${JSON.stringify({ rules: { "dynamic-class-reference": "info" } }, null, 2)}\n`,
      "utf8",
    );

    const overrideOutputPath = project.filePath("override-report.json");
    await runCli(["--json", "--output-file", overrideOutputPath], { cwd: project.rootDir });
    const overrideOutput = await readJsonFile(overrideOutputPath);

    assert.equal(overrideOutput.findings.length, 1);
    assert.equal(overrideOutput.findings[0].ruleId, "dynamic-class-reference");
    assert.equal(overrideOutput.findings[0].severity, "info");
    assert.equal(overrideOutput.summary.findingCount, 1);
    assert.equal(overrideOutput.summary.findingsBySeverity.info, 1);
  } finally {
    await project.cleanup();
  }
});

test("CLI output-min-severity filters text output without changing failure status", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      failOnSeverity: "warn",
      rules: {
        "missing-css-class": "warn",
        "dynamic-class-reference": "info",
      },
    })
    .withSourceFile(
      "src/App.tsx",
      'export function App(props) { return <main className={props.className}><span className="missing" /></main>; }\n',
    )
    .build();

  try {
    const error = await captureRejectedCliRun(["--output-min-severity", "error"], {
      cwd: project.rootDir,
    });

    assert.equal(error.code, 1);
    assert.match(error.stdout, /Findings\n {2}No findings\./);
    assert.match(error.stdout, /Findings: 0/);
    assert.match(error.stdout, /Failed: yes/);
  } finally {
    await project.cleanup();
  }
});

test("CLI rejects removed debug and trace flags", async () => {
  for (const flag of ["--debug", "--trace"]) {
    const error = await captureRejectedCliRun([".", flag]);

    assert.equal(error.code, 2);
    assert.match(error.stderr, new RegExp(`Unknown option: ${flag}`));
    assert.equal(error.stdout, "");
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
  const historicalOptions = [["--print-config", "on"]];

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

test("CLI rejects invalid verbosity values", async () => {
  const error = await captureRejectedCliRun([".", "--verbosity", "chatty"]);

  assert.equal(error.code, 2);
  assert.match(error.stderr, /--verbosity must be one of "low", "medium", or "high"\./);
  assert.equal(error.stdout, "");
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

test("CLI --focus accepts direct file paths and pasted file locations", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/components/Button.tsx",
      'export function Button() { return <button className="missing-button">Button</button>; }\n',
    )
    .withSourceFile(
      "src/components/Card.tsx",
      'export function Card() { return <article className="missing-card">Card</article>; }\n',
    )
    .build();

  try {
    const fileOutputPath = project.filePath("file-focus-report.json");
    const fileError = await captureRejectedCliRun([
      project.rootDir,
      "--focus",
      "src/components/Button.tsx",
      "--json",
      "--output-file",
      fileOutputPath,
    ]);
    const fileOutput = await readJsonFile(fileOutputPath);

    assert.equal(fileError.code, 1);
    assert.deepEqual(
      fileOutput.findings.map((finding) => finding.data.className),
      ["missing-button"],
    );

    const locationOutputPath = project.filePath("location-focus-report.json");
    const locationError = await captureRejectedCliRun([
      project.rootDir,
      "--focus",
      "src/components/Card.tsx:1:34",
      "--json",
      "--output-file",
      locationOutputPath,
    ]);
    const locationOutput = await readJsonFile(locationOutputPath);

    assert.equal(locationError.code, 1);
    assert.deepEqual(
      locationOutput.findings.map((finding) => finding.data.className),
      ["missing-card"],
    );
  } finally {
    await project.cleanup();
  }
});

test("CLI --focus uses supplied class provenance for forwarded class findings", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/pages/ArticleEdit.tsx",
      [
        'import { Checkbox } from "../ui/Checkbox";',
        'export function ArticleEdit() { return <Checkbox className="article-edit__autolink-toggle" />; }',
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/ui/Checkbox.tsx",
      [
        'import "./Checkbox.css";',
        'function joinClasses(...classes) { return classes.filter(Boolean).join(" "); }',
        'export function Checkbox({ className }) { return <label className={joinClasses("checkbox", className)} />; }',
        "",
      ].join("\n"),
    )
    .withCssFile("src/ui/Checkbox.css", ".checkbox { display: inline-flex; }\n")
    .build();

  try {
    const primitiveOutputPath = project.filePath("primitive-focus-report.json");
    await runCli(
      [
        project.rootDir,
        "--focus",
        "src/ui/Checkbox",
        "--json",
        "--output-file",
        primitiveOutputPath,
      ],
      { cwd: project.rootDir },
    );
    const primitiveOutput = await readJsonFile(primitiveOutputPath);

    assert.equal(primitiveOutput.failed, false);
    assert.deepEqual(primitiveOutput.findings, []);

    const pageOutputPath = project.filePath("page-focus-report.json");
    const pageError = await captureRejectedCliRun(
      [
        project.rootDir,
        "--focus",
        "src/pages/ArticleEdit.tsx",
        "--json",
        "--output-file",
        pageOutputPath,
      ],
      { cwd: project.rootDir },
    );
    const pageOutput = await readJsonFile(pageOutputPath);

    assert.equal(pageError.code, 1);
    assert.equal(pageOutput.findings.length, 1);
    assert.equal(pageOutput.findings[0].data.className, "article-edit__autolink-toggle");
    assert.deepEqual(pageOutput.findings[0].data.focusFilePaths, ["src/pages/ArticleEdit.tsx"]);
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

async function findOnlyDefaultReport(project) {
  const reportDirectory = project.filePath("scan-react-css-reports");
  const reportFiles = (await readdir(reportDirectory)).filter((entry) =>
    /^report-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.json$/.test(entry),
  );

  assert.deepEqual(reportFiles.length, 1);
  return path.join(reportDirectory, reportFiles[0]);
}
