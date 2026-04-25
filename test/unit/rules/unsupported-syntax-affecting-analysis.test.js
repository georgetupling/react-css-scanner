import assert from "node:assert/strict";
import test from "node:test";
import { scanProject } from "../../../dist/index.js";
import { TestProjectBuilder } from "../../support/TestProjectBuilder.js";

test("unsupported-syntax-affecting-analysis reports raw JSX className skipped by render IR", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <Unknown render={() => <div className="hidden" />} />; }\n',
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: [],
    });

    const finding = result.findings.find(
      (candidate) => candidate.ruleId === "unsupported-syntax-affecting-analysis",
    );

    assert.ok(finding);
    assert.equal(finding.severity, "debug");
    assert.equal(finding.confidence, "high");
    assert.equal(finding.location?.filePath, "src/App.tsx");
    assert.equal(finding.subject.kind, "unsupported-class-reference");
    assert.equal(finding.data?.rawExpressionText, '"hidden"');
    assert.equal(finding.data?.reason, "raw-jsx-class-not-modeled");
    assert.equal(finding.traces[0].category, "rule-evaluation");
    assert.equal(finding.traces[0].children[0].category, "render-expansion");
    assert.deepEqual(
      result.findings.filter(
        (candidate) =>
          candidate.ruleId === "missing-css-class" && candidate.data?.className === "hidden",
      ),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("unsupported-syntax-affecting-analysis does not report modeled JSX className", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <main className="modeled">Hello</main>; }\n',
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: [],
    });

    assert.deepEqual(
      result.findings.filter(
        (candidate) => candidate.ruleId === "unsupported-syntax-affecting-analysis",
      ),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("unsupported-syntax-affecting-analysis can be disabled from config", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      rules: {
        "unsupported-syntax-affecting-analysis": "off",
      },
    })
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <Unknown render={() => <div className="hidden" />} />; }\n',
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: [],
    });

    assert.deepEqual(
      result.findings.filter(
        (candidate) => candidate.ruleId === "unsupported-syntax-affecting-analysis",
      ),
      [],
    );
  } finally {
    await project.cleanup();
  }
});
