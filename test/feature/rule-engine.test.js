import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";

import {
  buildProjectModel,
  buildScanSummary,
  collateFindings,
  createFinding,
  extractProjectFacts,
  normalizeScanReactCssConfig,
  runRules,
  scanReactCss,
  sortFindings,
} from "../../dist/index.js";

async function withTempDir(run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "scan-react-css-rules-test-"));

  try {
    await writeProjectFile(
      tempDir,
      "package.json",
      '{\n  "name": "rule-engine-test",\n  "dependencies": {\n    "react": "^18.0.0"\n  }\n}\n',
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

test("finding creation and sorting follow the runtime contract order", () => {
  const findings = sortFindings([
    createFinding({
      ruleId: "b",
      family: "definition-and-usage-integrity",
      severity: "info",
      confidence: "low",
      message: "info finding",
      subject: { className: "zeta" },
    }),
    createFinding({
      ruleId: "a",
      family: "definition-and-usage-integrity",
      severity: "error",
      confidence: "medium",
      message: "error finding",
      subject: { className: "beta" },
    }),
    createFinding({
      ruleId: "c",
      family: "definition-and-usage-integrity",
      severity: "error",
      confidence: "high",
      message: "high confidence error",
      subject: { className: "alpha" },
    }),
  ]);

  assert.deepEqual(
    findings.map((finding) => [finding.severity, finding.confidence, finding.subject?.className]),
    [
      ["error", "high", "alpha"],
      ["error", "medium", "beta"],
      ["info", "low", "zeta"],
    ],
  );
});

test("scan summary counts severities deterministically", () => {
  const summary = buildScanSummary({
    sourceFileCount: 2,
    cssFileCount: 1,
    findings: [
      createFinding({
        ruleId: "a",
        family: "definition-and-usage-integrity",
        severity: "error",
        confidence: "high",
        message: "error",
      }),
      createFinding({
        ruleId: "b",
        family: "definition-and-usage-integrity",
        severity: "warning",
        confidence: "medium",
        message: "warning",
      }),
      createFinding({
        ruleId: "c",
        family: "definition-and-usage-integrity",
        severity: "info",
        confidence: "low",
        message: "info",
      }),
    ],
  });

  assert.deepEqual(summary, {
    fileCount: 3,
    sourceFileCount: 2,
    cssFileCount: 1,
    findingCount: 3,
    errorCount: 1,
    warningCount: 1,
    infoCount: 1,
    debugCount: 0,
  });
});

test("finding collation merges identical findings and preserves extra locations", () => {
  const findings = collateFindings([
    createFinding({
      ruleId: "missing-css-class",
      family: "definition-and-usage-integrity",
      severity: "warning",
      confidence: "high",
      message:
        'Class "world-members-page" is referenced in React code but no matching reachable CSS class definition was found.',
      primaryLocation: {
        filePath: "src/pages/WorldMembersPage.tsx",
        line: 20,
        column: 5,
      },
      subject: {
        className: "world-members-page",
        sourceFilePath: "src/pages/WorldMembersPage.tsx",
      },
      metadata: {
        referenceKind: "string-literal",
      },
    }),
    createFinding({
      ruleId: "missing-css-class",
      family: "definition-and-usage-integrity",
      severity: "warning",
      confidence: "high",
      message:
        'Class "world-members-page" is referenced in React code but no matching reachable CSS class definition was found.',
      primaryLocation: {
        filePath: "src/pages/WorldMembersPage.tsx",
        line: 42,
        column: 9,
      },
      subject: {
        className: "world-members-page",
        sourceFilePath: "src/pages/WorldMembersPage.tsx",
      },
      metadata: {
        referenceKind: "string-literal",
      },
    }),
  ]);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].primaryLocation?.line, 20);
  assert.deepEqual(findings[0].relatedLocations, [
    {
      filePath: "src/pages/WorldMembersPage.tsx",
      line: 42,
      column: 9,
    },
  ]);
  assert.equal(findings[0].metadata.aggregateOccurrenceCount, 2);
});

test("finding collation keeps distinct findings separate when their messages or metadata differ", () => {
  const findings = collateFindings([
    createFinding({
      ruleId: "missing-css-class",
      family: "definition-and-usage-integrity",
      severity: "warning",
      confidence: "high",
      message:
        'Class "title-pane" is referenced in React code but no matching reachable CSS class definition was found.',
      primaryLocation: {
        filePath: "src/pages/A.tsx",
        line: 10,
      },
      subject: {
        className: "title-pane",
        sourceFilePath: "src/pages/A.tsx",
      },
      metadata: {
        referenceKind: "string-literal",
      },
    }),
    createFinding({
      ruleId: "missing-css-class",
      family: "definition-and-usage-integrity",
      severity: "warning",
      confidence: "high",
      message:
        'Class "title-pane" is referenced in React code but no matching reachable CSS class definition was found.',
      primaryLocation: {
        filePath: "src/pages/B.tsx",
        line: 10,
      },
      subject: {
        className: "title-pane",
        sourceFilePath: "src/pages/B.tsx",
      },
      metadata: {
        referenceKind: "helper-call",
      },
    }),
  ]);

  assert.equal(findings.length, 2);
  assert.ok(findings.every((finding) => finding.metadata.aggregateOccurrenceCount === undefined));
});

test("rule engine runs registered rules against the project model without rereading files", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      'export function App() { return <div className="button" />; }',
    );
    await writeProjectFile(tempDir, "src/App.css", ".button {}");

    const config = normalizeScanReactCssConfig({});
    const facts = await extractProjectFacts(config, tempDir);
    const model = buildProjectModel({ config, facts });
    let invocations = 0;

    const result = runRules(model, [
      {
        ruleId: "test-rule",
        family: "definition-and-usage-integrity",
        defaultSeverity: "info",
        run(context) {
          invocations += 1;
          return [
            context.createFinding({
              ruleId: "test-rule",
              family: "definition-and-usage-integrity",
              severity: "info",
              confidence: "high",
              message: "test finding",
              primaryLocation: {
                filePath: model.graph.sourceFiles[0].path,
              },
              subject: {
                className: "button",
              },
            }),
          ];
        },
      },
    ]);

    assert.equal(invocations, 1);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].ruleId, "test-rule");
  });
});

test("scanReactCss returns the structured runtime shape even before default rules emit findings", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(tempDir, "src/App.tsx", "export function App() { return null; }");
    await writeProjectFile(tempDir, "src/App.css", "");

    const result = await scanReactCss({ targetPath: tempDir });

    assert.equal(result.config.rootDir, ".");
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.summary, {
      fileCount: 2,
      sourceFileCount: 1,
      cssFileCount: 1,
      findingCount: 0,
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      debugCount: 0,
    });
  });
});

test("scanReactCss collates repeated findings before returning the runtime result", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      [
        "export function App() {",
        "  return (",
        "    <>",
        '      <div className="missing" />',
        '      <section className="missing" />',
        "    </>",
        "  );",
        "}",
      ].join("\n"),
    );

    const result = await scanReactCss({ targetPath: tempDir });

    const finding = result.findings.find(
      (entry) => entry.ruleId === "missing-css-class" && entry.subject?.className === "missing",
    );

    assert.ok(finding);
    assert.equal(result.findings.length, 1);
    assert.equal(finding.metadata.aggregateOccurrenceCount, 2);
    assert.equal(finding.primaryLocation?.filePath, "src/App.tsx");
    assert.equal(finding.primaryLocation?.line, 4);
    assert.deepEqual(
      finding.relatedLocations.map((location) => ({
        filePath: location.filePath,
        line: location.line,
      })),
      [
        {
          filePath: "src/App.tsx",
          line: 5,
        },
      ],
    );
  });
});
