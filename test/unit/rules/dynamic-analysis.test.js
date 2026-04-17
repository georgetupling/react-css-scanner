import test from "node:test";
import assert from "node:assert/strict";

import { runRuleScenario, withRuleTempDir, writeProjectFile } from "../../support/ruleTestUtils.js";

test("dynamic-class-reference reports unresolved dynamic composition but not fully static classes", async () => {
  await withRuleTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      [
        "const isOpen = true;",
        'export function App() { return <div className={`panel ${isOpen ? "open" : "closed"}`} />; }',
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "src/Static.tsx",
      'export function Static() { return <div className="static" />; }',
    );

    const findings = await runRuleScenario(tempDir);

    assert.ok(findings.some((finding) => finding.ruleId === "dynamic-class-reference"));
    const dynamicFinding = findings.find((finding) => finding.ruleId === "dynamic-class-reference");
    assert.equal(dynamicFinding?.primaryLocation?.filePath, "src/App.tsx");
    assert.equal(dynamicFinding?.primaryLocation?.line, 2);
    assert.ok(typeof dynamicFinding?.primaryLocation?.column === "number");
    assert.ok(
      !findings.some(
        (finding) =>
          finding.ruleId === "dynamic-class-reference" && finding.subject?.className === "static",
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
        "const state = true;",
        'export function App() { return <div className={classNames("panel", state && "missingDynamic")} />; }',
      ].join("\n"),
    );

    const findings = await runRuleScenario(tempDir);

    assert.ok(
      findings.some(
        (finding) =>
          finding.ruleId === "dynamic-missing-css-class" &&
          finding.metadata.sourceExpression === 'state && "missingDynamic"',
      ),
    );
    const finding = findings.find(
      (entry) =>
        entry.ruleId === "dynamic-missing-css-class" &&
        entry.metadata.sourceExpression === 'state && "missingDynamic"',
    );
    assert.equal(finding?.primaryLocation?.filePath, "src/App.tsx");
    assert.equal(finding?.primaryLocation?.line, 3);
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
