import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeProjectSourceTexts,
  analyzeSourceText,
} from "../../../dist/static-analysis-engine.js";

test("static analysis engine builds a same-file render subtree for intrinsic JSX", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "export function App() {",
      '  return <section className="app-shell"><h1 className="app-title" /></section>;',
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 1);
  assert.equal(result.renderSubtrees[0].componentName, "App");
  assert.equal(result.renderSubtrees[0].root.kind, "element");
  assert.equal(result.renderSubtrees[0].root.tagName, "section");
  assert.deepEqual(result.renderSubtrees[0].root.className?.classes.definite, ["app-shell"]);
  assert.equal(result.renderSubtrees[0].root.children.length, 1);
  assert.equal(result.renderSubtrees[0].root.children[0].kind, "element");
  assert.equal(result.renderSubtrees[0].root.children[0].tagName, "h1");
});

test("static analysis engine preserves conditional render branches in the subtree IR", () => {
  const result = analyzeSourceText({
    filePath: "src/Panel.tsx",
    sourceText: [
      "export function Panel({ isOpen }: { isOpen: boolean }) {",
      '  return isOpen ? <section className="panel is-open" /> : <section className="panel" />;',
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 1);
  assert.equal(result.renderSubtrees[0].root.kind, "conditional");
  assert.equal(result.renderSubtrees[0].root.conditionSourceText, "isOpen");
  assert.equal(result.renderSubtrees[0].root.whenTrue.kind, "element");
  assert.deepEqual(result.renderSubtrees[0].root.whenTrue.className?.classes.definite, [
    "panel",
    "is-open",
  ]);
  assert.equal(result.renderSubtrees[0].root.whenFalse.kind, "element");
});

test("static analysis engine expands simple same-file local component references", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function Child() {",
      '  return <div className="child" />;',
      "}",
      "export function App() {",
      "  return <Child />;",
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].componentName, "App");
  assert.equal(result.renderSubtrees[1].root.kind, "element");
  assert.equal(result.renderSubtrees[1].root.tagName, "div");
  assert.deepEqual(result.renderSubtrees[1].root.className?.classes.definite, ["child"]);
});

test("static analysis engine expands same-file wrappers that insert children", () => {
  const result = analyzeSourceText({
    filePath: "src/PanelPage.tsx",
    sourceText: [
      "function PanelShell({ children }: { children: React.ReactNode }) {",
      '  return <section className="panel-shell">{children}</section>;',
      "}",
      "export function PanelPage() {",
      '  return <PanelShell><h1 className="panel-shell__title" /></PanelShell>;',
      "}",
    ].join("\n"),
    selectorQueries: [".panel-shell .panel-shell__title"],
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].componentName, "PanelPage");
  assert.equal(result.renderSubtrees[1].root.kind, "element");
  assert.equal(result.renderSubtrees[1].root.tagName, "section");
  assert.deepEqual(result.renderSubtrees[1].root.className?.classes.definite, ["panel-shell"]);
  assert.equal(result.renderSubtrees[1].root.children.length, 1);
  assert.equal(result.renderSubtrees[1].root.children[0].kind, "fragment");
  assert.equal(result.selectorQueryResults.length, 1);
  assert.equal(result.selectorQueryResults[0].outcome, "match");
});

test("static analysis engine expands same-file local components with named JSX subtree props", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function Layout({ header, footer }: { header: React.ReactNode; footer: React.ReactNode }) {",
      '  return <section className="layout">{header}<main className="layout__body" />{footer}</section>;',
      "}",
      "export function App() {",
      '  return <Layout header={<h1 className="layout__header" />} footer={<div className="layout__footer" />} />;',
      "}",
    ].join("\n"),
    selectorQueries: [".layout .layout__header", ".layout .layout__footer"],
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].componentName, "App");
  assert.equal(result.renderSubtrees[1].root.kind, "element");
  assert.equal(result.renderSubtrees[1].root.tagName, "section");
  assert.equal(result.renderSubtrees[1].root.children.length, 3);
  assert.equal(result.renderSubtrees[1].root.children[0].kind, "fragment");
  assert.equal(result.renderSubtrees[1].root.children[2].kind, "fragment");
  assert.equal(result.selectorQueryResults[0].outcome, "match");
  assert.equal(result.selectorQueryResults[1].outcome, "match");
});

test("static analysis engine expands props-identifier subtree props through property access", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function Layout(props: { header: React.ReactNode }) {",
      '  return <section className="layout">{props.header}</section>;',
      "}",
      "export function App() {",
      '  return <Layout header={<h1 className="layout__header" />} />;',
      "}",
    ].join("\n"),
    selectorQueries: [".layout .layout__header"],
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].componentName, "App");
  assert.equal(result.renderSubtrees[1].root.kind, "element");
  assert.equal(result.renderSubtrees[1].root.tagName, "section");
  assert.equal(result.renderSubtrees[1].root.children.length, 1);
  assert.equal(result.renderSubtrees[1].root.children[0].kind, "fragment");
  assert.equal(result.selectorQueryResults[0].outcome, "match");
});

test("static analysis engine expands direct imported components across files", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/PanelShell.tsx",
        sourceText: [
          "export function PanelShell({ children }: { children: React.ReactNode }) {",
          '  return <section className="panel-shell">{children}</section>;',
          "}",
        ].join("\n"),
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import { PanelShell } from "./PanelShell";',
          "export function App() {",
          '  return <PanelShell><h1 className="panel-shell__title" /></PanelShell>;',
          "}",
        ].join("\n"),
      },
    ],
    selectorQueries: [".panel-shell .panel-shell__title"],
  });

  const appSubtree = result.renderSubtrees.find((subtree) => subtree.componentName === "App");
  assert.ok(appSubtree);
  assert.equal(appSubtree.root.kind, "element");
  assert.equal(appSubtree.root.tagName, "section");
  assert.deepEqual(appSubtree.root.className?.classes.definite, ["panel-shell"]);
  assert.equal(result.selectorQueryResults.length, 1);
  assert.equal(result.selectorQueryResults[0].outcome, "match");
});

test("static analysis engine exposes a lightweight render graph for cross-file component composition", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/PanelShell.tsx",
        sourceText: [
          "export function PanelShell({ children }: { children: React.ReactNode }) {",
          '  return <section className="panel-shell">{children}</section>;',
          "}",
        ].join("\n"),
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import { PanelShell } from "./PanelShell";',
          "export function App() {",
          '  return <PanelShell><h1 className="panel-shell__title" /></PanelShell>;',
          "}",
        ].join("\n"),
      },
    ],
  });

  assert.deepEqual(
    result.renderGraph.nodes.map((node) => `${node.filePath}:${node.componentName}`),
    ["src/App.tsx:App", "src/PanelShell.tsx:PanelShell"],
  );
  assert.equal(result.renderGraph.edges.length, 1);
  assert.equal(result.renderGraph.edges[0].fromComponentName, "App");
  assert.equal(result.renderGraph.edges[0].toComponentName, "PanelShell");
  assert.equal(result.renderGraph.edges[0].toFilePath, "src/PanelShell.tsx");
  assert.equal(result.renderGraph.edges[0].resolution, "resolved");
  assert.equal(result.renderGraph.edges[0].traversal, "direct-jsx");
  assert.equal(result.renderGraph.edges[0].renderPath, "definite");
  assert.deepEqual(result.renderGraph.edges[0].traces, [
    {
      traceId: "render-graph:edge:src/App.tsx:App:PanelShell:definite:resolved",
      category: "render-graph",
      summary: "resolved render edge App -> PanelShell",
      anchor: {
        filePath: "src/App.tsx",
        startLine: 3,
        startColumn: 11,
        endLine: 3,
        endColumn: 21,
      },
      children: [
        {
          traceId: "symbol-resolution:direct-export:src/PanelShell.tsx:PanelShell",
          category: "symbol-resolution",
          summary: "resolved export PanelShell directly from src/PanelShell.tsx",
          anchor: {
            filePath: "src/App.tsx",
            startLine: 1,
            startColumn: 10,
            endLine: 1,
            endColumn: 20,
          },
          children: [],
          metadata: {
            exportedName: "PanelShell",
            filePath: "src/PanelShell.tsx",
            resolution: "direct-export",
          },
        },
      ],
      metadata: {
        fromComponentName: "App",
        fromFilePath: "src/App.tsx",
        toComponentName: "PanelShell",
        toFilePath: "src/PanelShell.tsx",
        resolution: "resolved",
        renderPath: "definite",
        traversal: "direct-jsx",
      },
    },
  ]);
});

test("static analysis engine expands multi-hop imported wrapper components across files", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/base.tsx",
        sourceText: [
          "export function PanelShell({ children }: { children: React.ReactNode }) {",
          '  return <section className="panel-shell">{children}</section>;',
          "}",
        ].join("\n"),
      },
      {
        filePath: "src/layout.tsx",
        sourceText: [
          'import { PanelShell } from "./base";',
          "export function LayoutShell({ children }: { children: React.ReactNode }) {",
          '  return <PanelShell><div className="layout-shell">{children}</div></PanelShell>;',
          "}",
        ].join("\n"),
      },
      {
        filePath: "src/page.tsx",
        sourceText: [
          'import { LayoutShell } from "./layout";',
          "export function PageShell({ children }: { children: React.ReactNode }) {",
          '  return <LayoutShell><main className="page-shell">{children}</main></LayoutShell>;',
          "}",
        ].join("\n"),
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import { PageShell } from "./page";',
          "export function App() {",
          '  return <PageShell><h1 className="page-title" /></PageShell>;',
          "}",
        ].join("\n"),
      },
    ],
    selectorQueries: [
      ".panel-shell .page-title",
      ".layout-shell .page-title",
      ".page-shell .page-title",
    ],
  });

  const appSubtree = result.renderSubtrees.find((subtree) => subtree.componentName === "App");
  assert.ok(appSubtree);
  assert.equal(appSubtree.root.kind, "element");
  assert.equal(result.selectorQueryResults.length, 3);
  assert.equal(result.selectorQueryResults[0].outcome, "match");
  assert.equal(result.selectorQueryResults[1].outcome, "match");
  assert.equal(result.selectorQueryResults[2].outcome, "match");
});

test("static analysis engine resolves imported constant class bindings across files", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/theme.ts",
        sourceText: 'export const panelClasses = "panel is-open";',
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import { panelClasses } from "./theme";',
          "export function App() {",
          "  return <section className={panelClasses} />;",
          "}",
        ].join("\n"),
      },
    ],
  });

  const appSubtree = result.renderSubtrees.find((subtree) => subtree.componentName === "App");
  assert.ok(appSubtree);
  assert.equal(appSubtree.root.kind, "element");
  assert.deepEqual(appSubtree.root.className?.classes.definite, ["panel", "is-open"]);
});

test("static analysis engine resolves imported object-literal class bindings across files", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/theme.ts",
        sourceText: 'export const panelClasses = { open: "panel is-open" };',
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import { panelClasses } from "./theme";',
          "export function App() {",
          "  return <section className={panelClasses.open} />;",
          "}",
        ].join("\n"),
      },
    ],
  });

  const appSubtree = result.renderSubtrees.find((subtree) => subtree.componentName === "App");
  assert.ok(appSubtree);
  assert.equal(appSubtree.root.kind, "element");
  assert.deepEqual(appSubtree.root.className?.classes.definite, ["panel", "is-open"]);
});

test("static analysis engine resolves imported constant branch conditions across files", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/flags.ts",
        sourceText: "export const isOpen = true;",
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import { isOpen } from "./flags";',
          "export function App() {",
          '  return isOpen ? <section className="panel is-open" /> : <section className="panel" />;',
          "}",
        ].join("\n"),
      },
    ],
  });

  const appSubtree = result.renderSubtrees.find((subtree) => subtree.componentName === "App");
  assert.ok(appSubtree);
  assert.equal(appSubtree.root.kind, "element");
  assert.deepEqual(appSubtree.root.className?.classes.definite, ["panel", "is-open"]);
});

test("static analysis engine resolves imported object-literal branch conditions across files", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/flags.ts",
        sourceText: "export const panelFlags = { isOpen: true };",
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import { panelFlags } from "./flags";',
          "export function App() {",
          '  return panelFlags.isOpen ? <section className="panel is-open" /> : <section className="panel" />;',
          "}",
        ].join("\n"),
      },
    ],
  });

  const appSubtree = result.renderSubtrees.find((subtree) => subtree.componentName === "App");
  assert.ok(appSubtree);
  assert.equal(appSubtree.root.kind, "element");
  assert.deepEqual(appSubtree.root.className?.classes.definite, ["panel", "is-open"]);
});

test("static analysis engine resolves imported helper class bindings across files", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/theme.ts",
        sourceText: ["export function getPanelClasses() {", '  return "panel is-open";', "}"].join(
          "\n",
        ),
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import { getPanelClasses } from "./theme";',
          "export function App() {",
          "  return <section className={getPanelClasses()} />;",
          "}",
        ].join("\n"),
      },
    ],
  });

  const appSubtree = result.renderSubtrees.find((subtree) => subtree.componentName === "App");
  assert.ok(appSubtree);
  assert.equal(appSubtree.root.kind, "element");
  assert.deepEqual(appSubtree.root.className?.classes.definite, ["panel", "is-open"]);
});

test("static analysis engine resolves imported helper branch conditions across files", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/flags.ts",
        sourceText: ["export function shouldRenderOpen() {", "  return true;", "}"].join("\n"),
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import { shouldRenderOpen } from "./flags";',
          "export function App() {",
          '  return shouldRenderOpen() ? <section className="panel is-open" /> : <section className="panel" />;',
          "}",
        ].join("\n"),
      },
    ],
  });

  const appSubtree = result.renderSubtrees.find((subtree) => subtree.componentName === "App");
  assert.ok(appSubtree);
  assert.equal(appSubtree.root.kind, "element");
  assert.deepEqual(appSubtree.root.className?.classes.definite, ["panel", "is-open"]);
});

test("static analysis engine resolves imported helper JSX branches across files", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/view.tsx",
        sourceText: [
          "export function renderTitle() {",
          '  return <h1 className="panel-shell__title" />;',
          "}",
        ].join("\n"),
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import { renderTitle } from "./view";',
          "export function App() {",
          '  return <section className="panel-shell">{renderTitle()}</section>;',
          "}",
        ].join("\n"),
      },
    ],
    selectorQueries: [".panel-shell .panel-shell__title"],
  });

  const appSubtree = result.renderSubtrees.find((subtree) => subtree.componentName === "App");
  assert.ok(appSubtree);
  assert.equal(appSubtree.root.kind, "element");
  assert.equal(appSubtree.root.children.length, 1);
  assert.equal(appSubtree.root.children[0].kind, "element");
  assert.equal(result.selectorQueryResults.length, 1);
  assert.equal(result.selectorQueryResults[0].outcome, "match");
});

test("static analysis engine expands default-imported components across files", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/PanelShell.tsx",
        sourceText: [
          "function PanelShell({ children }: { children: React.ReactNode }) {",
          '  return <section className="panel-shell">{children}</section>;',
          "}",
          "export default PanelShell;",
        ].join("\n"),
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import PanelShell from "./PanelShell";',
          "export function App() {",
          '  return <PanelShell><h1 className="panel-shell__title" /></PanelShell>;',
          "}",
        ].join("\n"),
      },
    ],
    selectorQueries: [".panel-shell .panel-shell__title"],
  });

  const appSubtree = result.renderSubtrees.find((subtree) => subtree.componentName === "App");
  assert.ok(appSubtree);
  assert.equal(appSubtree.root.kind, "element");
  assert.equal(appSubtree.root.tagName, "section");
  assert.equal(result.selectorQueryResults[0].outcome, "match");
});

test("static analysis engine resolves default-imported constant class bindings across files", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/theme.ts",
        sourceText: 'export default "panel is-open";',
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import panelClasses from "./theme";',
          "export function App() {",
          "  return <section className={panelClasses} />;",
          "}",
        ].join("\n"),
      },
    ],
  });

  const appSubtree = result.renderSubtrees.find((subtree) => subtree.componentName === "App");
  assert.ok(appSubtree);
  assert.equal(appSubtree.root.kind, "element");
  assert.deepEqual(appSubtree.root.className?.classes.definite, ["panel", "is-open"]);
});

test("static analysis engine resolves default-imported helper branches across files", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/flags.ts",
        sourceText: [
          "function shouldRenderOpen() {",
          "  return true;",
          "}",
          "export default shouldRenderOpen;",
        ].join("\n"),
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import shouldRenderOpen from "./flags";',
          "export function App() {",
          '  return shouldRenderOpen() ? <section className="panel is-open" /> : <section className="panel" />;',
          "}",
        ].join("\n"),
      },
    ],
  });

  const appSubtree = result.renderSubtrees.find((subtree) => subtree.componentName === "App");
  assert.ok(appSubtree);
  assert.equal(appSubtree.root.kind, "element");
  assert.deepEqual(appSubtree.root.className?.classes.definite, ["panel", "is-open"]);
});

test("static analysis engine resolves transitive imported constant bindings across files", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/base.ts",
        sourceText: 'export const panelClasses = "panel is-open";',
      },
      {
        filePath: "src/theme.ts",
        sourceText: [
          'import { panelClasses as baseClasses } from "./base";',
          "export const themedPanelClasses = baseClasses;",
        ].join("\n"),
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import { themedPanelClasses } from "./theme";',
          "export function App() {",
          "  return <section className={themedPanelClasses} />;",
          "}",
        ].join("\n"),
      },
    ],
  });

  const appSubtree = result.renderSubtrees.find((subtree) => subtree.componentName === "App");
  assert.ok(appSubtree);
  assert.equal(appSubtree.root.kind, "element");
  assert.deepEqual(appSubtree.root.className?.classes.definite, ["panel", "is-open"]);
});

test("static analysis engine resolves transitive imported helper branches across files", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/core.ts",
        sourceText: ["export function shouldRenderOpen() {", "  return true;", "}"].join("\n"),
      },
      {
        filePath: "src/flags.ts",
        sourceText: [
          'import { shouldRenderOpen as coreShouldRenderOpen } from "./core";',
          "export function isPanelOpen() {",
          "  return coreShouldRenderOpen();",
          "}",
        ].join("\n"),
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import { isPanelOpen } from "./flags";',
          "export function App() {",
          '  return isPanelOpen() ? <section className="panel is-open" /> : <section className="panel" />;',
          "}",
        ].join("\n"),
      },
    ],
  });

  const appSubtree = result.renderSubtrees.find((subtree) => subtree.componentName === "App");
  assert.ok(appSubtree);
  assert.equal(appSubtree.root.kind, "element");
  assert.deepEqual(appSubtree.root.className?.classes.definite, ["panel", "is-open"]);
});

test("static analysis engine resolves named re-exported components across files", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/base.tsx",
        sourceText: [
          "export function PanelShell({ children }: { children: React.ReactNode }) {",
          '  return <section className="panel-shell">{children}</section>;',
          "}",
        ].join("\n"),
      },
      {
        filePath: "src/index.ts",
        sourceText: 'export { PanelShell } from "./base";',
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import { PanelShell } from "./index";',
          "export function App() {",
          '  return <PanelShell><h1 className="panel-shell__title" /></PanelShell>;',
          "}",
        ].join("\n"),
      },
    ],
    selectorQueries: [".panel-shell .panel-shell__title"],
  });

  const appSubtree = result.renderSubtrees.find((subtree) => subtree.componentName === "App");
  assert.ok(appSubtree);
  assert.equal(appSubtree.root.kind, "element");
  assert.equal(result.selectorQueryResults[0].outcome, "match");
});

test("static analysis engine resolves named re-exported constant bindings across files", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/base.ts",
        sourceText: 'export const panelClasses = "panel is-open";',
      },
      {
        filePath: "src/theme.ts",
        sourceText: 'export { panelClasses } from "./base";',
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import { panelClasses } from "./theme";',
          "export function App() {",
          "  return <section className={panelClasses} />;",
          "}",
        ].join("\n"),
      },
    ],
  });

  const appSubtree = result.renderSubtrees.find((subtree) => subtree.componentName === "App");
  assert.ok(appSubtree);
  assert.deepEqual(appSubtree.root.className?.classes.definite, ["panel", "is-open"]);
});

test("static analysis engine resolves named re-exported helper branches across files", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/core.ts",
        sourceText: ["export function shouldRenderOpen() {", "  return true;", "}"].join("\n"),
      },
      {
        filePath: "src/flags.ts",
        sourceText: 'export { shouldRenderOpen } from "./core";',
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import { shouldRenderOpen } from "./flags";',
          "export function App() {",
          '  return shouldRenderOpen() ? <section className="panel is-open" /> : <section className="panel" />;',
          "}",
        ].join("\n"),
      },
    ],
  });

  const appSubtree = result.renderSubtrees.find((subtree) => subtree.componentName === "App");
  assert.ok(appSubtree);
  assert.equal(appSubtree.root.kind, "element");
  assert.deepEqual(appSubtree.root.className?.classes.definite, ["panel", "is-open"]);
});

test("static analysis engine resolves star re-exported constant bindings across files", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/base.ts",
        sourceText: 'export const panelClasses = "panel is-open";',
      },
      {
        filePath: "src/theme.ts",
        sourceText: 'export * from "./base";',
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import { panelClasses } from "./theme";',
          "export function App() {",
          "  return <section className={panelClasses} />;",
          "}",
        ].join("\n"),
      },
    ],
  });

  const appSubtree = result.renderSubtrees.find((subtree) => subtree.componentName === "App");
  assert.ok(appSubtree);
  assert.deepEqual(appSubtree.root.className?.classes.definite, ["panel", "is-open"]);
});

test("static analysis engine resolves namespace-imported constant bindings across files", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/theme.ts",
        sourceText: 'export const panelClasses = "panel is-open";',
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import * as theme from "./theme";',
          "export function App() {",
          "  return <section className={theme.panelClasses} />;",
          "}",
        ].join("\n"),
      },
    ],
  });

  const appSubtree = result.renderSubtrees.find((subtree) => subtree.componentName === "App");
  assert.ok(appSubtree);
  assert.deepEqual(appSubtree.root.className?.classes.definite, ["panel", "is-open"]);
});

test("static analysis engine resolves namespace-imported helper branches across files", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/flags.ts",
        sourceText: ["export function shouldRenderOpen() {", "  return true;", "}"].join("\n"),
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import * as flags from "./flags";',
          "export function App() {",
          '  return flags.shouldRenderOpen() ? <section className="panel is-open" /> : <section className="panel" />;',
          "}",
        ].join("\n"),
      },
    ],
  });

  const appSubtree = result.renderSubtrees.find((subtree) => subtree.componentName === "App");
  assert.ok(appSubtree);
  assert.equal(appSubtree.root.kind, "element");
  assert.deepEqual(appSubtree.root.className?.classes.definite, ["panel", "is-open"]);
});

test("static analysis engine resolves namespace-imported component references across files", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/ui.tsx",
        sourceText: [
          "export function PanelShell({ children }: { children: React.ReactNode }) {",
          '  return <section className="panel-shell">{children}</section>;',
          "}",
        ].join("\n"),
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import * as ui from "./ui";',
          "export function App() {",
          '  return <ui.PanelShell><h1 className="panel-shell__title" /></ui.PanelShell>;',
          "}",
        ].join("\n"),
      },
    ],
    selectorQueries: [".panel-shell .panel-shell__title"],
  });

  const appSubtree = result.renderSubtrees.find((subtree) => subtree.componentName === "App");
  assert.ok(appSubtree);
  assert.equal(appSubtree.root.kind, "element");
  assert.equal(result.selectorQueryResults[0].outcome, "match");
});

test("static analysis engine resolves named imports of namespace re-exports across files", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/ui.tsx",
        sourceText: [
          "export function PanelShell({ children }: { children: React.ReactNode }) {",
          '  return <section className="panel-shell">{children}</section>;',
          "}",
        ].join("\n"),
      },
      {
        filePath: "src/barrel.ts",
        sourceText: 'export * as ui from "./ui";',
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import { ui } from "./barrel";',
          "export function App() {",
          '  return <ui.PanelShell><h1 className="panel-shell__title" /></ui.PanelShell>;',
          "}",
        ].join("\n"),
      },
    ],
    selectorQueries: [".panel-shell .panel-shell__title"],
  });

  const appSubtree = result.renderSubtrees.find((subtree) => subtree.componentName === "App");
  assert.ok(appSubtree);
  assert.equal(appSubtree.root.kind, "element");
  assert.equal(result.selectorQueryResults[0].outcome, "match");
});

test("static analysis engine resolves named imports of namespace re-exported constants across files", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/theme.ts",
        sourceText: 'export const panelClasses = "panel is-open";',
      },
      {
        filePath: "src/barrel.ts",
        sourceText: 'export * as theme from "./theme";',
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import { theme } from "./barrel";',
          "export function App() {",
          "  return <section className={theme.panelClasses} />;",
          "}",
        ].join("\n"),
      },
    ],
  });

  const appSubtree = result.renderSubtrees.find((subtree) => subtree.componentName === "App");
  assert.ok(appSubtree);
  assert.deepEqual(appSubtree.root.className?.classes.definite, ["panel", "is-open"]);
});

test("static analysis engine preserves unresolved component references when local expansion is unsupported", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function Child({ title = 'fallback' }: { title?: string }) {",
      '  return <div className="child">{title}</div>;',
      "}",
      "export function App() {",
      "  return <Child />;",
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].componentName, "App");
  assert.equal(result.renderSubtrees[1].root.kind, "component-reference");
  assert.equal(result.renderSubtrees[1].root.componentName, "Child");
  assert.equal(
    result.renderSubtrees[1].root.reason,
    "same-file-component-expansion-unsupported:destructured-default-values",
  );
  assert.deepEqual(result.renderSubtrees[1].root.traces, [
    {
      traceId: "render-expansion:component-reference:unsupported",
      category: "render-expansion",
      summary:
        'stopped expanding component reference "Child" because prop or children binding is unsupported in the current bounded slice',
      anchor: {
        filePath: "src/App.tsx",
        startLine: 5,
        startColumn: 11,
        endLine: 5,
        endColumn: 16,
      },
      children: [],
      metadata: {
        componentName: "Child",
        reason: "same-file-component-expansion-unsupported:destructured-default-values",
      },
    },
  ]);
});

test("static analysis engine preserves explicit cross-file unsupported component outcomes", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/Child.tsx",
        sourceText: [
          "export function Child({ title = 'fallback' }: { title?: string }) {",
          '  return <div className="child">{title}</div>;',
          "}",
        ].join("\n"),
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import { Child } from "./Child";',
          "export function App() {",
          "  return <Child />;",
          "}",
        ].join("\n"),
      },
    ],
  });

  const appSubtree = result.renderSubtrees.find((subtree) => subtree.componentName === "App");
  assert.ok(appSubtree);
  assert.equal(appSubtree.root.kind, "component-reference");
  assert.equal(
    appSubtree.root.reason,
    "cross-file-component-expansion-unsupported:destructured-default-values",
  );
});

test("static analysis engine preserves unresolved component references when children are not consumed", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function Child() {",
      '  return <div className="child" />;',
      "}",
      "export function App() {",
      '  return <Child><span className="extra-child" /></Child>;',
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].root.kind, "component-reference");
  assert.equal(
    result.renderSubtrees[1].root.reason,
    "same-file-component-expansion-children-not-consumed",
  );
});

test("static analysis engine preserves unresolved component references when prop passing is unsupported", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function Child() {",
      '  return <div className="child" />;',
      "}",
      "export function App() {",
      '  return <Child tone="info" />;',
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].root.kind, "component-reference");
  assert.equal(
    result.renderSubtrees[1].root.reason,
    "same-file-component-expansion-unsupported-props",
  );
});

test("static analysis engine preserves explicit cross-file component expansion budget outcomes", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/D.tsx",
        sourceText: ["export function D() {", '  return <div className="level-d" />;', "}"].join(
          "\n",
        ),
      },
      {
        filePath: "src/C.tsx",
        sourceText: [
          'import { D } from "./D";',
          "export function C() {",
          "  return <D />;",
          "}",
        ].join("\n"),
      },
      {
        filePath: "src/B.tsx",
        sourceText: [
          'import { C } from "./C";',
          "export function B() {",
          "  return <C />;",
          "}",
        ].join("\n"),
      },
      {
        filePath: "src/A.tsx",
        sourceText: [
          'import { B } from "./B";',
          "export function A() {",
          "  return <B />;",
          "}",
        ].join("\n"),
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import { A } from "./A";',
          "export function App() {",
          "  return <A />;",
          "}",
        ].join("\n"),
      },
    ],
  });

  const appSubtree = result.renderSubtrees.find((subtree) => subtree.componentName === "App");
  assert.ok(appSubtree);
  assert.equal(appSubtree.root.kind, "component-reference");
  assert.equal(appSubtree.root.reason, "cross-file-component-expansion-budget-exceeded");
});

test("static analysis engine preserves unresolved component references when local expansion hits the depth budget", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function D() {",
      '  return <div className="level-d" />;',
      "}",
      "function C() {",
      "  return <D />;",
      "}",
      "function B() {",
      "  return <C />;",
      "}",
      "function A() {",
      "  return <B />;",
      "}",
      "export function App() {",
      "  return <A />;",
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 5);
  assert.equal(result.renderSubtrees[4].componentName, "App");
  assert.equal(result.renderSubtrees[4].root.kind, "component-reference");
  assert.equal(
    result.renderSubtrees[4].root.reason,
    "same-file-component-expansion-budget-exceeded",
  );
});

test("static analysis engine preserves unresolved component references when local expansion would cycle", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function Loop() {",
      "  return <Loop />;",
      "}",
      "export function App() {",
      "  return <Loop />;",
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].componentName, "App");
  assert.equal(result.renderSubtrees[1].root.kind, "component-reference");
  assert.equal(result.renderSubtrees[1].root.reason, "same-file-component-expansion-cycle");
});

test("static analysis engine preserves explicit helper expansion cycle outcomes", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function Panel() {",
      "  function renderPanel() {",
      "    return renderPanel();",
      "  }",
      "  return renderPanel();",
      "}",
      "export function App() {",
      "  return <Panel />;",
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].componentName, "App");
  assert.equal(result.renderSubtrees[1].root.kind, "unknown");
  assert.equal(result.renderSubtrees[1].root.reason, "same-file-helper-expansion-cycle");
});

test("static analysis engine preserves explicit helper expansion budget outcomes", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function Panel() {",
      "  function renderA() {",
      "    return renderB();",
      "  }",
      "  function renderB() {",
      "    return renderC();",
      "  }",
      "  function renderC() {",
      "    return renderD();",
      "  }",
      "  function renderD() {",
      '    return <section className="panel" />;',
      "  }",
      "  return renderA();",
      "}",
      "export function App() {",
      "  return <Panel />;",
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].componentName, "App");
  assert.equal(result.renderSubtrees[1].root.kind, "unknown");
  assert.equal(result.renderSubtrees[1].root.reason, "same-file-helper-expansion-budget-exceeded");
});

test("static analysis engine preserves explicit helper expansion argument failures", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function Panel() {",
      "  function renderPanel(tone: string) {",
      "    return <section className={tone} />;",
      "  }",
      "  return renderPanel();",
      "}",
      "export function App() {",
      "  return <Panel />;",
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].componentName, "App");
  assert.equal(result.renderSubtrees[1].root.kind, "unknown");
  assert.equal(
    result.renderSubtrees[1].root.reason,
    "same-file-helper-expansion-unsupported-arguments",
  );
});

test("static analysis engine preserves explicit cross-file helper expansion argument failures", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/helpers.ts",
        sourceText: [
          "export function renderPanel(tone: string) {",
          "  return <section className={tone} />;",
          "}",
        ].join("\n"),
      },
      {
        filePath: "src/App.tsx",
        sourceText: [
          'import { renderPanel } from "./helpers";',
          "export function App() {",
          "  return renderPanel();",
          "}",
        ].join("\n"),
      },
    ],
  });

  const appSubtree = result.renderSubtrees.find((subtree) => subtree.componentName === "App");
  assert.ok(appSubtree);
  assert.equal(appSubtree.root.kind, "unknown");
  assert.equal(appSubtree.root.reason, "cross-file-helper-expansion-unsupported-arguments");
});

test("static analysis engine expands same-file local components with destructured prop bindings", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function Shell({ shellClass, children }: { shellClass: string; children: React.ReactNode }) {",
      "  return <section className={shellClass}>{children}</section>;",
      "}",
      "export function App() {",
      '  return <Shell shellClass="panel-shell"><h1 className="panel-shell__title" /></Shell>;',
      "}",
    ].join("\n"),
    selectorQueries: [".panel-shell .panel-shell__title"],
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].componentName, "App");
  assert.equal(result.renderSubtrees[1].root.kind, "element");
  assert.equal(result.renderSubtrees[1].root.tagName, "section");
  assert.deepEqual(result.renderSubtrees[1].root.className?.classes.definite, ["panel-shell"]);
  assert.equal(result.selectorQueryResults.length, 1);
  assert.equal(result.selectorQueryResults[0].outcome, "match");
});

test("static analysis engine expands same-file local components with props-identifier bindings", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function Badge(props: { tone: string }) {",
      "  return <span className={props.tone} />;",
      "}",
      "export function App() {",
      '  return <Badge tone="badge badge--info" />;',
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].componentName, "App");
  assert.equal(result.renderSubtrees[1].root.kind, "element");
  assert.equal(result.renderSubtrees[1].root.tagName, "span");
  assert.deepEqual(result.renderSubtrees[1].root.className?.classes.definite, [
    "badge",
    "badge--info",
  ]);
});

test("static analysis engine resolves exact boolean-gated local render branches from bound props", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function Panel({ isOpen }: { isOpen: boolean }) {",
      '  return isOpen ? <section className="panel is-open" /> : <section className="panel" />;',
      "}",
      "export function App() {",
      "  return <Panel isOpen={true} />;",
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].componentName, "App");
  assert.equal(result.renderSubtrees[1].root.kind, "element");
  assert.equal(result.renderSubtrees[1].root.tagName, "section");
  assert.deepEqual(result.renderSubtrees[1].root.className?.classes.definite, ["panel", "is-open"]);
});

test("static analysis engine resolves exact intrinsic tag names from bound local props", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function Surface({ as: AsTag, children }: { as: string; children: React.ReactNode }) {",
      '  return <AsTag className="surface">{children}</AsTag>;',
      "}",
      "export function App() {",
      '  return <Surface as="section"><h1 className="surface__title" /></Surface>;',
      "}",
    ].join("\n"),
    selectorQueries: [".surface .surface__title"],
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].componentName, "App");
  assert.equal(result.renderSubtrees[1].root.kind, "element");
  assert.equal(result.renderSubtrees[1].root.tagName, "section");
  assert.deepEqual(result.renderSubtrees[1].root.className?.classes.definite, ["surface"]);
  assert.equal(result.selectorQueryResults.length, 1);
  assert.equal(result.selectorQueryResults[0].outcome, "match");
});

test("static analysis engine resolves local const aliases inside expanded component bodies", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function Card({ tone, as, isOpen, children }: { tone: string; as: string; isOpen: boolean; children: React.ReactNode }) {",
      "  const resolvedTone = tone;",
      "  const Tag = as;",
      "  const shouldRenderOpen = isOpen;",
      '  return shouldRenderOpen ? <Tag className={resolvedTone}>{children}</Tag> : <div className="closed" />;',
      "}",
      "export function App() {",
      '  return <Card tone="card card--open" as="section" isOpen={true}><h1 className="card__title" /></Card>;',
      "}",
    ].join("\n"),
    selectorQueries: [".card .card__title"],
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].componentName, "App");
  assert.equal(result.renderSubtrees[1].root.kind, "element");
  assert.equal(result.renderSubtrees[1].root.tagName, "section");
  assert.deepEqual(result.renderSubtrees[1].root.className?.classes.definite, [
    "card",
    "card--open",
  ]);
  assert.equal(result.selectorQueryResults.length, 1);
  assert.equal(result.selectorQueryResults[0].outcome, "match");
});

test("static analysis engine resolves exact logical && branches in returned JSX trees", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function Panel({ isOpen }: { isOpen: boolean }) {",
      '  return isOpen && <section className="panel is-open" />;',
      "}",
      "export function App() {",
      "  return <Panel isOpen={true} />;",
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].componentName, "App");
  assert.equal(result.renderSubtrees[1].root.kind, "element");
  assert.equal(result.renderSubtrees[1].root.tagName, "section");
  assert.deepEqual(result.renderSubtrees[1].root.className?.classes.definite, ["panel", "is-open"]);
});

test("static analysis engine resolves exact logical || fallbacks in returned JSX trees", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function EmptyState({ isReady }: { isReady: boolean }) {",
      '  return isReady || <div className="empty-state" />;',
      "}",
      "export function App() {",
      "  return <EmptyState isReady={false} />;",
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].componentName, "App");
  assert.equal(result.renderSubtrees[1].root.kind, "element");
  assert.equal(result.renderSubtrees[1].root.tagName, "div");
  assert.deepEqual(result.renderSubtrees[1].root.className?.classes.definite, ["empty-state"]);
});

test("static analysis engine preserves unresolved logical && render uncertainty as a conditional", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "export function App({ isOpen }: { isOpen: boolean }) {",
      '  return isOpen && <section className="panel is-open" />;',
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 1);
  assert.equal(result.renderSubtrees[0].root.kind, "conditional");
  assert.equal(result.renderSubtrees[0].root.conditionSourceText, "isOpen");
  assert.equal(result.renderSubtrees[0].root.whenTrue.kind, "element");
  assert.equal(result.renderSubtrees[0].root.whenFalse.kind, "fragment");
  assert.equal(result.renderSubtrees[0].root.whenFalse.children.length, 0);
});

test("static analysis engine resolves exact equality checks in returned JSX trees", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function Panel({ state }: { state: string }) {",
      '  return state === "open" ? <section className="panel is-open" /> : <section className="panel" />;',
      "}",
      "export function App() {",
      '  return <Panel state="open" />;',
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].componentName, "App");
  assert.equal(result.renderSubtrees[1].root.kind, "element");
  assert.deepEqual(result.renderSubtrees[1].root.className?.classes.definite, ["panel", "is-open"]);
});

test("static analysis engine resolves exact relational checks in returned JSX trees", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function Results({ count }: { count: number }) {",
      '  return count > 0 ? <section className="results has-items" /> : <section className="results" />;',
      "}",
      "export function App() {",
      "  return <Results count={2} />;",
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].componentName, "App");
  assert.equal(result.renderSubtrees[1].root.kind, "element");
  assert.deepEqual(result.renderSubtrees[1].root.className?.classes.definite, [
    "results",
    "has-items",
  ]);
});

test("static analysis engine resolves explicit nullish equality checks in returned JSX trees", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function EmptyState({ content }: { content: string | null }) {",
      '  return content == null ? <div className="empty-state" /> : <div className="loaded-state" />;',
      "}",
      "export function App() {",
      "  return <EmptyState content={null} />;",
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].componentName, "App");
  assert.equal(result.renderSubtrees[1].root.kind, "element");
  assert.deepEqual(result.renderSubtrees[1].root.className?.classes.definite, ["empty-state"]);
});

test("static analysis engine resolves exact switch-based render branches in component bodies", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function Panel({ state }: { state: string }) {",
      "  switch (state) {",
      '    case "open":',
      '      return <section className="panel is-open" />;',
      '    case "closed":',
      '      return <section className="panel is-closed" />;',
      "    default:",
      '      return <section className="panel" />;',
      "  }",
      "}",
      "export function App() {",
      '  return <Panel state="open" />;',
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].componentName, "App");
  assert.equal(result.renderSubtrees[1].root.kind, "element");
  assert.deepEqual(result.renderSubtrees[1].root.className?.classes.definite, ["panel", "is-open"]);
});

test("static analysis engine resolves exact switch-based helper branches in component bodies", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function Panel({ state }: { state: string }) {",
      "  function renderState() {",
      "    switch (state) {",
      '      case "open":',
      '        return <section className="panel is-open" />;',
      "      default:",
      '        return <section className="panel" />;',
      "    }",
      "  }",
      "  return renderState();",
      "}",
      "export function App() {",
      '  return <Panel state="open" />;',
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].componentName, "App");
  assert.equal(result.renderSubtrees[1].root.kind, "element");
  assert.deepEqual(result.renderSubtrees[1].root.className?.classes.definite, ["panel", "is-open"]);
});

test("static analysis engine resolves if-else statement render branches in component bodies", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function Panel({ state }: { state: string }) {",
      '  if (state === "open") {',
      '    return <section className="panel is-open" />;',
      "  } else {",
      '    return <section className="panel" />;',
      "  }",
      "}",
      "export function App() {",
      '  return <Panel state="open" />;',
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].componentName, "App");
  assert.equal(result.renderSubtrees[1].root.kind, "element");
  assert.deepEqual(result.renderSubtrees[1].root.className?.classes.definite, ["panel", "is-open"]);
});

test("static analysis engine resolves early-return if statement branches in component bodies", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function Panel({ state }: { state: string }) {",
      '  if (state === "open") return <section className="panel is-open" />;',
      '  return <section className="panel" />;',
      "}",
      "export function App() {",
      '  return <Panel state="open" />;',
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].componentName, "App");
  assert.equal(result.renderSubtrees[1].root.kind, "element");
  assert.deepEqual(result.renderSubtrees[1].root.className?.classes.definite, ["panel", "is-open"]);
});

test("static analysis engine resolves if-else helper branches in component bodies", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function Panel({ state }: { state: string }) {",
      "  function renderState() {",
      '    if (state === "open") return <section className="panel is-open" />;',
      '    return <section className="panel" />;',
      "  }",
      "  return renderState();",
      "}",
      "export function App() {",
      '  return <Panel state="open" />;',
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].componentName, "App");
  assert.equal(result.renderSubtrees[1].root.kind, "element");
  assert.deepEqual(result.renderSubtrees[1].root.className?.classes.definite, ["panel", "is-open"]);
});

test("static analysis engine resolves exact ?? fallbacks in returned JSX trees", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function EmptyState({ content }: { content: string | null }) {",
      '  return content ?? <div className="empty-state" />;',
      "}",
      "export function App() {",
      "  return <EmptyState content={null} />;",
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].componentName, "App");
  assert.equal(result.renderSubtrees[1].root.kind, "element");
  assert.equal(result.renderSubtrees[1].root.tagName, "div");
  assert.deepEqual(result.renderSubtrees[1].root.className?.classes.definite, ["empty-state"]);
});

test("static analysis engine suppresses direct null render expressions as empty fragments", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: ["export function App() {", "  return null;", "}"].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 1);
  assert.equal(result.renderSubtrees[0].root.kind, "fragment");
  assert.equal(result.renderSubtrees[0].root.children.length, 0);
});

test("static analysis engine preserves unresolved ?? render uncertainty as a conditional", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "export function App({ content }: { content: string | null }) {",
      '  return content ?? <div className="empty-state" />;',
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 1);
  assert.equal(result.renderSubtrees[0].root.kind, "conditional");
  assert.equal(result.renderSubtrees[0].root.conditionSourceText, "content == null");
  assert.equal(result.renderSubtrees[0].root.whenTrue.kind, "element");
  assert.equal(result.renderSubtrees[0].root.whenFalse.kind, "unknown");
});

test("static analysis engine resolves bounded same-file helper calls that return JSX", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function Card() {",
      "  function renderTitle() {",
      '    return <h1 className="card__title" />;',
      "  }",
      '  return <section className="card">{renderTitle()}</section>;',
      "}",
      "export function App() {",
      "  return <Card />;",
      "}",
    ].join("\n"),
    selectorQueries: [".card .card__title"],
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].root.kind, "element");
  assert.equal(result.renderSubtrees[1].root.tagName, "section");
  assert.equal(result.renderSubtrees[1].root.children[0].kind, "element");
  assert.equal(result.selectorQueryResults[0].outcome, "match");
});

test("static analysis engine resolves bounded same-file helper calls that return class strings", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function Badge() {",
      "  function getTone() {",
      '    return "badge badge--info";',
      "  }",
      "  return <span className={getTone()} />;",
      "}",
      "export function App() {",
      "  return <Badge />;",
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].root.kind, "element");
  assert.deepEqual(result.renderSubtrees[1].root.className?.classes.definite, [
    "badge",
    "badge--info",
  ]);
});

test("static analysis engine resolves bounded same-file helper calls that return branch booleans", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "function Panel() {",
      "  function shouldRenderOpen() {",
      "    return true;",
      "  }",
      '  return shouldRenderOpen() ? <section className="panel is-open" /> : <section className="panel" />;',
      "}",
      "export function App() {",
      "  return <Panel />;",
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 2);
  assert.equal(result.renderSubtrees[1].root.kind, "element");
  assert.deepEqual(result.renderSubtrees[1].root.className?.classes.definite, ["panel", "is-open"]);
});

test("static analysis engine resolves exact array some callbacks into boolean render branches", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "export function App() {",
      '  const itemClasses = ["", "result-item"];',
      '  return itemClasses.some((itemClass) => itemClass) ? <section className="results has-items" /> : <section className="results" />;',
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 1);
  assert.equal(result.renderSubtrees[0].root.kind, "element");
  assert.deepEqual(result.renderSubtrees[0].root.className?.classes.definite, [
    "results",
    "has-items",
  ]);
});

test("static analysis engine resolves exact array every callbacks into boolean render branches", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "export function App() {",
      '  const itemClasses = ["result-item", "result-item--featured"];',
      '  return itemClasses.every((itemClass) => itemClass) ? <section className="results all-items-ready" /> : <section className="results" />;',
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 1);
  assert.equal(result.renderSubtrees[0].root.kind, "element");
  assert.deepEqual(result.renderSubtrees[0].root.className?.classes.definite, [
    "results",
    "all-items-ready",
  ]);
});

test("static analysis engine resolves exact array includes checks into boolean render branches", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "export function App() {",
      '  const itemClasses = ["result-item", "result-item--featured"];',
      '  return itemClasses.includes("result-item--featured") ? <section className="results has-featured-item" /> : <section className="results" />;',
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 1);
  assert.equal(result.renderSubtrees[0].root.kind, "element");
  assert.deepEqual(result.renderSubtrees[0].root.className?.classes.definite, [
    "results",
    "has-featured-item",
  ]);
});

test("static analysis engine resolves exact string includes checks into boolean render branches", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "export function App() {",
      '  const state = "panel is-open";',
      '  return state.includes("is-open") ? <section className="panel is-open" /> : <section className="panel" />;',
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 1);
  assert.equal(result.renderSubtrees[0].root.kind, "element");
  assert.deepEqual(result.renderSubtrees[0].root.className?.classes.definite, ["panel", "is-open"]);
});

test("static analysis engine resolves exact string startsWith checks into boolean render branches", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "export function App() {",
      '  const state = "is-open panel";',
      '  return state.startsWith("is-open") ? <section className="panel is-open" /> : <section className="panel" />;',
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 1);
  assert.equal(result.renderSubtrees[0].root.kind, "element");
  assert.deepEqual(result.renderSubtrees[0].root.className?.classes.definite, ["panel", "is-open"]);
});

test("static analysis engine resolves exact string endsWith checks into boolean render branches", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "export function App() {",
      '  const state = "panel is-open";',
      '  return state.endsWith("is-open") ? <section className="panel is-open" /> : <section className="panel" />;',
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 1);
  assert.equal(result.renderSubtrees[0].root.kind, "element");
  assert.deepEqual(result.renderSubtrees[0].root.className?.classes.definite, ["panel", "is-open"]);
});

test("static analysis engine lowers exact array literal render expressions into fragment children", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "export function App() {",
      "  return [",
      '    <li className="result-item" />,',
      '    <li className="result-item result-item--featured" />,',
      "  ];",
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 1);
  assert.equal(result.renderSubtrees[0].root.kind, "fragment");
  assert.equal(result.renderSubtrees[0].root.children.length, 2);
  assert.equal(result.renderSubtrees[0].root.children[0].kind, "element");
  assert.deepEqual(result.renderSubtrees[0].root.children[0].className?.classes.definite, [
    "result-item",
  ]);
  assert.deepEqual(result.renderSubtrees[0].root.children[1].className?.classes.definite, [
    "result-item",
    "result-item--featured",
  ]);
});

test("static analysis engine expands exact array literal map callbacks into repeated render children", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "export function App() {",
      '  const itemClasses = ["result-item", "result-item result-item--featured"];',
      '  return <ul className="results">{itemClasses.map((itemClass) => <li className={itemClass} />)}</ul>;',
      "}",
    ].join("\n"),
    selectorQueries: [".results .result-item", ".results .result-item--featured"],
  });

  assert.equal(result.renderSubtrees.length, 1);
  assert.equal(result.renderSubtrees[0].root.kind, "element");
  assert.equal(result.renderSubtrees[0].root.children.length, 1);
  assert.equal(result.renderSubtrees[0].root.children[0].kind, "fragment");
  assert.equal(result.renderSubtrees[0].root.children[0].children.length, 2);
  assert.equal(result.renderSubtrees[0].root.children[0].children[0].kind, "element");
  assert.deepEqual(
    result.renderSubtrees[0].root.children[0].children[1].className?.classes.definite,
    ["result-item", "result-item--featured"],
  );
  assert.equal(result.selectorQueryResults.length, 2);
  assert.equal(result.selectorQueryResults[0].outcome, "match");
  assert.equal(result.selectorQueryResults[1].outcome, "match");
});

test("static analysis engine resolves exact array filter-map chains into repeated render children", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "export function App() {",
      "  const items = [true, false, true];",
      '  return <ul className="results">{items.filter((item) => item).map(() => <li className="result-item" />)}</ul>;',
      "}",
    ].join("\n"),
    selectorQueries: [".results .result-item"],
  });

  assert.equal(result.renderSubtrees.length, 1);
  assert.equal(result.renderSubtrees[0].root.kind, "element");
  assert.equal(result.renderSubtrees[0].root.children.length, 1);
  assert.equal(result.renderSubtrees[0].root.children[0].kind, "fragment");
  assert.equal(result.renderSubtrees[0].root.children[0].children.length, 2);
  assert.equal(result.renderSubtrees[0].root.children[0].children[0].kind, "element");
  assert.equal(result.selectorQueryResults.length, 1);
  assert.equal(result.selectorQueryResults[0].outcome, "match");
});

test("static analysis engine resolves exact array filter(Boolean) chains into repeated render children", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "export function App() {",
      '  const itemClasses = ["result-item", "", "result-item result-item--featured"];',
      '  return <ul className="results">{itemClasses.filter(Boolean).map((itemClass) => <li className={itemClass} />)}</ul>;',
      "}",
    ].join("\n"),
    selectorQueries: [".results .result-item", ".results .result-item--featured"],
  });

  assert.equal(result.renderSubtrees.length, 1);
  assert.equal(result.renderSubtrees[0].root.kind, "element");
  assert.equal(result.renderSubtrees[0].root.children.length, 1);
  assert.equal(result.renderSubtrees[0].root.children[0].kind, "fragment");
  assert.equal(result.renderSubtrees[0].root.children[0].children.length, 2);
  assert.deepEqual(
    result.renderSubtrees[0].root.children[0].children[1].className?.classes.definite,
    ["result-item", "result-item--featured"],
  );
  assert.equal(result.selectorQueryResults.length, 2);
  assert.equal(result.selectorQueryResults[0].outcome, "match");
  assert.equal(result.selectorQueryResults[1].outcome, "match");
});

test("static analysis engine represents non-exact map output as a repeated region", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "export function App({ items }: { items: string[] }) {",
      '  return <ul className="results">{items.map(() => <li className="result-item" />)}</ul>;',
      "}",
    ].join("\n"),
    selectorQueries: [".results .result-item"],
  });

  assert.equal(result.renderSubtrees.length, 1);
  assert.equal(result.renderSubtrees[0].root.kind, "element");
  assert.equal(result.renderSubtrees[0].root.children.length, 1);
  assert.equal(result.renderSubtrees[0].root.children[0].kind, "repeated-region");
  assert.equal(result.renderSubtrees[0].root.children[0].template.kind, "element");
  assert.equal(result.selectorQueryResults.length, 1);
  assert.equal(result.selectorQueryResults[0].outcome, "possible-match");
});

test("static analysis engine resolves exact array find callbacks into a first matching render node", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "export function App() {",
      '  const itemClasses = ["", "result-item result-item--featured", "result-item"];',
      '  return <section className="results">{itemClasses.find((itemClass) => itemClass) && <li className={itemClasses.find((itemClass) => itemClass)} />}</section>;',
      "}",
    ].join("\n"),
    selectorQueries: [".results .result-item--featured"],
  });

  assert.equal(result.renderSubtrees.length, 1);
  assert.equal(result.renderSubtrees[0].root.kind, "element");
  assert.equal(result.renderSubtrees[0].root.children.length, 1);
  assert.equal(result.renderSubtrees[0].root.children[0].kind, "element");
  assert.deepEqual(result.renderSubtrees[0].root.children[0].className?.classes.definite, [
    "result-item",
    "result-item--featured",
  ]);
  assert.equal(result.selectorQueryResults.length, 1);
  assert.equal(result.selectorQueryResults[0].outcome, "match");
});

test("static analysis engine lowers exact array find misses to empty fragments", () => {
  const result = analyzeSourceText({
    filePath: "src/App.tsx",
    sourceText: [
      "export function App() {",
      "  const items = [false, false];",
      "  return items.find((item) => item);",
      "}",
    ].join("\n"),
  });

  assert.equal(result.renderSubtrees.length, 1);
  assert.equal(result.renderSubtrees[0].root.kind, "fragment");
  assert.equal(result.renderSubtrees[0].root.children.length, 0);
});
