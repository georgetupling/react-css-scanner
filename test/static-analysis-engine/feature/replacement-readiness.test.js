import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { TestProjectBuilder } from "../../support/TestProjectBuilder.js";
import {
  analyzeProjectSourceTexts,
  runExperimentalSelectorPilotAgainstCurrentScanner,
} from "../../../dist/static-analysis-engine.js";

async function withHttpServer(handler, run) {
  const server = http.createServer(handler);

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to start test HTTP server.");
  }

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(undefined);
      });
    });
  }
}

test("static analysis engine feature validation tracks definite stylesheet reachability through component composition", async () => {
  const project = await new TestProjectBuilder()
    .withTemplate("basic-react-app")
    .withSourceFile(
      "src/LayoutShell.tsx",
      [
        'import "./LayoutShell.css";',
        "export function LayoutShell({ children }: { children: React.ReactNode }) {",
        '  return <section className="layout-shell">{children}</section>;',
        "}",
      ].join("\n"),
    )
    .withSourceFile(
      "src/App.tsx",
      [
        'import { LayoutShell } from "./LayoutShell";',
        "export function App() {",
        '  return <LayoutShell><h1 className="page-title" /></LayoutShell>;',
        "}",
      ].join("\n"),
    )
    .withCssFile("src/LayoutShell.css", ".layout-shell .page-title { width: 100%; }\n")
    .build();

  try {
    const result = analyzeProjectSourceTexts(await loadStaticAnalysisProjectInputs(project));
    const [selectorResult] = result.selectorQueryResults;

    assert.equal(result.reachabilitySummary.stylesheets.length, 1);
    assert.equal(result.reachabilitySummary.stylesheets[0].availability, "definite");
    assert.equal(selectorResult.outcome, "match");
    assert.equal(selectorResult.status, "resolved");
    assert.equal(selectorResult.confidence, "high");
    assert.equal(selectorResult.reachability?.availability, "definite");

    const appContext = result.reachabilitySummary.stylesheets[0].contexts.find(
      (contextRecord) =>
        contextRecord.context.kind === "component" &&
        contextRecord.context.filePath === "src/App.tsx" &&
        contextRecord.context.componentName === "App",
    );
    assert.equal(appContext?.availability, "definite");
    assert.ok(
      appContext?.reasons.some(
        (reason) =>
          reason.includes("LayoutShell") && reason.includes("definite stylesheet availability"),
      ),
    );
  } finally {
    await project.cleanup();
  }
});

test("static analysis engine feature validation records possible selector satisfaction and shadow-mode comparison for conditional composition", async () => {
  const project = await new TestProjectBuilder()
    .withTemplate("basic-react-app")
    .withSourceFile(
      "src/LayoutShell.tsx",
      [
        'import "./LayoutShell.css";',
        "export function LayoutShell({ children }: { children: React.ReactNode }) {",
        '  return <section className="layout-shell">{children}</section>;',
        "}",
      ].join("\n"),
    )
    .withSourceFile(
      "src/App.tsx",
      [
        'import { LayoutShell } from "./LayoutShell";',
        "export function App({ showTitle }: { showTitle: boolean }) {",
        '  return showTitle ? <LayoutShell><h1 className="page-title" /></LayoutShell> : <main className="page-title" />;',
        "}",
      ].join("\n"),
    )
    .withCssFile("src/LayoutShell.css", ".layout-shell .page-title { width: 100%; }\n")
    .build();

  try {
    const result = analyzeProjectSourceTexts(await loadStaticAnalysisProjectInputs(project));
    const [selectorResult] = result.selectorQueryResults;

    assert.equal(result.reachabilitySummary.stylesheets.length, 1);
    assert.equal(result.reachabilitySummary.stylesheets[0].availability, "definite");
    assert.equal(selectorResult.outcome, "possible-match");
    assert.equal(selectorResult.status, "resolved");
    assert.equal(selectorResult.confidence, "medium");
    assert.equal(selectorResult.reachability?.availability, "possible");
    assert.ok(
      selectorResult.reachability?.matchedContexts?.some(
        (contextRecord) =>
          contextRecord.context.kind === "render-region" &&
          contextRecord.context.filePath === "src/App.tsx" &&
          contextRecord.context.componentName === "App" &&
          contextRecord.context.regionKind === "conditional-branch",
      ),
    );
    assert.ok(
      result.experimentalRuleResults.some(
        (ruleResult) => ruleResult.ruleId === "selector-possibly-satisfied",
      ),
    );

    const artifact = await runExperimentalSelectorPilotAgainstCurrentScanner({
      cwd: project.rootDir,
    });

    assert.equal(artifact.comparisonResult.summary.matchedCount, 0);
    assert.equal(artifact.comparisonResult.summary.experimentalOnlyCount, 1);
    assert.equal(artifact.comparisonResult.summary.baselineOnlyCount, 2);
    assert.deepEqual(artifact.comparisonResult.summary.experimentalRuleIds, [
      "selector-possibly-satisfied",
    ]);
    assert.deepEqual(artifact.comparisonResult.summary.baselineRuleIds, ["missing-css-class"]);
    assert.ok(
      artifact.comparisonResult.comparison.experimentalOnly.some(
        (finding) => finding.ruleId === "selector-possibly-satisfied",
      ),
    );
    assert.equal(
      artifact.comparisonResult.comparison.baselineOnly.filter(
        (finding) => finding.ruleId === "missing-css-class",
      ).length,
      2,
    );
  } finally {
    await project.cleanup();
  }
});

test("static analysis engine feature validation preserves unknown stylesheet reachability barrier contexts from unsupported cross-file helper expansion", async () => {
  const project = await new TestProjectBuilder()
    .withTemplate("basic-react-app")
    .withSourceFile(
      "src/LayoutShell.tsx",
      [
        'import "./LayoutShell.css";',
        "export function LayoutShell({ children }: { children: React.ReactNode }) {",
        '  return <section className="layout-shell">{children}</section>;',
        "}",
      ].join("\n"),
    )
    .withSourceFile(
      "src/helpers.tsx",
      [
        'import { LayoutShell } from "./LayoutShell";',
        "export function renderLayout(mode: string) {",
        '  return <LayoutShell><h1 className="page-title" /></LayoutShell>;',
        "}",
      ].join("\n"),
    )
    .withSourceFile(
      "src/App.tsx",
      [
        'import { renderLayout } from "./helpers";',
        "export function App({ showLayout }: { showLayout: boolean }) {",
        '  return showLayout ? renderLayout() : <main className="page-title" />;',
        "}",
      ].join("\n"),
    )
    .withCssFile("src/LayoutShell.css", ".layout-shell .page-title { width: 100%; }\n")
    .build();

  try {
    const result = analyzeProjectSourceTexts(await loadStaticAnalysisProjectInputs(project));
    const [selectorResult] = result.selectorQueryResults;

    assert.equal(result.reachabilitySummary.stylesheets.length, 1);
    assert.equal(result.reachabilitySummary.stylesheets[0].availability, "definite");
    assert.equal(selectorResult.outcome, "match");
    assert.equal(selectorResult.status, "resolved");
    assert.equal(selectorResult.confidence, "high");
    assert.equal(selectorResult.reachability?.availability, "definite");

    const appUnknownContext = result.reachabilitySummary.stylesheets[0].contexts.find(
      (contextRecord) =>
        contextRecord.context.kind === "component" &&
        contextRecord.context.filePath === "src/App.tsx" &&
        contextRecord.context.componentName === "App" &&
        contextRecord.availability === "unknown",
    );
    assert.equal(appUnknownContext?.availability, "unknown");
    assert.deepEqual(appUnknownContext?.derivations, [
      {
        kind: "whole-component-unknown-barrier",
        reason: "cross-file-helper-expansion-unsupported-arguments",
      },
    ]);

    const unknownBranchContext = result.reachabilitySummary.stylesheets[0].contexts.find(
      (contextRecord) =>
        contextRecord.context.kind === "render-region" &&
        contextRecord.context.filePath === "src/App.tsx" &&
        contextRecord.context.componentName === "App" &&
        contextRecord.context.regionKind === "conditional-branch" &&
        contextRecord.availability === "unknown",
    );
    assert.equal(unknownBranchContext?.availability, "unknown");
    assert.deepEqual(unknownBranchContext?.derivations, [
      {
        kind: "render-region-unknown-barrier",
        reason: "cross-file-helper-expansion-unsupported-arguments",
      },
    ]);
  } finally {
    await project.cleanup();
  }
});

test("static analysis engine feature validation matches current-scanner external-css behavior for fetch-remote project-wide stylesheets", async () => {
  await withHttpServer(
    (request, response) => {
      if (request.url === "/remote.css") {
        response.writeHead(200, { "content-type": "text/css" });
        response.end(".btn { display: inline-block; }");
        return;
      }

      response.writeHead(404);
      response.end("not found");
    },
    async (serverBaseUrl) => {
      const project = await new TestProjectBuilder()
        .withTemplate("basic-react-app")
        .withFile(
          "index.html",
          [
            "<!doctype html>",
            "<html><head>",
            `<link rel="stylesheet" href="${serverBaseUrl}/remote.css" />`,
            '</head><body><div id="root"></div></body></html>',
          ].join("\n"),
        )
        .withSourceFile(
          "src/App.tsx",
          'export function App() { return <button className="btn ghost-btn">Save</button>; }\n',
        )
        .withConfig({
          externalCss: {
            mode: "fetch-remote",
          },
        })
        .build();

      try {
        const artifact = await runExperimentalSelectorPilotAgainstCurrentScanner({
          cwd: project.rootDir,
        });

        assert.ok(
          artifact.experimentalRuleResults.some(
            (ruleResult) =>
              ruleResult.ruleId === "missing-external-css-class" &&
              ruleResult.metadata?.className === "ghost-btn",
          ),
        );
        assert.equal(artifact.comparisonResult.summary.matchedCount, 1);
        assert.equal(artifact.comparisonResult.summary.baselineOnlyCount, 0);
        assert.ok(
          artifact.comparisonResult.comparison.matched.some(
            (entry) =>
              entry.experimental.ruleId === "missing-external-css-class" &&
              entry.baseline.ruleId === "missing-external-css-class" &&
              entry.baseline.subject?.className === "ghost-btn",
          ),
        );
      } finally {
        await project.cleanup();
      }
    },
  );
});

async function loadStaticAnalysisProjectInputs(project) {
  const filePaths = await project.listFiles();
  const sourcePaths = filePaths.filter(
    (filePath) =>
      filePath.startsWith("src/") &&
      (filePath.endsWith(".ts") ||
        filePath.endsWith(".tsx") ||
        filePath.endsWith(".js") ||
        filePath.endsWith(".jsx")),
  );
  const cssPaths = filePaths.filter(
    (filePath) => filePath.startsWith("src/") && filePath.endsWith(".css"),
  );

  const [sourceFiles, selectorCssSources] = await Promise.all([
    Promise.all(
      sourcePaths.map(async (filePath) => ({
        filePath,
        sourceText: await project.readFile(filePath),
      })),
    ),
    Promise.all(
      cssPaths.map(async (filePath) => ({
        filePath,
        cssText: await project.readFile(filePath),
      })),
    ),
  ]);

  return {
    sourceFiles,
    selectorCssSources,
  };
}
