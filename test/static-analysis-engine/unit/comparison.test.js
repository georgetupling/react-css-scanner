import test from "node:test";
import assert from "node:assert/strict";

import { TestProjectBuilder } from "../../support/TestProjectBuilder.js";
import {
  analyzeSourceText,
  compareExperimentalFindings,
  compareExperimentalRuleResults,
  runExperimentalSelectorPilotAgainstCurrentScanner,
  runExperimentalSelectorPilotForSource,
  toExperimentalFindings,
} from "../../../dist/static-analysis-engine.js";

test("static analysis engine can map experimental rule results into finding-like shadow-mode records", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "export function App() {",
      '  return <section className="panel-shell"><h1 className="panel-title" /></section>;',
      "}",
    ].join("\n"),
    selectorCssSources: [
      {
        filePath: "src/App.css",
        cssText: ".panel-shell .missing-child { color: red; }",
      },
    ],
  });

  const experimentalFindings = toExperimentalFindings(result.experimentalRuleResults);
  assert.equal(experimentalFindings.length, 2);
  const neverSatisfiedFinding = experimentalFindings.find(
    (finding) => finding.ruleId === "selector-never-satisfied",
  );
  assert.ok(neverSatisfiedFinding);
  assert.equal(neverSatisfiedFinding.severity, "info");
  assert.equal(neverSatisfiedFinding.confidence, "high");
  assert.equal(
    neverSatisfiedFinding.message,
    "selector appears never satisfied under bounded analysis: .panel-shell .missing-child",
  );
  assert.equal(neverSatisfiedFinding.filePath, "src/App.css");
  assert.equal(neverSatisfiedFinding.line, 1);
  assert.equal(neverSatisfiedFinding.selectorText, ".panel-shell .missing-child");
  assert.deepEqual(
    neverSatisfiedFinding.traces,
    neverSatisfiedFinding.experimentalRuleResult.traces,
  );
});

test("static analysis engine comparison harness classifies experimental-only and matched findings", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "export function App() {",
      '  return <section className="panel-shell"><h1 className="panel-title" /></section>;',
      "}",
    ].join("\n"),
    selectorCssSources: [
      {
        filePath: "src/App.css",
        cssText: ".panel-shell .missing-child { color: red; }",
      },
    ],
  });

  const experimentalFindings = toExperimentalFindings(result.experimentalRuleResults);
  const experimentalOnlyComparison = compareExperimentalFindings({
    experimentalFindings,
    baselineFindings: [],
  });
  assert.equal(experimentalOnlyComparison.matched.length, 0);
  assert.equal(experimentalOnlyComparison.experimentalOnly.length, 2);
  assert.equal(experimentalOnlyComparison.baselineOnly.length, 0);

  const matchedComparison = compareExperimentalFindings({
    experimentalFindings,
    baselineFindings: [
      {
        ruleId: "selector-never-satisfied",
        family: "experimental",
        severity: "info",
        confidence: "high",
        message:
          "selector appears never satisfied under bounded analysis: .panel-shell .missing-child",
        primaryLocation: {
          filePath: "src/App.css",
          line: 1,
        },
        relatedLocations: [],
        metadata: {},
      },
    ],
  });
  assert.equal(matchedComparison.matched.length, 1);
  assert.equal(matchedComparison.experimentalOnly.length, 1);
  assert.equal(matchedComparison.baselineOnly.length, 0);
});

test("static analysis engine can compare experimental rule results against baseline findings in one step", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "export function App() {",
      '  return <section className="panel-shell"><h1 className="panel-title" /></section>;',
      "}",
    ].join("\n"),
    selectorCssSources: [
      {
        filePath: "src/App.css",
        cssText: ".panel-shell .missing-child { color: red; }",
      },
    ],
  });

  const comparisonResult = compareExperimentalRuleResults({
    experimentalRuleResults: result.experimentalRuleResults,
    baselineFindings: [
      {
        ruleId: "selector-never-satisfied",
        family: "experimental",
        severity: "info",
        confidence: "high",
        message:
          "selector appears never satisfied under bounded analysis: .panel-shell .missing-child",
        primaryLocation: {
          filePath: "src/App.css",
          line: 1,
        },
        relatedLocations: [],
        metadata: {},
      },
    ],
  });

  assert.equal(comparisonResult.experimentalFindings.length, 2);
  assert.equal(comparisonResult.comparison.matched.length, 1);
  assert.equal(comparisonResult.comparison.experimentalOnly.length, 1);
  assert.equal(comparisonResult.comparison.baselineOnly.length, 0);
  assert.deepEqual(comparisonResult.summary, {
    matchedCount: 1,
    experimentalOnlyCount: 1,
    baselineOnlyCount: 0,
    experimentalRuleIds: ["contextual-selector-branch-never-satisfied", "selector-never-satisfied"],
    baselineRuleIds: ["selector-never-satisfied"],
  });
});

test("static analysis engine can run the experimental selector pilot end to end for a source file", () => {
  const artifact = runExperimentalSelectorPilotForSource({
    filePath: "src/App.tsx",
    sourceText: [
      "export function App() {",
      '  return <section className="panel-shell"><h1 className="panel-title" /></section>;',
      "}",
    ].join("\n"),
    selectorCssSources: [
      {
        filePath: "src/App.css",
        cssText: ".panel-shell .missing-child { color: red; }",
      },
    ],
    baselineFindings: [],
  });

  assert.equal(artifact.engineResult.experimentalRuleResults.length, 2);
  assert.equal(artifact.experimentalRuleResults.length, 2);
  assert.equal(artifact.comparisonResult.summary.experimentalOnlyCount, 2);
  assert.match(artifact.report, /Experimental Rule Pilot Report/);
  assert.match(artifact.report, /Experimental Only: 2/);
  assert.match(
    artifact.report,
    /selector-never-satisfied: selector appears never satisfied under bounded analysis/,
  );
  assert.match(
    artifact.report,
    /contextual-selector-branch-never-satisfied: Contextual selector branch/,
  );
});

test("static analysis engine can run a direct shadow-mode comparison against the current scanner", async () => {
  const project = await new TestProjectBuilder()
    .withTemplate("basic-react-app")
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./App.css";',
        "export function App() {",
        '  return <section className="panel-shell"><h1 className="panel-title" /></section>;',
        "}",
      ].join("\n"),
    )
    .withCssFile("src/App.css", ".panel-shell .missing-child { color: red; }\n")
    .build();

  try {
    const artifact = await runExperimentalSelectorPilotAgainstCurrentScanner({
      cwd: project.rootDir,
    });

    assert.equal(artifact.experimentalRuleResults.length, 2);
    assert.equal(artifact.engineResult.experimentalRuleResults.length, 2);
    assert.equal(artifact.comparisonResult.summary.experimentalOnlyCount, 2);
    assert.equal(artifact.baselineScanResult.summary.sourceFileCount, 1);
    assert.match(artifact.report, /Experimental Rule Pilot Report/);
  } finally {
    await project.cleanup();
  }
});

test("direct shadow-mode comparison can match old and new unused-compound-selector-branch findings", async () => {
  const project = await new TestProjectBuilder()
    .withTemplate("basic-react-app")
    .withSourceFile(
      "src/App.tsx",
      ['import "./App.css";', 'export function App() { return <div className="panel" />; }'].join(
        "\n",
      ),
    )
    .withCssFile("src/App.css", ".panel.is-open { color: red; }\n")
    .build();

  try {
    const artifact = await runExperimentalSelectorPilotAgainstCurrentScanner({
      cwd: project.rootDir,
    });

    assert.ok(
      artifact.baselineScanResult.findings.some(
        (finding) => finding.ruleId === "unused-compound-selector-branch",
      ),
    );
    assert.ok(
      artifact.experimentalRuleResults.some(
        (ruleResult) => ruleResult.ruleId === "unused-compound-selector-branch",
      ),
    );
    assert.equal(artifact.comparisonResult.comparison.matched.length, 1);
    assert.equal(artifact.comparisonResult.summary.experimentalOnlyCount, 1);
    assert.equal(artifact.comparisonResult.summary.baselineOnlyCount, 1);
    assert.match(artifact.report, /unused-compound-selector-branch/);
    assert.match(artifact.report, /selector-never-satisfied/);
  } finally {
    await project.cleanup();
  }
});

test("direct shadow-mode comparison shows contextual selector signal as experimental-only", async () => {
  const project = await new TestProjectBuilder()
    .withTemplate("basic-react-app")
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./App.css";',
        "export function App() {",
        '  return <section className="panel-shell"><h1 className="panel-title" /></section>;',
        "}",
      ].join("\n"),
    )
    .withCssFile("src/App.css", ".panel-shell .missing-child { color: red; }\n")
    .build();

  try {
    const artifact = await runExperimentalSelectorPilotAgainstCurrentScanner({
      cwd: project.rootDir,
    });

    assert.equal(
      artifact.baselineScanResult.findings.filter(
        (finding) =>
          finding.ruleId === "unused-compound-selector-branch" ||
          finding.ruleId === "contextual-selector-branch-never-satisfied" ||
          finding.ruleId === "selector-never-satisfied",
      ).length,
      0,
    );
    assert.ok(
      artifact.experimentalRuleResults.some(
        (ruleResult) => ruleResult.ruleId === "contextual-selector-branch-never-satisfied",
      ),
    );
    assert.equal(artifact.comparisonResult.comparison.matched.length, 0);
    assert.equal(artifact.comparisonResult.summary.experimentalOnlyCount, 2);
    assert.equal(artifact.comparisonResult.summary.baselineOnlyCount, 2);
    assert.match(artifact.report, /contextual-selector-branch-never-satisfied/);
    assert.match(artifact.report, /Baseline-Only Findings:/);
  } finally {
    await project.cleanup();
  }
});

test("direct shadow-mode comparison can match css-structure optimization rules", async () => {
  const project = await new TestProjectBuilder()
    .withTemplate("basic-react-app")
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./App.css";',
        'import "./Theme.css";',
        "export function App() {",
        '  return <div className="button empty" />;',
        "}",
      ].join("\n"),
    )
    .withCssFile(
      "src/App.css",
      [".button { color: red; }", ".button { color: red; }", ".empty {}"].join("\n"),
    )
    .withCssFile("src/Theme.css", ".button { color: blue; }")
    .build();

  try {
    const artifact = await runExperimentalSelectorPilotAgainstCurrentScanner({
      cwd: project.rootDir,
    });

    const targetedMatches = artifact.comparisonResult.comparison.matched.filter(
      (entry) =>
        entry.experimental.ruleId === "empty-css-rule" ||
        entry.experimental.ruleId === "duplicate-css-class-definition" ||
        entry.experimental.ruleId === "redundant-css-declaration-block",
    );

    assert.equal(targetedMatches.length, 3);
    assert.ok(targetedMatches.some((entry) => entry.experimental.ruleId === "empty-css-rule"));
    assert.ok(
      targetedMatches.some(
        (entry) => entry.experimental.ruleId === "duplicate-css-class-definition",
      ),
    );
    assert.ok(
      targetedMatches.some(
        (entry) => entry.experimental.ruleId === "redundant-css-declaration-block",
      ),
    );
    assert.match(artifact.report, /empty-css-rule/);
    assert.match(artifact.report, /duplicate-css-class-definition/);
    assert.match(artifact.report, /redundant-css-declaration-block/);
  } finally {
    await project.cleanup();
  }
});
