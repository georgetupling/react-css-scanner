import assert from "node:assert/strict";
import test from "node:test";
import { scanProject } from "../../../dist/index.js";
import { TestProjectBuilder } from "../../support/TestProjectBuilder.js";

test("css-class-unreachable reports classes defined only in unavailable stylesheets", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <main className="ghost">Hello</main>; }\n',
    )
    .withCssFile("src/unused.css", ".ghost { color: red; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/unused.css"],
    });

    const finding = result.findings.find(
      (candidate) =>
        candidate.ruleId === "css-class-unreachable" && candidate.data?.className === "ghost",
    );

    assert.ok(finding);
    assert.equal(finding.severity, "error");
    assert.equal(finding.confidence, "high");
    assert.equal(finding.location?.filePath, "src/App.tsx");
    assert.equal(finding.subject.kind, "class-reference");
    assert.equal(
      finding.evidence.some((entry) => entry.kind === "stylesheet"),
      true,
    );
    assert.equal(finding.traces[0].category, "rule-evaluation");
    assert.equal(finding.traces[0].children[0].category, "render-expansion");
    assert.deepEqual(
      result.findings.filter((candidate) => candidate.ruleId === "missing-css-class"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("css-class-unreachable does not report reachable definitions", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./App.css";\nexport function App() { return <main className="shell">Hello</main>; }\n',
    )
    .withCssFile("src/App.css", ".shell { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "css-class-unreachable"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("css-class-unreachable does not report when one matching definition is reachable", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./App.css";\nexport function App() { return <main className="mixed">Hello</main>; }\n',
    )
    .withCssFile("src/App.css", ".mixed { display: block; }\n")
    .withCssFile("src/unused.css", ".mixed { color: red; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "css-class-unreachable"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("css-class-unreachable can be disabled from config", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      rules: {
        "css-class-unreachable": "off",
      },
    })
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <main className="ghost">Hello</main>; }\n',
    )
    .withCssFile("src/unused.css", ".ghost { color: red; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/unused.css"],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "css-class-unreachable"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});
