import test from "node:test";
import assert from "node:assert/strict";

import { runRuleScenario, withRuleTempDir, writeProjectFile } from "../../support/ruleTestUtils.js";

test("component-style-cross-component reports component css used by another source", async () => {
  await withRuleTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/components/Button.tsx",
      [
        'import "./Button.css";',
        'export function Button() { return <button className="button" />; }',
      ].join("\n"),
    );
    await writeProjectFile(tempDir, "src/components/Button.css", ".button {}");
    await writeProjectFile(
      tempDir,
      "src/screens/Other.tsx",
      [
        'import "../components/Button.css";',
        'export function Other() { return <div className="button" />; }',
      ].join("\n"),
    );

    const findings = await runRuleScenario(tempDir, {
      ownership: {
        namingConvention: "sibling",
      },
    });

    assert.ok(
      findings.some(
        (finding) =>
          finding.ruleId === "component-style-cross-component" &&
          finding.subject?.cssFilePath === "src/components/Button.css",
      ),
    );
  });
});

test("global-css-not-global reports narrow global css usage but not broadly used global css", async () => {
  await withRuleTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      'export function App() { return <div className="globalSingle" />; }',
    );
    await writeProjectFile(tempDir, "src/styles/global-single.css", ".globalSingle {}");
    await writeProjectFile(
      tempDir,
      "src/A.tsx",
      'export function A() { return <div className="globalShared" />; }',
    );
    await writeProjectFile(
      tempDir,
      "src/B.tsx",
      'export function B() { return <div className="globalShared" />; }',
    );
    await writeProjectFile(tempDir, "src/styles/global-shared.css", ".globalShared {}");

    const findings = await runRuleScenario(tempDir, {
      css: {
        global: ["src/styles/global-single.css", "src/styles/global-shared.css"],
      },
    });

    assert.ok(
      findings.some(
        (finding) =>
          finding.ruleId === "global-css-not-global" &&
          finding.subject?.cssFilePath === "src/styles/global-single.css",
      ),
    );
    assert.ok(
      !findings.some(
        (finding) =>
          finding.ruleId === "global-css-not-global" &&
          finding.subject?.cssFilePath === "src/styles/global-shared.css",
      ),
    );
  });
});

test("page-style-used-by-single-component reports narrow page css but not broadly used page css", async () => {
  await withRuleTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/OnlyOne.tsx",
      [
        'import "./pages/Home.css";',
        'export function OnlyOne() { return <div className="pageSolo" />; }',
      ].join("\n"),
    );
    await writeProjectFile(tempDir, "src/pages/Home.css", ".pageSolo {}");
    await writeProjectFile(
      tempDir,
      "src/A.tsx",
      [
        'import "./pages/Shared.css";',
        'export function A() { return <div className="pageShared" />; }',
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "src/B.tsx",
      [
        'import "./pages/Shared.css";',
        'export function B() { return <div className="pageShared" />; }',
      ].join("\n"),
    );
    await writeProjectFile(tempDir, "src/pages/Shared.css", ".pageShared {}");

    const findings = await runRuleScenario(tempDir, {
      ownership: {
        pagePatterns: ["src/pages/**/*"],
      },
    });

    assert.ok(
      findings.some(
        (finding) =>
          finding.ruleId === "page-style-used-by-single-component" &&
          finding.subject?.cssFilePath === "src/pages/Home.css",
      ),
    );
    assert.ok(
      !findings.some(
        (finding) =>
          finding.ruleId === "page-style-used-by-single-component" &&
          finding.subject?.cssFilePath === "src/pages/Shared.css",
      ),
    );
  });
});

test("component-css-should-be-global reports broadly used component css when threshold is exceeded", async () => {
  await withRuleTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/components/Button.tsx",
      [
        'import "./Button.css";',
        'export function Button() { return <button className="button" />; }',
      ].join("\n"),
    );
    await writeProjectFile(tempDir, "src/components/Button.css", ".button {}");
    await writeProjectFile(
      tempDir,
      "src/screens/One.tsx",
      [
        'import "../components/Button.css";',
        'export function One() { return <div className="button" />; }',
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "src/screens/Two.tsx",
      [
        'import "../components/Button.css";',
        'export function Two() { return <div className="button" />; }',
      ].join("\n"),
    );

    const findings = await runRuleScenario(tempDir, {
      ownership: {
        namingConvention: "sibling",
      },
      rules: {
        "component-css-should-be-global": {
          severity: "info",
          threshold: 2,
        },
      },
    });

    assert.ok(
      findings.some(
        (finding) =>
          finding.ruleId === "component-css-should-be-global" &&
          finding.subject?.cssFilePath === "src/components/Button.css",
      ),
    );
  });
});
