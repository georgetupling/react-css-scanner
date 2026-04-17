import test from "node:test";
import assert from "node:assert/strict";

import { runRuleScenario, withRuleTempDir, writeProjectFile } from "../../support/ruleTestUtils.js";

test("utility-class-replacement reports classes fully covered by a small utility composition", async () => {
  await withRuleTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/styles/utilities.css",
      [".flex { display: flex; }", ".gap-2 { gap: 8px; }", ".bold { font-weight: bold; }"].join(
        "\n",
      ),
    );
    await writeProjectFile(
      tempDir,
      "src/components/Card.css",
      [
        ".cardStack { display: flex; gap: 8px; }",
        ".cardRow { display: flex; gap: 8px; font-weight: bold; color: red; }",
        ".cardTitle { font-weight: bold; }",
      ].join("\n"),
    );

    const findings = await runRuleScenario(tempDir, {
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
          finding.subject?.className === "cardRow",
      ),
    );
    assert.ok(
      findings.some(
        (finding) =>
          finding.ruleId === "utility-class-replacement" &&
          finding.subject?.className === "cardTitle",
      ),
    );
  });
});

test("utility-class-replacement reports single-declaration utility replacements", async () => {
  await withRuleTempDir(async (tempDir) => {
    await writeProjectFile(tempDir, "src/styles/utilities.css", ".text-sm { font-size: 0.8rem; }");
    await writeProjectFile(
      tempDir,
      "src/components/Explainer.css",
      ".section__explainer-text { font-size: 0.8rem; }",
    );

    const findings = await runRuleScenario(tempDir, {
      css: {
        utilities: ["src/styles/utilities.css"],
      },
    });

    const finding = findings.find(
      (entry) =>
        entry.ruleId === "utility-class-replacement" &&
        entry.subject?.className === "section__explainer-text",
    );

    assert.ok(finding);
    assert.deepEqual(finding.metadata?.utilityClassNames, ["text-sm"]);
  });
});

test("utility-class-replacement includes line numbers for both class locations", async () => {
  await withRuleTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/styles/utilities.css",
      ".flex { display: flex; }\n.gap-2 { gap: 8px; }",
    );
    await writeProjectFile(
      tempDir,
      "src/components/Card.css",
      ".cardStack { display: flex; gap: 8px; }",
    );

    const findings = await runRuleScenario(tempDir, {
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
    assert.deepEqual(finding.relatedLocations, [
      { filePath: "src/styles/utilities.css", line: 1 },
      { filePath: "src/styles/utilities.css", line: 2 },
    ]);
    assert.deepEqual(finding.metadata?.utilityClassNames, ["flex", "gap-2"]);
  });
});

test("utility-class-replacement ignores overlap that only exists in a different at-rule context", async () => {
  await withRuleTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/styles/utilities.css",
      "@media (min-width: 768px) { .flex { display: flex; } .gap-4 { gap: 1rem; } }",
    );
    await writeProjectFile(tempDir, "src/Card.css", ".cardStack { display: flex; gap: 1rem; }");

    const findings = await runRuleScenario(tempDir, {
      css: {
        global: ["src/styles/utilities.css"],
        utilities: ["src/styles/utilities.css"],
      },
    });

    assert.ok(
      !findings.some(
        (finding) =>
          finding.ruleId === "utility-class-replacement" &&
          finding.subject?.className === "cardStack",
      ),
    );
  });
});

test("utility-class-replacement skips classes with same-selector variants in other at-rule contexts", async () => {
  await withRuleTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/styles/utilities.css",
      ".flex { display: flex; }\n.gap-2 { gap: 8px; }",
    );
    await writeProjectFile(
      tempDir,
      "src/components/Card.css",
      [
        ".cardStack { display: flex; gap: 8px; }",
        "@media (min-width: 768px) { .cardStack { gap: 16px; } }",
      ].join("\n"),
    );

    const findings = await runRuleScenario(tempDir, {
      css: {
        utilities: ["src/styles/utilities.css"],
      },
    });

    assert.ok(
      !findings.some(
        (finding) =>
          finding.ruleId === "utility-class-replacement" &&
          finding.subject?.className === "cardStack",
      ),
    );
  });
});

test("utility-class-replacement respects maxUtilityClasses for utility compositions", async () => {
  await withRuleTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/styles/utilities.css",
      [
        ".grid { display: grid; }",
        ".cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }",
        ".gap-1 { gap: 4px; }",
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "src/components/Grid.css",
      ".productGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; }",
    );

    const defaultFindings = await runRuleScenario(tempDir, {
      css: {
        utilities: ["src/styles/utilities.css"],
      },
    });
    assert.ok(
      defaultFindings.some(
        (finding) =>
          finding.ruleId === "utility-class-replacement" &&
          finding.subject?.className === "productGrid",
      ),
    );

    const strictFindings = await runRuleScenario(tempDir, {
      css: {
        utilities: ["src/styles/utilities.css"],
      },
      rules: {
        "utility-class-replacement": {
          severity: "info",
          maxUtilityClasses: 2,
        },
      },
    });
    assert.ok(
      !strictFindings.some(
        (finding) =>
          finding.ruleId === "utility-class-replacement" &&
          finding.subject?.className === "productGrid",
      ),
    );
  });
});

test("empty-css-rule reports empty selector blocks and preserves at-rule context", async () => {
  await withRuleTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.css",
      [
        ".filled { color: red; }",
        ".empty {}",
        "@media (min-width: 768px) { .responsive-empty {} }",
      ].join("\n"),
    );

    const findings = await runRuleScenario(tempDir);
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
  await withRuleTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.css",
      [
        ".button { display: flex; gap: 1rem; }",
        ".button { gap: 1rem; display: flex; }",
        "@media (min-width: 768px) { .button { display: flex; gap: 1rem; } }",
      ].join("\n"),
    );

    const findings = await runRuleScenario(tempDir);
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
  await withRuleTempDir(async (tempDir) => {
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

    const findings = await runRuleScenario(tempDir);
    const finding = findings.find(
      (entry) =>
        entry.ruleId === "redundant-css-declaration-block" && entry.subject?.className === "button",
    );

    assert.equal(finding, undefined);
  });
});

test("duplicate-css-class-definition reports duplicate project class names once", async () => {
  await withRuleTempDir(async (tempDir) => {
    await writeProjectFile(tempDir, "src/A.css", ".shared {}");
    await writeProjectFile(tempDir, "src/B.css", ".shared {}");

    const findings = await runRuleScenario(tempDir);
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
  await withRuleTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/Button.css",
      ".button {}\n.other {}\n.button.button--sm {}\n.button[data-kind='primary'] {}",
    );

    const findings = await runRuleScenario(tempDir);
    const finding = findings.find(
      (entry) =>
        entry.ruleId === "duplicate-css-class-definition" && entry.subject?.className === "button",
    );

    assert.equal(finding, undefined);
  });
});

test("duplicate-css-class-definition ignores different at-rule contexts for the same class", async () => {
  await withRuleTempDir(async (tempDir) => {
    await writeProjectFile(tempDir, "src/A.css", "@media (min-width: 768px) { .shared {} }");
    await writeProjectFile(tempDir, "src/B.css", ".shared {}");

    const findings = await runRuleScenario(tempDir);
    const duplicateFindings = findings.filter(
      (finding) =>
        finding.ruleId === "duplicate-css-class-definition" &&
        finding.subject?.className === "shared",
    );

    assert.equal(duplicateFindings.length, 0);
  });
});
