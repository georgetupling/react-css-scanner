import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";

import {
  buildProjectModel,
  extractProjectFacts,
  normalizeReactCssScannerConfig,
  runRules,
} from "../dist/index.js";

async function withTempDir(run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "react-css-scanner-tier2-test-"));

  try {
    await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeProjectFile(rootDir, relativePath, content) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function runScenario(tempDir, configOverride = {}) {
  const config = normalizeReactCssScannerConfig(configOverride);
  const facts = await extractProjectFacts(config, tempDir);
  const model = buildProjectModel({ config, facts });
  return runRules(model).findings;
}

test("page-style-used-by-single-component reports narrow page css but not broadly used page css", async () => {
  await withTempDir(async (tempDir) => {
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

    const findings = await runScenario(tempDir, {
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

test("dynamic-missing-css-class reports unresolved dynamic classes with no definitions", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      [
        'import classNames from "classnames";',
        "const state = true;",
        'export function App() { return <div className={classNames("panel", state && "missingDynamic")} />; }',
      ].join("\n"),
    );

    const findings = await runScenario(tempDir);

    assert.ok(
      findings.some(
        (finding) =>
          finding.ruleId === "dynamic-missing-css-class" &&
          finding.metadata.sourceExpression === 'state && "missingDynamic"',
      ),
    );
  });
});

test("unused-css-module-class reports unused module classes but not referenced ones", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/Button.tsx",
      [
        'import styles from "./Button.module.css";',
        "export function Button() { return <div className={styles.used} />; }",
      ].join("\n"),
    );
    await writeProjectFile(tempDir, "src/Button.module.css", ".used {} .unused {}");

    const findings = await runScenario(tempDir);

    assert.ok(
      findings.some(
        (finding) =>
          finding.ruleId === "unused-css-module-class" && finding.subject?.className === "unused",
      ),
    );
    assert.ok(
      !findings.some(
        (finding) =>
          finding.ruleId === "unused-css-module-class" && finding.subject?.className === "used",
      ),
    );
  });
});

test("missing-external-css-class reports missing classes when external css is imported", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      [
        'import "bootstrap/dist/css/bootstrap.css";',
        'export function App() { return <div className="btn ghost-btn" />; }',
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "node_modules/bootstrap/dist/css/bootstrap.css",
      ".btn { display: inline-block; }",
    );

    const findings = await runScenario(tempDir);

    assert.ok(
      findings.some(
        (finding) =>
          finding.ruleId === "missing-external-css-class" &&
          finding.subject?.className === "ghost-btn",
      ),
    );
    assert.ok(
      !findings.some(
        (finding) =>
          finding.ruleId === "missing-external-css-class" && finding.subject?.className === "btn",
      ),
    );
  });
});

test("duplicate-css-class-definition reports duplicate project class names once", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(tempDir, "src/A.css", ".shared {}");
    await writeProjectFile(tempDir, "src/B.css", ".shared {}");

    const findings = await runScenario(tempDir);
    const duplicateFindings = findings.filter(
      (finding) =>
        finding.ruleId === "duplicate-css-class-definition" &&
        finding.subject?.className === "shared",
    );

    assert.equal(duplicateFindings.length, 1);
    assert.deepEqual(duplicateFindings[0].metadata.duplicateCssFiles, ["src/A.css", "src/B.css"]);
  });
});

test("component-css-should-be-global reports broadly used component css when threshold is exceeded", async () => {
  await withTempDir(async (tempDir) => {
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

    const findings = await runScenario(tempDir, {
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
