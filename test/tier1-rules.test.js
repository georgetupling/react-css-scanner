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
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "react-css-scanner-tier1-test-"));

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

test("missing-css-class reports missing raw class references but not valid imports", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/Missing.tsx",
      'export function Missing() { return <div className="missing" />; }',
    );
    await writeProjectFile(
      tempDir,
      "src/Present.tsx",
      [
        'import "./Present.css";',
        'export function Present() { return <div className="present" />; }',
      ].join("\n"),
    );
    await writeProjectFile(tempDir, "src/Present.css", ".present {}");

    const findings = await runScenario(tempDir);

    assert.ok(
      findings.some(
        (finding) =>
          finding.ruleId === "missing-css-class" && finding.subject?.className === "missing",
      ),
    );
    assert.ok(
      !findings.some(
        (finding) =>
          finding.ruleId === "missing-css-class" && finding.subject?.className === "present",
      ),
    );
  });
});

test("unreachable-css reports classes defined outside reachable css but not reachable ones", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/Unreachable.tsx",
      'export function Unreachable() { return <div className="orphan" />; }',
    );
    await writeProjectFile(tempDir, "src/Other.css", ".orphan {}");
    await writeProjectFile(
      tempDir,
      "src/Reachable.tsx",
      [
        'import "./Reachable.css";',
        'export function Reachable() { return <div className="ready" />; }',
      ].join("\n"),
    );
    await writeProjectFile(tempDir, "src/Reachable.css", ".ready {}");

    const findings = await runScenario(tempDir);

    assert.ok(
      findings.some(
        (finding) =>
          finding.ruleId === "unreachable-css" && finding.subject?.className === "orphan",
      ),
    );
    assert.ok(
      !findings.some(
        (finding) => finding.ruleId === "unreachable-css" && finding.subject?.className === "ready",
      ),
    );
  });
});

test("unused-css-class reports unused project css classes but not used ones", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      ['import "./App.css";', 'export function App() { return <div className="used" />; }'].join(
        "\n",
      ),
    );
    await writeProjectFile(tempDir, "src/App.css", ".used {} .unused {}");

    const findings = await runScenario(tempDir);

    assert.ok(
      findings.some(
        (finding) =>
          finding.ruleId === "unused-css-class" && finding.subject?.className === "unused",
      ),
    );
    assert.ok(
      !findings.some(
        (finding) => finding.ruleId === "unused-css-class" && finding.subject?.className === "used",
      ),
    );
  });
});

test("component-style-cross-component reports component css used by another source", async () => {
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
      "src/screens/Other.tsx",
      [
        'import "../components/Button.css";',
        'export function Other() { return <div className="button" />; }',
      ].join("\n"),
    );

    const findings = await runScenario(tempDir, {
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
  await withTempDir(async (tempDir) => {
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

    const findings = await runScenario(tempDir, {
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

test("utility-class-replacement reports utility overlap above threshold but not below it", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/styles/utilities.css",
      ".u-stack { display: flex; gap: 8px; }",
    );
    await writeProjectFile(
      tempDir,
      "src/components/Card.css",
      [
        ".cardStack { display: flex; gap: 8px; color: red; }",
        ".cardTitle { font-weight: bold; }",
      ].join("\n"),
    );

    const findings = await runScenario(tempDir, {
      css: {
        utilities: ["src/styles/utilities.css"],
      },
    });

    assert.ok(
      findings.some(
        (finding) =>
          finding.ruleId === "utility-class-replacement" &&
          finding.subject?.className === "cardStack",
      ),
    );
    assert.ok(
      !findings.some(
        (finding) =>
          finding.ruleId === "utility-class-replacement" &&
          finding.subject?.className === "cardTitle",
      ),
    );
  });
});

test("dynamic-class-reference reports unresolved dynamic composition but not fully static classes", async () => {
  await withTempDir(async (tempDir) => {
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

    const findings = await runScenario(tempDir);

    assert.ok(findings.some((finding) => finding.ruleId === "dynamic-class-reference"));
    assert.ok(
      !findings.some(
        (finding) =>
          finding.ruleId === "dynamic-class-reference" && finding.subject?.className === "static",
      ),
    );
  });
});

test("missing-css-module-class reports unknown module classes but not valid ones", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/Button.tsx",
      [
        'import styles from "./Button.module.css";',
        "export function Button() {",
        "  return <><div className={styles.present} /><div className={styles.missing} /></>;",
        "}",
      ].join("\n"),
    );
    await writeProjectFile(tempDir, "src/Button.module.css", ".present {}");

    const findings = await runScenario(tempDir);

    assert.ok(
      findings.some(
        (finding) =>
          finding.ruleId === "missing-css-module-class" && finding.subject?.className === "missing",
      ),
    );
    assert.ok(
      !findings.some(
        (finding) =>
          finding.ruleId === "missing-css-module-class" && finding.subject?.className === "present",
      ),
    );
  });
});

test("imported external css class definitions prevent false missing-css-class findings", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      [
        'import "bootstrap/dist/css/bootstrap.css";',
        'export function App() { return <div className="btn missing" />; }',
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "node_modules/bootstrap/dist/css/bootstrap.css",
      ".btn { display: inline-block; }",
    );

    const findings = await runScenario(tempDir);

    assert.ok(
      !findings.some(
        (finding) => finding.ruleId === "missing-css-class" && finding.subject?.className === "btn",
      ),
    );
    assert.ok(
      findings.some(
        (finding) =>
          finding.ruleId === "missing-css-class" && finding.subject?.className === "missing",
      ),
    );
  });
});
