import test from "node:test";
import assert from "node:assert/strict";

import { runRuleScenario, withRuleTempDir, writeProjectFile } from "../../support/ruleTestUtils.js";

test("dynamic-class-reference reports unresolved dynamic composition but ignores fully provable expressions", async () => {
  await withRuleTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      'export function App() { return <div className={`panel ${getStateClass()}`} />; }',
    );
    await writeProjectFile(
      tempDir,
      "src/Static.tsx",
      [
        "function joinClasses(...classes) {",
        '  return classes.filter(Boolean).join(" ");',
        "}",
        "const isOpen = true;",
        'export function Static() { return <div className={joinClasses("static", isOpen && "static--open")} />; }',
      ].join("\n"),
    );

    const findings = await runRuleScenario(tempDir);

    assert.ok(findings.some((finding) => finding.ruleId === "dynamic-class-reference"));
    const dynamicFinding = findings.find((finding) => finding.ruleId === "dynamic-class-reference");
    assert.equal(dynamicFinding?.primaryLocation?.filePath, "src/App.tsx");
    assert.equal(dynamicFinding?.primaryLocation?.line, 1);
    assert.ok(typeof dynamicFinding?.primaryLocation?.column === "number");
    assert.ok(
      !findings.some(
        (finding) =>
          finding.ruleId === "dynamic-class-reference" &&
          (finding.subject?.className === "static" || finding.subject?.className === "static--open"),
      ),
    );
  });
});

test("dynamic-missing-css-class reports unresolved dynamic classes with no definitions", async () => {
  await withRuleTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      [
        'import classNames from "classnames";',
        'export function App() { return <div className={classNames("panel", "missing-" + getSuffix())} />; }',
      ].join("\n"),
    );

    const findings = await runRuleScenario(tempDir);

    assert.ok(
      findings.some(
        (finding) =>
          finding.ruleId === "dynamic-missing-css-class" &&
          finding.metadata.sourceExpression === '"missing-" + getSuffix()',
      ),
    );
    const finding = findings.find(
      (entry) =>
        entry.ruleId === "dynamic-missing-css-class" &&
        entry.metadata.sourceExpression === '"missing-" + getSuffix()',
    );
    assert.equal(finding?.primaryLocation?.filePath, "src/App.tsx");
    assert.equal(finding?.primaryLocation?.line, 2);
    assert.ok(typeof finding?.primaryLocation?.column === "number");
  });
});

test("dynamic-missing-css-class ignores classes satisfied by active html-linked providers", async () => {
  await withRuleTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "index.html",
      [
        "<!doctype html>",
        '<html><head><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" /></head><body></body></html>',
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      [
        'import classNames from "classnames";',
        "const enabled = true;",
        'export function App() { return <i className={classNames(enabled && "fa-plus")} />; }',
      ].join("\n"),
    );

    const findings = await runRuleScenario(tempDir);

    assert.ok(
      !findings.some(
        (finding) =>
          finding.ruleId === "dynamic-missing-css-class" &&
          finding.subject?.className === "fa-plus",
      ),
    );
  });
});

test("fully provable helper-composed classes fall through to missing-css-class instead of dynamic findings", async () => {
  await withRuleTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      [
        "function joinClasses(...classes) {",
        '  return classes.filter(Boolean).join(" ");',
        "}",
        "const enabled = true;",
        'export function App() { return <div className={joinClasses("panel", enabled && "missingStatic")} />; }',
      ].join("\n"),
    );

    const findings = await runRuleScenario(tempDir);

    assert.ok(
      findings.some(
        (finding) =>
          finding.ruleId === "missing-css-class" && finding.subject?.className === "missingStatic",
      ),
    );
    assert.ok(
      !findings.some(
        (finding) =>
          finding.ruleId === "dynamic-missing-css-class" &&
          finding.subject?.className === "missingStatic",
      ),
    );
  });
});
