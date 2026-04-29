import assert from "node:assert/strict";
import test from "node:test";

import { graphToCssRuleFileInputs } from "../../dist/static-analysis-engine/pipeline/fact-graph/adapters/cssAnalysisInputs.js";
import { graphToSelectorEntries } from "../../dist/static-analysis-engine/pipeline/fact-graph/adapters/selectorAnalysisInputs.js";
import { buildFactGraph } from "../../dist/static-analysis-engine/pipeline/fact-graph/buildFactGraph.js";
import { buildLanguageFrontends } from "../../dist/static-analysis-engine/pipeline/language-frontends/buildLanguageFrontends.js";
import { buildProjectSnapshot } from "../../dist/static-analysis-engine/pipeline/workspace-discovery/buildProjectSnapshot.js";
import { TestProjectBuilder } from "../support/TestProjectBuilder.js";

test("fact graph builds file, module, stylesheet, and origin facts without changing consumers", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./app.css";\nexport function App() { return <main className="app" />; }\n',
    )
    .withCssFile("src/app.css", ".app, .shell .app { display: block; }\n")
    .withFile("public/index.html", '<script type="module" src="../src/App.tsx"></script>\n')
    .build();

  try {
    const snapshot = await buildProjectSnapshot({
      scanInput: {
        rootDir: project.rootDir,
        sourceFilePaths: ["src/App.tsx"],
        cssFilePaths: ["src/app.css"],
        htmlFilePaths: ["public/index.html"],
      },
      runStage: async (_stage, _message, run) => run(),
    });
    const frontends = buildLanguageFrontends({ snapshot });
    const result = buildFactGraph({ snapshot, frontends });

    assert.deepEqual(
      result.graph.nodes.files.map((node) => ({
        id: node.id,
        filePath: node.filePath,
        fileKind: node.fileKind,
      })),
      [
        {
          id: "file:public/index.html",
          filePath: "public/index.html",
          fileKind: "html",
        },
        {
          id: "file:src/app.css",
          filePath: "src/app.css",
          fileKind: "stylesheet",
        },
        {
          id: "file:src/App.tsx",
          filePath: "src/App.tsx",
          fileKind: "source",
        },
      ],
    );
    assert.deepEqual(
      result.graph.nodes.modules.map((node) => ({
        id: node.id,
        filePath: node.filePath,
        languageKind: node.languageKind,
      })),
      [
        {
          id: "module:src/App.tsx",
          filePath: "src/App.tsx",
          languageKind: "tsx",
        },
      ],
    );
    assert.deepEqual(
      result.graph.nodes.stylesheets.map((node) => ({
        id: node.id,
        filePath: node.filePath,
        cssKind: node.cssKind,
        origin: node.origin,
      })),
      [
        {
          id: "stylesheet:src/app.css",
          filePath: "src/app.css",
          cssKind: "global-css",
          origin: "project",
        },
      ],
    );
    assert.deepEqual(
      result.graph.nodes.ruleDefinitions.map((node) => ({
        id: node.id,
        stylesheetNodeId: node.stylesheetNodeId,
        selectorText: node.selectorText,
        declarationProperties: node.declarationProperties,
      })),
      [
        {
          id: "rule:stylesheet:src/app.css:0",
          stylesheetNodeId: "stylesheet:src/app.css",
          selectorText: ".app, .shell .app",
          declarationProperties: ["display"],
        },
      ],
    );
    assert.deepEqual(
      result.graph.nodes.selectors.map((node) => ({
        id: node.id,
        stylesheetNodeId: node.stylesheetNodeId,
        ruleDefinitionNodeId: node.ruleDefinitionNodeId,
        selectorText: node.selectorText,
      })),
      [
        {
          id: "selector:stylesheet:src/app.css:0",
          stylesheetNodeId: "stylesheet:src/app.css",
          ruleDefinitionNodeId: "rule:stylesheet:src/app.css:0",
          selectorText: ".app, .shell .app",
        },
      ],
    );
    assert.deepEqual(
      result.graph.nodes.selectorBranches.map((node) => ({
        id: node.id,
        selectorText: node.selectorText,
        branchIndex: node.branchIndex,
        branchCount: node.branchCount,
        requiredClassNames: node.requiredClassNames,
        contextClassNames: node.contextClassNames,
      })),
      [
        {
          id: "selector-branch:stylesheet:src/app.css:0:0",
          selectorText: ".app",
          branchIndex: 0,
          branchCount: 2,
          requiredClassNames: ["app"],
          contextClassNames: [],
        },
        {
          id: "selector-branch:stylesheet:src/app.css:0:1",
          selectorText: ".shell .app",
          branchIndex: 1,
          branchCount: 2,
          requiredClassNames: ["app"],
          contextClassNames: ["shell"],
        },
      ],
    );
    assert.deepEqual(
      result.graph.edges.originatesFromFile.map((edge) => ({
        id: edge.id,
        from: edge.from,
        to: edge.to,
      })),
      [
        {
          id: "originates-from-file:module:src/App.tsx->file:src/App.tsx",
          from: "module:src/App.tsx",
          to: "file:src/App.tsx",
        },
        {
          id: "originates-from-file:stylesheet:src/app.css->file:src/app.css",
          from: "stylesheet:src/app.css",
          to: "file:src/app.css",
        },
      ],
    );
    assert.deepEqual(
      result.graph.edges.contains.map((edge) => ({
        from: edge.from,
        to: edge.to,
        containmentKind: edge.containmentKind,
      })),
      [
        {
          from: "rule:stylesheet:src/app.css:0",
          to: "selector:stylesheet:src/app.css:0",
          containmentKind: "rule-selector",
        },
        {
          from: "selector:stylesheet:src/app.css:0",
          to: "selector-branch:stylesheet:src/app.css:0:0",
          containmentKind: "selector-branch",
        },
        {
          from: "selector:stylesheet:src/app.css:0",
          to: "selector-branch:stylesheet:src/app.css:0:1",
          containmentKind: "selector-branch",
        },
        {
          from: "stylesheet:src/app.css",
          to: "rule:stylesheet:src/app.css:0",
          containmentKind: "stylesheet-rule",
        },
      ],
    );
    assert.deepEqual(
      result.graph.edges.definesSelector.map((edge) => ({
        from: edge.from,
        to: edge.to,
      })),
      [
        {
          from: "rule:stylesheet:src/app.css:0",
          to: "selector-branch:stylesheet:src/app.css:0:0",
        },
        {
          from: "rule:stylesheet:src/app.css:0",
          to: "selector-branch:stylesheet:src/app.css:0:1",
        },
        {
          from: "rule:stylesheet:src/app.css:0",
          to: "selector:stylesheet:src/app.css:0",
        },
        {
          from: "stylesheet:src/app.css",
          to: "selector:stylesheet:src/app.css:0",
        },
      ],
    );
    assert.equal(
      result.graph.indexes.moduleNodeIdByFilePath.get("src/App.tsx"),
      "module:src/App.tsx",
    );
    assert.equal(
      result.graph.indexes.stylesheetNodeIdByFilePath.get("src/app.css"),
      "stylesheet:src/app.css",
    );
    assert.deepEqual(result.graph.indexes.selectorBranchNodeIdsByRequiredClassName.get("app"), [
      "selector-branch:stylesheet:src/app.css:0:0",
      "selector-branch:stylesheet:src/app.css:0:1",
    ]);
    assert.deepEqual(
      graphToCssRuleFileInputs(result.graph).map((file) => ({
        filePath: file.filePath,
        selectors: file.rules.map((rule) => rule.selector),
      })),
      [
        {
          filePath: "src/app.css",
          selectors: [".app, .shell .app"],
        },
      ],
    );
    assert.deepEqual(
      graphToSelectorEntries(result.graph).map((entry) => ({
        selectorText: entry.selectorText,
        branchIndex: entry.source.branchIndex,
        ruleKey: entry.source.ruleKey,
      })),
      [
        {
          selectorText: ".app",
          branchIndex: 0,
          ruleKey: "src/app.css:0:.app, .shell .app",
        },
        {
          selectorText: ".shell .app",
          branchIndex: 1,
          ruleKey: "src/app.css:0:.app, .shell .app",
        },
      ],
    );
    assert.deepEqual(result.graph.diagnostics, []);
  } finally {
    await project.cleanup();
  }
});

test("fact graph reports duplicate graph ids", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile("src/App.tsx", "export function App() { return null; }\n")
    .build();

  try {
    const snapshot = await buildProjectSnapshot({
      scanInput: {
        rootDir: project.rootDir,
        sourceFilePaths: ["src/App.tsx"],
      },
      runStage: async (_stage, _message, run) => run(),
    });
    const frontends = buildLanguageFrontends({ snapshot });
    const duplicatedFrontends = {
      ...frontends,
      source: {
        files: [frontends.source.files[0], frontends.source.files[0]],
        filesByPath: frontends.source.filesByPath,
      },
    };
    const result = buildFactGraph({
      snapshot,
      frontends: duplicatedFrontends,
    });

    assert.deepEqual(
      result.graph.diagnostics.map((diagnostic) => ({
        severity: diagnostic.severity,
        code: diagnostic.code,
        message: diagnostic.message,
      })),
      [
        {
          severity: "error",
          code: "duplicate-graph-id",
          message: "Duplicate fact graph node id: module:src/App.tsx",
        },
        {
          severity: "error",
          code: "duplicate-graph-id",
          message:
            "Duplicate fact graph edge id: originates-from-file:module:src/App.tsx->file:src/App.tsx",
        },
      ],
    );
  } finally {
    await project.cleanup();
  }
});
