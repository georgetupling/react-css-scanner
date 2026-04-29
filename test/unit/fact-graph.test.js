import assert from "node:assert/strict";
import test from "node:test";

import { graphToCssRuleFileInputs } from "../../dist/static-analysis-engine/pipeline/fact-graph/adapters/cssAnalysisInputs.js";
import { graphToProjectResourceEdges } from "../../dist/static-analysis-engine/pipeline/fact-graph/adapters/graphToProjectResourceEdges.js";
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
      result.graph.edges.contains
        .filter((edge) =>
          ["stylesheet-rule", "rule-selector", "selector-branch"].includes(edge.containmentKind),
        )
        .map((edge) => ({
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
      result.graph.nodes.components.map((node) => ({
        componentName: node.componentName,
        filePath: node.filePath,
        exported: node.exported,
      })),
      [
        {
          componentName: "App",
          filePath: "src/App.tsx",
          exported: true,
        },
      ],
    );
    assert.equal(
      result.graph.nodes.renderSites.some((node) => node.renderSiteKind === "jsx-element"),
      true,
    );
    assert.equal(
      result.graph.nodes.elementTemplates.some(
        (node) => node.templateKind === "intrinsic" && node.name === "main",
      ),
      true,
    );
    assert.equal(
      result.graph.nodes.classExpressionSites.some(
        (node) => node.classExpressionSiteKind === "jsx-class",
      ),
      true,
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
    .withSourceFile("src/App.tsx", "export const value = 1;\n")
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

test("fact graph normalizes source and stylesheet imports into import edges", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./theme.css";\nimport "pkg/theme.css";\nimport "https://example.com/remote.css";\n',
    )
    .withCssFile("src/theme.css", '@import "./tokens.css";\n.token {\n  color: red;\n}\n')
    .withCssFile("src/tokens.css", ".token {\n  color: green;\n}\n")
    .build();

  try {
    const snapshot = await buildProjectSnapshot({
      scanInput: {
        rootDir: project.rootDir,
        sourceFilePaths: ["src/App.tsx"],
        cssFilePaths: ["src/theme.css", "src/tokens.css"],
      },
      runStage: async (_stage, _message, run) => run(),
    });
    const frontends = buildLanguageFrontends({ snapshot });
    const result = buildFactGraph({ snapshot, frontends });

    const importEdges = result.graph.edges.imports.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      importerKind: edge.importerKind,
      importKind: edge.importKind,
      specifier: edge.specifier,
      resolutionStatus: edge.resolutionStatus,
      ...(edge.resolvedFilePath ? { resolvedFilePath: edge.resolvedFilePath } : {}),
      ...(edge.resolvedTargetNodeId ? { resolvedTargetNodeId: edge.resolvedTargetNodeId } : {}),
    }));
    assert.deepEqual(importEdges, [
      {
        id: "imports:module:src/App.tsx->external:package:pkg/theme.css:pkg/theme.css:css",
        from: "module:src/App.tsx",
        to: "external:package:pkg/theme.css",
        importerKind: "source",
        importKind: "css",
        specifier: "pkg/theme.css",
        resolutionStatus: "external",
      },
      {
        id: "imports:module:src/App.tsx->external:remote:https://example.com/remote.css:https://example.com/remote.css:css",
        from: "module:src/App.tsx",
        to: "external:remote:https://example.com/remote.css",
        importerKind: "source",
        importKind: "css",
        specifier: "https://example.com/remote.css",
        resolutionStatus: "external",
      },
      {
        id: "imports:module:src/App.tsx->stylesheet:src/theme.css:./theme.css:css",
        from: "module:src/App.tsx",
        to: "stylesheet:src/theme.css",
        importerKind: "source",
        importKind: "css",
        specifier: "./theme.css",
        resolutionStatus: "resolved",
        resolvedFilePath: "src/theme.css",
        resolvedTargetNodeId: "stylesheet:src/theme.css",
      },
      {
        id: "imports:stylesheet:src/theme.css->stylesheet:src/tokens.css:./tokens.css:css",
        from: "stylesheet:src/theme.css",
        to: "stylesheet:src/tokens.css",
        importerKind: "stylesheet",
        importKind: "css",
        specifier: "./tokens.css",
        resolutionStatus: "resolved",
        resolvedFilePath: "src/tokens.css",
        resolvedTargetNodeId: "stylesheet:src/tokens.css",
      },
    ]);

    assert.deepEqual(
      result.graph.nodes.externalResources.map((node) => ({
        id: node.id,
        specifier: node.specifier,
        resourceKind: node.resourceKind,
      })),
      [
        {
          id: "external:package:pkg/theme.css",
          specifier: "pkg/theme.css",
          resourceKind: "package",
        },
        {
          id: "external:remote:https://example.com/remote.css",
          specifier: "https://example.com/remote.css",
          resourceKind: "remote",
        },
      ],
    );

    assert.deepEqual(
      graphToProjectResourceEdges(result.graph).map((edge) => ({
        kind: edge.kind,
        importerKind: edge.kind === "source-import" ? edge.importerKind : undefined,
        importerFilePath: edge.importerFilePath,
        specifier: edge.specifier,
        resolutionStatus: edge.kind === "source-import" ? edge.resolutionStatus : undefined,
        importKind: edge.kind === "source-import" ? edge.importKind : undefined,
        resolvedFilePath:
          edge.kind === "source-import" || edge.kind === "stylesheet-import"
            ? edge.resolvedFilePath
            : undefined,
      })),
      [
        {
          kind: "source-import",
          importerKind: undefined,
          importerFilePath: "src/App.tsx",
          specifier: "./theme.css",
          importKind: "css",
          resolutionStatus: "resolved",
          resolvedFilePath: "src/theme.css",
        },
        {
          kind: "source-import",
          importerKind: undefined,
          importerFilePath: "src/App.tsx",
          specifier: "https://example.com/remote.css",
          importKind: "css",
          resolutionStatus: "external",
          resolvedFilePath: undefined,
        },
        {
          kind: "source-import",
          importerKind: undefined,
          importerFilePath: "src/App.tsx",
          specifier: "pkg/theme.css",
          importKind: "css",
          resolutionStatus: "external",
          resolvedFilePath: undefined,
        },
        {
          kind: "stylesheet-import",
          importerKind: undefined,
          importerFilePath: "src/theme.css",
          specifier: "./tokens.css",
          importKind: undefined,
          resolutionStatus: undefined,
          resolvedFilePath: "src/tokens.css",
        },
      ],
    );
  } finally {
    await project.cleanup();
  }
});
