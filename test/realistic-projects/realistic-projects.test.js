import assert from "node:assert/strict";
import test from "node:test";

import { scanProject } from "../../dist/index.js";
import { createCraStorefrontProject } from "../support/realisticProjects/createCraStorefrontProject.js";
import { createManagerUiProject } from "../support/realisticProjects/createManagerUiProject.js";

test("realistic CRA storefront keeps entry CSS reachable through nested app and barrel imports", async () => {
  const project = await createCraStorefrontProject();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      includeDebugRuntimeCss: true,
    });

    assert.equal(result.summary.sourceFileCount, 29);
    assert.equal(result.summary.cssFileCount, 2);
    assert.equal(result.summary.findingsByRule["css-class-unreachable"], 0);
    assert.equal(result.summary.findingsByRule["missing-css-class"], 1);
    assert.equal(result.summary.findingsByRule["unused-css-class"], 2);
    assert.equal(result.summary.findingsByRule["dynamic-class-reference"], 2);
    assert.equal(result.summary.findingsByRule["unsupported-syntax-affecting-analysis"], 0);
    assert.deepEqual(
      result.diagnostics.filter((diagnostic) => diagnostic.severity !== "debug"),
      [],
    );

    assertFinding(result, {
      ruleId: "missing-css-class",
      className: "server-only-badge",
      filePath: "src/components/Modal.js",
    });
    assertFinding(result, {
      ruleId: "unused-css-class",
      className: "legacy-reset",
      filePath: "src/index.css",
    });
    assertFinding(result, {
      ruleId: "unused-css-class",
      className: "stale-storefront-helper",
      filePath: "src/App.css",
    });

    assertRuntimeCssEntry(result, "src/index.js");
    assertInitialRuntimeStylesheet(result, "src/index.css");
    assertInitialRuntimeStylesheet(result, "src/App.css");
    assertInitialRuntimeStylesheet(result, "node_modules/bootstrap/dist/css/bootstrap.min.css");
    assertInitialRuntimeSource(result, "src/layout/Shell.js");
    assertInitialRuntimeSource(result, "src/components/Button.js");
    assertInitialRuntimeSource(result, "src/components/Modal.js");
    assertInitialRuntimeSource(result, "src/features/catalog/ProductList.js");
    assertInitialRuntimeSource(result, "src/features/catalog/components/ProductCard.js");
    assertInitialRuntimeSource(result, "src/features/cart/Cart.js");
    assertInitialRuntimeSource(result, "src/features/cart/CartItem.js");
    assertInitialRuntimeSource(result, "src/features/cart/CartSummary.js");
  } finally {
    await project.cleanup();
  }
});

test("realistic manager UI keeps webpack shell, app CSS, package CSS, and lazy CSS chunks reachable", async () => {
  const project = await createManagerUiProject();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      includeDebugRuntimeCss: true,
    });

    assert.equal(result.summary.sourceFileCount, 37);
    assert.equal(result.summary.cssFileCount, 6);
    assert.equal(result.summary.findingsByRule["css-class-unreachable"], 0);
    assert.equal(result.summary.findingsByRule["missing-css-class"], 0);
    assert.equal(result.summary.findingsByRule["unused-css-class"], 3);
    assert.equal(result.summary.findingsByRule["unused-css-module-class"], 2);
    assert.equal(result.summary.findingsByRule["dynamic-class-reference"], 5);
    assert.equal(result.summary.findingsByRule["unsupported-syntax-affecting-analysis"], 0);
    assert.deepEqual(
      result.diagnostics.filter((diagnostic) => diagnostic.severity !== "debug"),
      [],
    );

    assertFinding(result, {
      ruleId: "unused-css-module-class",
      className: "stale-preview-helper",
      filePath: "src/apps/active-preview/Preview.less",
    });
    assertFinding(result, {
      ruleId: "unused-css-class",
      className: "orphan-manager-utility",
      filePath: "src/shell/styles/global.css",
    });
    assertFinding(result, {
      ruleId: "unused-css-class",
      className: "stale-block-helper",
      filePath: "src/apps/blocks/styles/blocks.css",
    });
    assertFinding(result, {
      ruleId: "unused-css-class",
      className: "legacy-content-spacer",
      filePath: "src/apps/content/styles/content.css",
    });
    assertFinding(result, {
      ruleId: "unused-css-module-class",
      className: "unusedAuditToken",
      filePath: "src/apps/audit/styles/AuditPanel.module.css",
    });

    assertRuntimeCssEntry(result, "src/shell/index.tsx");
    assertRuntimeStylesheet(result, "initial", "src/shell/styles/global.css");
    assertRuntimeStylesheet(result, "initial", "src/apps/blocks/styles/blocks.css");
    assertRuntimeStylesheet(result, "initial", "src/apps/content/styles/content.css");
    assertRuntimeStylesheet(result, "initial", "node_modules/@zesty-io/material/dist/styles.css");
    assertRuntimeStylesheet(result, "lazy", "src/apps/active-preview/Preview.less");
    assertRuntimeStylesheet(result, "lazy", "src/apps/audit/styles/AuditPanel.module.css");
    assertRuntimeSource(result, "initial", "src/shell/components/AppShell.tsx");
    assertRuntimeSource(result, "initial", "src/apps/blocks/views/AllBlocks.tsx");
    assertRuntimeSource(result, "initial", "src/apps/content/views/ContentList.tsx");
    assertRuntimeSource(result, "lazy", "src/apps/active-preview/Preview.tsx");
    assertRuntimeSource(result, "lazy", "src/apps/audit/AuditPanel.tsx");
    assertRuntimeSource(result, "lazy", "src/apps/audit/components/AuditRow.tsx");
  } finally {
    await project.cleanup();
  }
});

function assertFinding(result, expected) {
  assert.ok(
    result.findings.some(
      (finding) =>
        finding.ruleId === expected.ruleId &&
        finding.data?.className === expected.className &&
        finding.location?.filePath === expected.filePath,
    ),
    `expected ${expected.ruleId} for ${expected.className} in ${expected.filePath}`,
  );
}

function assertRuntimeCssEntry(result, entrySourceFilePath) {
  assert.ok(
    result.debug?.runtimeCss?.entries.some(
      (entry) => entry.entrySourceFilePath === entrySourceFilePath,
    ),
    `expected runtime CSS entry ${entrySourceFilePath}`,
  );
}

function assertInitialRuntimeStylesheet(result, stylesheetFilePath) {
  assertRuntimeStylesheet(result, "initial", stylesheetFilePath);
}

function assertInitialRuntimeSource(result, sourceFilePath) {
  assertRuntimeSource(result, "initial", sourceFilePath);
}

function assertRuntimeStylesheet(result, loading, stylesheetFilePath) {
  assert.ok(
    result.debug?.runtimeCss?.chunks.some(
      (chunk) =>
        chunk.loading === loading && chunk.stylesheetFilePaths.includes(stylesheetFilePath),
    ),
    `expected ${loading} runtime stylesheet ${stylesheetFilePath}`,
  );
}

function assertRuntimeSource(result, loading, sourceFilePath) {
  assert.ok(
    result.debug?.runtimeCss?.chunks.some(
      (chunk) => chunk.loading === loading && chunk.sourceFilePaths.includes(sourceFilePath),
    ),
    `expected ${loading} runtime source ${sourceFilePath}`,
  );
}
