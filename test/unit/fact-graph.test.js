import assert from "node:assert/strict";
import test from "node:test";

import { buildFactGraph, buildLanguageFrontends } from "../../dist/static-analysis-engine.js";
import { graphToReactRenderSyntaxInputs } from "../../dist/static-analysis-engine/pipeline/fact-graph/adapters/reactRenderSyntaxInputs.js";
import { graphToSelectorEntries } from "../../dist/static-analysis-engine/pipeline/fact-graph/adapters/selectorAnalysisInputs.js";
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
    const classExpressionSite = result.graph.nodes.classExpressionSites.find(
      (node) => node.classExpressionSiteKind === "jsx-class",
    );
    assert.ok(classExpressionSite);
    assert.equal(classExpressionSite.expressionNodeId, classExpressionSite.expressionId);
    const classExpressionSyntaxNode = result.graph.indexes.nodesById.get(
      classExpressionSite.expressionNodeId,
    );
    assert.ok(classExpressionSyntaxNode);
    assert.equal(classExpressionSyntaxNode.kind, "expression-syntax");
    assert.equal(classExpressionSyntaxNode.expressionKind, "string-literal");
    assert.equal(classExpressionSyntaxNode.value, "app");
    assert.equal(
      result.graph.indexes.expressionSyntaxNodeIdByExpressionId.get(
        classExpressionSite.expressionId,
      ),
      classExpressionSite.expressionNodeId,
    );
    assert.deepEqual(result.graph.indexes.expressionSyntaxNodeIdsByFilePath.get("src/App.tsx"), [
      classExpressionSite.expressionNodeId,
    ]);
    assert.equal(result.graph.indexes.componentNodeIdsByFilePath.get("src/App.tsx").length, 1);
    assert.equal(
      result.graph.indexes.classExpressionSiteNodeIdsByComponentNodeId.get(
        result.graph.nodes.components[0].id,
      ).length,
      1,
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
  } finally {
    await project.cleanup();
  }
});

test("fact graph normalizes React component references and helper return sites", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./app.css";',
        'export function Child() { return <span className="child" />; }',
        'export function Parent() { function helper() { return <em className="helper" />; } return <Child className="from-parent" />; }',
        "",
      ].join("\n"),
    )
    .withCssFile("src/app.css", ".child, .helper, .from-parent { display: block; }\n")
    .build();

  try {
    const snapshot = await buildProjectSnapshot({
      scanInput: {
        rootDir: project.rootDir,
        sourceFilePaths: ["src/App.tsx"],
        cssFilePaths: ["src/app.css"],
      },
      runStage: async (_stage, _message, run) => run(),
    });
    const frontends = buildLanguageFrontends({ snapshot });
    const result = buildFactGraph({ snapshot, frontends });

    assert.deepEqual(
      result.graph.nodes.components.map((node) => node.componentName),
      ["Child", "Parent"],
    );
    assert.equal(
      result.graph.nodes.renderSites.some((node) => node.renderSiteKind === "component-reference"),
      true,
    );
    assert.equal(
      result.graph.nodes.renderSites.some((node) => node.renderSiteKind === "helper-return"),
      true,
    );
    assert.equal(
      result.graph.nodes.elementTemplates.some(
        (node) => node.templateKind === "component-candidate" && node.name === "Child",
      ),
      true,
    );
    assert.equal(
      result.graph.nodes.classExpressionSites.some(
        (node) => node.classExpressionSiteKind === "component-prop-class",
      ),
      true,
    );
    assert.equal(
      result.graph.edges.renders.some((edge) => {
        const from = result.graph.indexes.nodesById.get(edge.from);
        const to = result.graph.indexes.nodesById.get(edge.to);
        return (
          from?.kind === "component" &&
          from.componentName === "Parent" &&
          to?.kind === "component" &&
          to.componentName === "Child"
        );
      }),
      true,
    );
    const renderSyntaxInputs = graphToReactRenderSyntaxInputs(result.graph);
    const parentComponent = renderSyntaxInputs.components.find(
      (component) => component.componentName === "Parent",
    );
    const parentRenderSiteKinds = renderSyntaxInputs.renderSitesByComponentNodeId
      .get(parentComponent.id)
      .map((node) => node.renderSiteKind);
    assert.equal(parentRenderSiteKinds.includes("component-root"), true);
    assert.equal(parentRenderSiteKinds.includes("component-reference"), true);
    assert.equal(parentRenderSiteKinds.includes("helper-return"), true);
    assert.equal(
      renderSyntaxInputs.elementTemplates.some(
        (node) => node.templateKind === "component-candidate" && node.name === "Child",
      ),
      true,
    );
    assert.equal(
      renderSyntaxInputs.classExpressionSites.some(
        (node) => node.classExpressionSiteKind === "component-prop-class",
      ),
      true,
    );
  } finally {
    await project.cleanup();
  }
});

test("fact graph preserves semantic repetition metadata on render sites", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/List.tsx",
      [
        "export function List({ items }) {",
        "  return (",
        "    <ul>",
        "      {items.map((item) => <li key={item.id}>{item.label}</li>)}",
        "    </ul>",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const snapshot = await buildProjectSnapshot({
      scanInput: {
        rootDir: project.rootDir,
        sourceFilePaths: ["src/List.tsx"],
      },
      runStage: async (_stage, _message, run) => run(),
    });
    const frontends = buildLanguageFrontends({ snapshot });
    const result = buildFactGraph({ snapshot, frontends });

    assert.equal(
      result.graph.nodes.renderSites.some(
        (site) => site.repeatedRegion?.repeatKind === "array-map",
      ),
      true,
    );
  } finally {
    await project.cleanup();
  }
});

test("fact graph normalizes React prop, local binding, and helper definition facts", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/Button.tsx",
      [
        "function joinClasses(...classes) {",
        '  return classes.filter(Boolean).join(" ");',
        "}",
        'export function Button({ className, tone = "primary" }) {',
        '  const local = "button";',
        "  function localJoin(extra) {",
        "    const base = local;",
        "    return joinClasses(base, extra);",
        "  }",
        "  const classes = localJoin(className);",
        "  return <button className={classes} />;",
        "}",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const snapshot = await buildProjectSnapshot({
      scanInput: {
        rootDir: project.rootDir,
        sourceFilePaths: ["src/Button.tsx"],
      },
      runStage: async (_stage, _message, run) => run(),
    });
    const frontends = buildLanguageFrontends({ snapshot });
    const result = buildFactGraph({ snapshot, frontends });
    const buttonComponent = result.graph.nodes.components.find(
      (node) => node.componentName === "Button",
    );
    assert.ok(buttonComponent);

    const propBindingNodeId = result.graph.indexes.componentPropBindingNodeIdByComponentNodeId.get(
      buttonComponent.id,
    );
    const propBindingNode = result.graph.indexes.nodesById.get(propBindingNodeId);
    assert.equal(propBindingNode.kind, "component-prop-binding");
    assert.equal(propBindingNode.bindingKind, "destructured-props");
    assert.deepEqual(
      propBindingNode.properties.map((property) => ({
        propertyName: property.propertyName,
        localName: property.localName,
      })),
      [
        {
          propertyName: "className",
          localName: "className",
        },
        {
          propertyName: "tone",
          localName: "tone",
        },
      ],
    );

    const helperSummary = result.graph.nodes.helperDefinitions
      .map((node) => ({
        helperName: node.helperName,
        ownerKind: node.ownerKind,
        ownerNodeKind: result.graph.indexes.nodesById.get(node.ownerNodeId).kind,
        returnNodeKind: result.graph.indexes.nodesById.get(node.returnExpressionNodeId)?.kind,
      }))
      .sort((left, right) => left.helperName.localeCompare(right.helperName));
    assert.deepEqual(helperSummary, [
      {
        helperName: "joinClasses",
        ownerKind: "source-file",
        ownerNodeKind: "module",
        returnNodeKind: "expression-syntax",
      },
      {
        helperName: "localJoin",
        ownerKind: "component",
        ownerNodeKind: "component",
        returnNodeKind: "expression-syntax",
      },
    ]);

    const localBindings = result.graph.nodes.localValueBindings
      .map((node) => ({
        localName: node.localName,
        ownerKind: node.ownerKind,
        ownerNodeKind: result.graph.indexes.nodesById.get(node.ownerNodeId).kind,
        expressionNodeKind: result.graph.indexes.nodesById.get(node.expressionNodeId)?.kind,
      }))
      .sort((left, right) => left.localName.localeCompare(right.localName));
    assert.deepEqual(localBindings, [
      {
        localName: "base",
        ownerKind: "helper",
        ownerNodeKind: "helper-definition",
        expressionNodeKind: "expression-syntax",
      },
      {
        localName: "classes",
        ownerKind: "component",
        ownerNodeKind: "component",
        expressionNodeKind: "expression-syntax",
      },
      {
        localName: "local",
        ownerKind: "component",
        ownerNodeKind: "component",
        expressionNodeKind: "expression-syntax",
      },
    ]);
    assert.equal(
      result.graph.indexes.helperDefinitionNodeIdsByOwnerNodeId.get(buttonComponent.id).length,
      1,
    );
    assert.equal(
      result.graph.indexes.localValueBindingNodeIdsByOwnerNodeId.get(buttonComponent.id).length,
      2,
    );
    assert.equal(
      result.graph.edges.contains.some(
        (edge) =>
          edge.from === buttonComponent.id &&
          edge.to === propBindingNode.id &&
          edge.containmentKind === "component-prop-binding",
      ),
      true,
    );
    assert.deepEqual(result.graph.diagnostics, []);
  } finally {
    await project.cleanup();
  }
});

test("fact graph seeds reusable owner candidates without emitting findings", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "packages/ui/src/index.tsx",
      'export function Button() { return <button className="button" />; }\n',
    )
    .withCssFile("packages/ui/src/Button.css", ".button { color: red; }\n")
    .build();

  try {
    const snapshot = await buildProjectSnapshot({
      scanInput: {
        rootDir: project.rootDir,
        sourceFilePaths: ["packages/ui/src/index.tsx"],
        cssFilePaths: ["packages/ui/src/Button.css"],
      },
      runStage: async (_stage, _message, run) => run(),
    });
    const frontends = buildLanguageFrontends({ snapshot });
    const result = buildFactGraph({ snapshot, frontends });

    assert.deepEqual(
      result.graph.nodes.ownerCandidates.map((node) => ({
        ownerCandidateKind: node.ownerCandidateKind,
        ownerKey: node.ownerKey,
        seedReason: node.seedReason,
        confidence: node.confidence,
      })),
      [
        {
          ownerCandidateKind: "component",
          ownerKey: "component:packages/ui/src/index.tsx:Button:1:17:1:23",
          seedReason: "component declaration",
          confidence: "high",
        },
        {
          ownerCandidateKind: "directory",
          ownerKey: "packages/ui/src",
          seedReason: "containing directory path",
          confidence: "high",
        },
        {
          ownerCandidateKind: "source-file",
          ownerKey: "packages/ui/src/Button.css",
          seedReason: "file resource path",
          confidence: "high",
        },
        {
          ownerCandidateKind: "source-file",
          ownerKey: "packages/ui/src/index.tsx",
          seedReason: "file resource path",
          confidence: "high",
        },
        {
          ownerCandidateKind: "workspace-package",
          ownerKey: "ui",
          seedReason: "discovered-workspace-entrypoint",
          confidence: "medium",
        },
      ],
    );
    assert.equal(
      result.graph.indexes.ownerCandidateNodeIdsByOwnerKind.get("workspace-package").length,
      1,
    );
    assert.equal(
      result.graph.edges.belongsToOwnerCandidate.some(
        (edge) =>
          edge.from === "module:packages/ui/src/index.tsx" &&
          edge.to === "owner:workspace-package:ui",
      ),
      true,
    );
    assert.equal(
      result.graph.edges.belongsToOwnerCandidate.some(
        (edge) =>
          edge.from === "stylesheet:packages/ui/src/Button.css" &&
          edge.to === "owner:directory:packages/ui/src",
      ),
      true,
    );
  } finally {
    await project.cleanup();
  }
});
