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
    await writeProjectFile(
      tempDir,
      "package.json",
      '{\n  "name": "tier1-test",\n  "dependencies": {\n    "react": "^18.0.0"\n  }\n}\n',
    );
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
    const missingFinding = findings.find(
      (finding) =>
        finding.ruleId === "missing-css-class" && finding.subject?.className === "missing",
    );
    assert.equal(missingFinding?.primaryLocation?.filePath, "src/Missing.tsx");
    assert.equal(missingFinding?.primaryLocation?.line, 1);
    assert.ok(typeof missingFinding?.primaryLocation?.column === "number");
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

test("unused-css-class includes the CSS definition line number", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      ['import "./App.css";', 'export function App() { return <div className="used" />; }'].join(
        "\n",
      ),
    );
    await writeProjectFile(tempDir, "src/App.css", ".used {}\n.unused {}\n");

    const findings = await runScenario(tempDir);
    const finding = findings.find(
      (entry) => entry.ruleId === "unused-css-class" && entry.subject?.className === "unused",
    );

    assert.ok(finding);
    assert.equal(finding.primaryLocation?.filePath, "src/App.css");
    assert.equal(finding.primaryLocation?.line, 2);
  });
});

test("unused-css-class does not report classes that are used through const-backed composition", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/Button.tsx",
      [
        'import "./Button.css";',
        "const variant = 'primary';",
        "const isLoading = true;",
        "const buttonClassName = `button button--${variant}`;",
        "export function Button() {",
        "  return (",
        "    <button className={buttonClassName}>",
        '      {isLoading && <span className={isLoading && "button__spinner"} />}',
        "    </button>",
        "  );",
        "}",
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "src/Button.css",
      ".button {}\n.button--primary {}\n.button__spinner {}\n.button--ghost {}\n",
    );

    const findings = await runScenario(tempDir);

    for (const className of ["button", "button--primary", "button__spinner"]) {
      assert.ok(
        !findings.some(
          (finding) =>
            finding.ruleId === "unused-css-class" && finding.subject?.className === className,
        ),
      );
    }

    assert.ok(
      findings.some(
        (finding) =>
          finding.ruleId === "unused-css-class" && finding.subject?.className === "button--ghost",
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

test("utility-class-replacement includes line numbers for both class locations", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/styles/utilities.css",
      ".u-stack { display: flex; gap: 8px; }",
    );
    await writeProjectFile(
      tempDir,
      "src/components/Card.css",
      ".cardStack { display: flex; gap: 8px; color: red; }",
    );

    const findings = await runScenario(tempDir, {
      css: {
        utilities: ["src/styles/utilities.css"],
      },
    });
    const finding = findings.find(
      (entry) =>
        entry.ruleId === "utility-class-replacement" && entry.subject?.className === "cardStack",
    );

    assert.ok(finding);
    assert.equal(finding.primaryLocation?.filePath, "src/components/Card.css");
    assert.equal(finding.primaryLocation?.line, 1);
    assert.deepEqual(finding.relatedLocations, [{ filePath: "src/styles/utilities.css", line: 1 }]);
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

test("html-linked built-in external css providers prevent false missing-css-class findings", async () => {
  await withTempDir(async (tempDir) => {
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
      'export function App() { return <div className="fa-solid fa-plus missing" />; }',
    );

    const findings = await runScenario(tempDir);

    for (const className of ["fa-solid", "fa-plus"]) {
      assert.ok(
        !findings.some(
          (finding) =>
            finding.ruleId === "missing-css-class" && finding.subject?.className === className,
        ),
      );
    }

    assert.ok(
      findings.some(
        (finding) =>
          finding.ruleId === "missing-css-class" && finding.subject?.className === "missing",
      ),
    );
  });
});

test("html-linked bootstrap-icons provider prevents false missing-css-class findings", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "index.html",
      [
        "<!doctype html>",
        '<html><head><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.13.1/font/bootstrap-icons.min.css" /></head><body></body></html>',
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      'export function App() { return <div className="bi bi-trash missing" />; }',
    );

    const findings = await runScenario(tempDir);

    for (const className of ["bi", "bi-trash"]) {
      assert.ok(
        !findings.some(
          (finding) =>
            finding.ruleId === "missing-css-class" && finding.subject?.className === className,
        ),
      );
    }

    assert.ok(
      findings.some(
        (finding) =>
          finding.ruleId === "missing-css-class" && finding.subject?.className === "missing",
      ),
    );
  });
});
