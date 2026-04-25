import assert from "node:assert/strict";
import test from "node:test";
import { scanProject } from "../../../dist/index.js";
import { TestProjectBuilder } from "../../support/TestProjectBuilder.js";

test("unsatisfiable-selector reports supported selectors with no reachable render match", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./App.css";',
        "export function App() {",
        '  return <main className="card"><span className="title">Hello</span></main>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/App.css", ".card > .missing { color: red; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    const findings = result.findings.filter(
      (finding) => finding.ruleId === "unsatisfiable-selector",
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "warn");
    assert.equal(findings[0].confidence, "high");
    assert.equal(findings[0].subject.kind, "selector-query");
    assert.match(findings[0].message, /cannot match/);
    assert.equal(findings[0].data?.selectorText, ".card > .missing");
    assert.equal(findings[0].data?.outcome, "no-match-under-bounded-analysis");
    assert.equal(findings[0].traces[0].category, "rule-evaluation");
    assert.equal(findings[0].traces[0].children[0].category, "selector-match");
  } finally {
    await project.cleanup();
  }
});

test("unsatisfiable-selector does not report selectors with bounded render matches", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./App.css";',
        "export function App() {",
        '  return <main className="card"><span className="title">Hello</span></main>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/App.css", ".card > .title { color: green; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "unsatisfiable-selector"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("compound-selector-never-matched reports same-node class conjunctions with no render match", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./App.css";',
        "export function App() {",
        '  return <><button className="button">Save</button><span className="primary">Primary</span></>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/App.css", ".button.primary { color: red; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    const compoundFindings = result.findings.filter(
      (finding) => finding.ruleId === "compound-selector-never-matched",
    );
    assert.equal(compoundFindings.length, 1);
    assert.equal(compoundFindings[0].severity, "warn");
    assert.equal(compoundFindings[0].confidence, "high");
    assert.equal(compoundFindings[0].subject.kind, "selector-query");
    assert.deepEqual(compoundFindings[0].data?.requiredClassNames, ["button", "primary"]);
    assert.equal(compoundFindings[0].data?.selectorText, ".button.primary");
    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "unsatisfiable-selector"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("compound-selector-never-matched does not report matched same-node class conjunctions", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./App.css";',
        "export function App() {",
        '  return <button className="button primary">Save</button>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/App.css", ".button.primary { color: green; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "compound-selector-never-matched"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("unused-compound-selector-branch reports a dead branch in an otherwise useful selector list", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./App.css";',
        "export function App() {",
        '  return <main className="card"><span className="title">Hello</span></main>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/App.css", ".card > .title, .card > .missing { color: green; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    const findings = result.findings.filter(
      (finding) => finding.ruleId === "unused-compound-selector-branch",
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "warn");
    assert.equal(findings[0].confidence, "high");
    assert.equal(findings[0].subject.kind, "selector-branch");
    assert.equal(findings[0].data?.selectorText, ".card > .missing");
    assert.equal(findings[0].data?.selectorListText, ".card > .title, .card > .missing");
    assert.equal(findings[0].data?.branchIndex, 1);
    assert.equal(findings[0].data?.branchCount, 2);
    assert.equal(findings[0].traces[0].category, "rule-evaluation");
    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "unsatisfiable-selector"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("unused-compound-selector-branch does not report when all selector list branches match", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./App.css";',
        "export function App() {",
        '  return <main className="card"><span className="title">Hello</span><span className="subtitle">World</span></main>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/App.css", ".card > .title, .card > .subtitle { color: green; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "unused-compound-selector-branch"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});
