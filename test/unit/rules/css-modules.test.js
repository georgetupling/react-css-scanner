import test from "node:test";
import assert from "node:assert/strict";

import { runRuleScenario, withRuleTempDir, writeProjectFile } from "../../support/ruleTestUtils.js";

test("missing-css-module-class reports unknown module classes but not valid ones", async () => {
  await withRuleTempDir(async (tempDir) => {
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

    const findings = await runRuleScenario(tempDir);

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

test("unused-css-module-class reports unused module classes but not referenced ones", async () => {
  await withRuleTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/Button.tsx",
      [
        'import styles from "./Button.module.css";',
        "export function Button() { return <div className={styles.used} />; }",
      ].join("\n"),
    );
    await writeProjectFile(tempDir, "src/Button.module.css", ".used {} .unused {}");

    const findings = await runRuleScenario(tempDir);

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
  await withRuleTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/Button.tsx",
      "import styles from './Button.module.css';\nexport function Button() { return <div className={styles.used} />; }",
    );
    await writeProjectFile(tempDir, "src/Button.module.css", ".used {}\n.unused {}\n");

    const findings = await runRuleScenario(tempDir);
    const finding = findings.find(
      (entry) =>
        entry.ruleId === "unused-css-module-class" && entry.subject?.className === "unused",
    );

    assert.ok(finding);
    assert.equal(finding.primaryLocation?.filePath, "src/Button.module.css");
    assert.equal(finding.primaryLocation?.line, 2);
  });
});
