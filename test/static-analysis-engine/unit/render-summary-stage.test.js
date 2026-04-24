import test from "node:test";
import assert from "node:assert/strict";

import {
  runProjectModuleGraphStage,
  runProjectParseStage,
  runProjectSymbolResolutionStage,
} from "../../../dist/static-analysis-engine/entry/stages/basicStages.js";
import { runProjectRenderGraphStage } from "../../../dist/static-analysis-engine/entry/stages/renderGraphStage.js";
import { runProjectRenderIrStage } from "../../../dist/static-analysis-engine/entry/stages/renderIrStage.js";
import { runProjectRenderSummaryStage } from "../../../dist/static-analysis-engine/entry/stages/renderSummaryStage.js";

test("static analysis engine publishes explicit project render-summary inputs for downstream render stages", () => {
  const parseStage = runProjectParseStage([
    {
      filePath: "src/Layout.tsx",
      sourceText: [
        "export function Layout({ children }: { children: React.ReactNode }) {",
        '  return <section className="layout">{children}</section>;',
        "}",
      ].join("\n"),
    },
    {
      filePath: "src/helpers.tsx",
      sourceText: [
        "export function renderTitle() {",
        '  return <h1 className="layout__title" />;',
        "}",
      ].join("\n"),
    },
    {
      filePath: "src/App.tsx",
      sourceText: [
        'import { Layout } from "./Layout";',
        'import { renderTitle } from "./helpers";',
        "export function App() {",
        "  return <Layout>{renderTitle()}</Layout>;",
        "}",
      ].join("\n"),
    },
  ]);
  const moduleGraphStage = runProjectModuleGraphStage({
    parsedFiles: parseStage.parsedFiles,
  });
  const symbolResolutionStage = runProjectSymbolResolutionStage({
    parsedFiles: parseStage.parsedFiles,
    moduleGraph: moduleGraphStage.moduleGraph,
  });
  const renderSummaryStage = runProjectRenderSummaryStage({
    parsedFiles: parseStage.parsedFiles,
    symbolResolution: symbolResolutionStage,
  });

  const appComponents = renderSummaryStage.renderGraphInput.componentsByFilePath.get("src/App.tsx");
  assert.ok(appComponents);
  assert.equal(appComponents.get("Layout")?.componentName, "Layout");

  const appHelperDefinitions =
    renderSummaryStage.renderIrInput.importedHelperDefinitionsByFilePath.get("src/App.tsx");
  assert.ok(appHelperDefinitions);
  assert.ok(appHelperDefinitions.has("renderTitle"));

  const renderGraphStage = runProjectRenderGraphStage(renderSummaryStage.renderGraphInput);
  assert.deepEqual(
    renderGraphStage.renderGraph.edges.map((edge) => [
      edge.fromComponentName,
      edge.toComponentName,
      edge.toFilePath,
    ]),
    [["App", "Layout", "src/Layout.tsx"]],
  );

  const renderIrStage = runProjectRenderIrStage(renderSummaryStage.renderIrInput);
  const appSubtree = renderIrStage.renderSubtrees.find(
    (subtree) => subtree.componentName === "App",
  );
  assert.ok(appSubtree);
  assert.equal(appSubtree.root.kind, "element");
  assert.equal(appSubtree.root.tagName, "section");
  assert.ok(collectElementTagNames(appSubtree.root).includes("h1"));
});

function collectElementTagNames(node) {
  switch (node.kind) {
    case "element":
      return [node.tagName, ...node.children.flatMap(collectElementTagNames)];
    case "fragment":
      return node.children.flatMap(collectElementTagNames);
    case "conditional":
      return [...collectElementTagNames(node.whenTrue), ...collectElementTagNames(node.whenFalse)];
    case "repeated-region":
      return collectElementTagNames(node.template);
    default:
      return [];
  }
}
