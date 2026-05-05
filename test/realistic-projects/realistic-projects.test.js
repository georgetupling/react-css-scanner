import assert from "node:assert/strict";
import test from "node:test";

import { scanProject } from "../../dist/index.js";
import { createCraStorefrontProject } from "../support/realisticProjects/createCraStorefrontProject.js";

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
    assert.equal(result.summary.findingsByRule["dynamic-class-reference"], 7);
    assert.equal(result.summary.findingsByRule["unsupported-syntax-affecting-analysis"], 5);
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
  assert.ok(
    result.debug?.runtimeCss?.chunks.some(
      (chunk) =>
        chunk.loading === "initial" && chunk.stylesheetFilePaths.includes(stylesheetFilePath),
    ),
    `expected initial runtime stylesheet ${stylesheetFilePath}`,
  );
}

function assertInitialRuntimeSource(result, sourceFilePath) {
  assert.ok(
    result.debug?.runtimeCss?.chunks.some(
      (chunk) => chunk.loading === "initial" && chunk.sourceFilePaths.includes(sourceFilePath),
    ),
    `expected initial runtime source ${sourceFilePath}`,
  );
}
