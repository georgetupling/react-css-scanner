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
    await writeProjectFile(
      tempDir,
      "package.json",
      '{\n  "name": "tier2-test",\n  "dependencies": {\n    "react": "^18.0.0"\n  }\n}\n',
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
      [
        'import classNames from "classnames";',
        "const enabled = true;",
        'export function App() { return <i className={classNames(enabled && "fa-plus")} />; }',
      ].join("\n"),
    );

    const findings = await runScenario(tempDir);

    assert.ok(
      !findings.some(
        (finding) =>
          finding.ruleId === "dynamic-missing-css-class" &&
          finding.subject?.className === "fa-plus",
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

test("unused-css-module-class includes the CSS definition line number", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/Button.tsx",
      "import styles from './Button.module.css';\nexport function Button() { return <div className={styles.used} />; }",
    );
    await writeProjectFile(tempDir, "src/Button.module.css", ".used {}\n.unused {}\n");

    const findings = await runScenario(tempDir);
    const finding = findings.find(
      (entry) =>
        entry.ruleId === "unused-css-module-class" && entry.subject?.className === "unused",
    );

    assert.ok(finding);
    assert.equal(finding.primaryLocation?.filePath, "src/Button.module.css");
    assert.equal(finding.primaryLocation?.line, 2);
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

test("missing-external-css-class ignores classes satisfied by html-linked declared providers", async () => {
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
      [
        'import "bootstrap/dist/css/bootstrap.css";',
        'export function App() { return <div className="btn fa-solid fa-trash ghost-btn" />; }',
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "node_modules/bootstrap/dist/css/bootstrap.css",
      ".btn { display: inline-block; }",
    );

    const findings = await runScenario(tempDir);

    for (const className of ["fa-solid", "fa-trash"]) {
      assert.ok(
        !findings.some(
          (finding) =>
            finding.ruleId === "missing-external-css-class" &&
            finding.subject?.className === className,
        ),
      );
    }

    assert.ok(
      findings.some(
        (finding) =>
          finding.ruleId === "missing-external-css-class" &&
          finding.subject?.className === "ghost-btn",
      ),
    );
  });
});

test("empty-css-rule reports empty selector blocks and preserves at-rule context", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.css",
      [
        ".filled { color: red; }",
        ".empty {}",
        "@media (min-width: 768px) { .responsive-empty {} }",
      ].join("\n"),
    );

    const findings = await runScenario(tempDir);
    const emptyFindings = findings.filter((finding) => finding.ruleId === "empty-css-rule");

    assert.equal(emptyFindings.length, 2);
    assert.deepEqual(
      emptyFindings.map((finding) => ({
        line: finding.primaryLocation?.line,
        selector: finding.metadata.selector,
        atRuleContext: finding.metadata.atRuleContext,
      })),
      [
        {
          line: 2,
          selector: ".empty",
          atRuleContext: [],
        },
        {
          line: 3,
          selector: ".responsive-empty",
          atRuleContext: [{ name: "media", params: "(min-width: 768px)" }],
        },
      ],
    );
  });
});

test("redundant-css-declaration-block reports exact same-file duplicates in the same context", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.css",
      [
        ".button { display: flex; gap: 1rem; }",
        ".button { gap: 1rem; display: flex; }",
        "@media (min-width: 768px) { .button { display: flex; gap: 1rem; } }",
      ].join("\n"),
    );

    const findings = await runScenario(tempDir);
    const finding = findings.find(
      (entry) =>
        entry.ruleId === "redundant-css-declaration-block" && entry.subject?.className === "button",
    );

    assert.ok(finding);
    assert.equal(finding.primaryLocation?.filePath, "src/App.css");
    assert.equal(finding.primaryLocation?.line, 1);
    assert.deepEqual(finding.relatedLocations, [{ filePath: "src/App.css", line: 2 }]);
    assert.deepEqual(finding.metadata.duplicateLocations, [
      {
        filePath: "src/App.css",
        line: 1,
        selector: ".button",
        atRuleContext: [],
      },
      {
        filePath: "src/App.css",
        line: 2,
        selector: ".button",
        atRuleContext: [],
      },
    ]);
  });
});

test("redundant-css-declaration-block ignores breakpoint and selector-context differences", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.css",
      [
        ".button { display: flex; }",
        "@media (min-width: 768px) { .button { display: flex; } }",
        ".panel .button { display: flex; }",
        ".button:hover { display: flex; }",
      ].join("\n"),
    );

    const findings = await runScenario(tempDir);
    const finding = findings.find(
      (entry) =>
        entry.ruleId === "redundant-css-declaration-block" && entry.subject?.className === "button",
    );

    assert.equal(finding, undefined);
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
    assert.deepEqual(duplicateFindings[0].metadata.duplicateLocations, [
      { filePath: "src/A.css", line: 1, selector: ".shared", atRuleContext: [] },
      { filePath: "src/B.css", line: 1, selector: ".shared", atRuleContext: [] },
    ]);
  });
});

test("duplicate-css-class-definition ignores same-file compound and attribute variants", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/Button.css",
      ".button {}\n.other {}\n.button.button--sm {}\n.button[data-kind='primary'] {}",
    );

    const findings = await runScenario(tempDir);
    const finding = findings.find(
      (entry) =>
        entry.ruleId === "duplicate-css-class-definition" && entry.subject?.className === "button",
    );

    assert.equal(finding, undefined);
  });
});

test("duplicate-css-class-definition ignores different at-rule contexts for the same class", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(tempDir, "src/A.css", "@media (min-width: 768px) { .shared {} }");
    await writeProjectFile(tempDir, "src/B.css", ".shared {}");

    const findings = await runScenario(tempDir);
    const duplicateFindings = findings.filter(
      (finding) =>
        finding.ruleId === "duplicate-css-class-definition" &&
        finding.subject?.className === "shared",
    );

    assert.equal(duplicateFindings.length, 0);
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
