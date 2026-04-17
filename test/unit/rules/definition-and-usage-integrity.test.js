import test from "node:test";
import assert from "node:assert/strict";

import { runRuleScenario, withRuleTempDir, writeProjectFile } from "../../support/ruleTestUtils.js";

test("missing-css-class reports missing raw class references but not valid imports", async () => {
  await withRuleTempDir(async (tempDir) => {
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

    const findings = await runRuleScenario(tempDir);

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
  await withRuleTempDir(async (tempDir) => {
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

    const findings = await runRuleScenario(tempDir);

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
  await withRuleTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      ['import "./App.css";', 'export function App() { return <div className="used" />; }'].join(
        "\n",
      ),
    );
    await writeProjectFile(tempDir, "src/App.css", ".used {} .unused {}");

    const findings = await runRuleScenario(tempDir);

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
  await withRuleTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      ['import "./App.css";', 'export function App() { return <div className="used" />; }'].join(
        "\n",
      ),
    );
    await writeProjectFile(tempDir, "src/App.css", ".used {}\n.unused {}\n");

    const findings = await runRuleScenario(tempDir);
    const finding = findings.find(
      (entry) => entry.ruleId === "unused-css-class" && entry.subject?.className === "unused",
    );

    assert.ok(finding);
    assert.equal(finding.primaryLocation?.filePath, "src/App.css");
    assert.equal(finding.primaryLocation?.line, 2);
  });
});

test("unused-css-class does not report classes that are used through const-backed composition", async () => {
  await withRuleTempDir(async (tempDir) => {
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

    const findings = await runRuleScenario(tempDir);

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

test("compound and contextual selectors do not satisfy plain missing-css-class references", async () => {
  await withRuleTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      [
        'import "./App.css";',
        'export function App() { return <div className="button icon" />; }',
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "src/App.css",
      [".button.button--primary {}", ".toolbar .icon {}"].join("\n"),
    );

    const findings = await runRuleScenario(tempDir);

    assert.ok(
      findings.some(
        (finding) =>
          finding.ruleId === "missing-css-class" && finding.subject?.className === "button",
      ),
    );
    assert.ok(
      findings.some(
        (finding) =>
          finding.ruleId === "missing-css-class" && finding.subject?.className === "icon",
      ),
    );
    assert.ok(
      !findings.some(
        (finding) =>
          finding.ruleId === "unreachable-css" && finding.subject?.className === "button",
      ),
    );
  });
});

test("compound and contextual selectors are excluded from plain unused-css-class evidence", async () => {
  await withRuleTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      [
        'import "./App.css";',
        'export function App() { return <div className="button icon" />; }',
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "src/App.css",
      [".button.button--primary {}", ".toolbar .icon {}", ".button {}", ".used:hover {}"].join(
        "\n",
      ),
    );

    const findings = await runRuleScenario(tempDir);

    assert.ok(
      !findings.some(
        (finding) => finding.ruleId === "unused-css-class" && finding.subject?.className === "icon",
      ),
    );
    assert.ok(
      !findings.some(
        (finding) =>
          finding.ruleId === "unused-css-class" && finding.subject?.className === "button--primary",
      ),
    );
    assert.ok(
      !findings.some(
        (finding) =>
          finding.ruleId === "unused-css-class" && finding.subject?.className === "button",
      ),
    );
  });
});

test("imported external css class definitions prevent false missing-css-class findings", async () => {
  await withRuleTempDir(async (tempDir) => {
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

    const findings = await runRuleScenario(tempDir);

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
      'export function App() { return <div className="fa-solid fa-plus missing" />; }',
    );

    const findings = await runRuleScenario(tempDir);

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
  await withRuleTempDir(async (tempDir) => {
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

    const findings = await runRuleScenario(tempDir);

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
