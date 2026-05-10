import assert from "node:assert/strict";
import test from "node:test";

import { buildProjectEvidence, runAnalysisPipeline } from "../../dist/static-analysis-engine.js";
import { TestProjectBuilder } from "../support/TestProjectBuilder.js";

test("project evidence assembly returns deterministic empty facts", () => {
  const result = buildProjectEvidence();

  assert.deepEqual(result.meta, {
    generatedAtStage: "project-evidence-assembly",
    sourceFileCount: 0,
    componentCount: 0,
    stylesheetCount: 0,
    classDefinitionCount: 0,
    cssDeclarationCount: 0,
    classReferenceCount: 0,
    relationCount: 0,
    diagnosticCount: 0,
  });
  assert.deepEqual(result.entities.sourceFiles, []);
  assert.deepEqual(result.entities.stylesheets, []);
  assert.deepEqual(result.entities.components, []);
  assert.deepEqual(result.entities.renderSubtrees, []);
  assert.deepEqual(result.entities.classDefinitions, []);
  assert.deepEqual(result.entities.classContexts, []);
  assert.deepEqual(result.entities.classReferences, []);
  assert.deepEqual(result.entities.staticallySkippedClassReferences, []);
  assert.deepEqual(result.entities.selectorQueries, []);
  assert.deepEqual(result.entities.selectorBranches, []);
  assert.deepEqual(result.entities.cssDeclarations, []);
  assert.deepEqual(result.entities.unsupportedClassReferences, []);
  assert.deepEqual(result.entities.cssModuleImports, []);
  assert.deepEqual(result.entities.cssModuleAliases, []);
  assert.deepEqual(result.entities.cssModuleDestructuredBindings, []);
  assert.deepEqual(result.entities.cssModuleMemberReferences, []);
  assert.deepEqual(result.entities.cssModuleReferenceDiagnostics, []);

  assert.deepEqual(result.relations.moduleImports, []);
  assert.deepEqual(result.relations.componentRenders, []);
  assert.deepEqual(result.relations.stylesheetReachability, []);
  assert.deepEqual(result.relations.referenceMatches, []);
  assert.deepEqual(result.relations.selectorMatches, []);
  assert.deepEqual(result.relations.providerClassSatisfactions, []);
  assert.deepEqual(result.relations.cssModuleMemberMatches, []);
  assert.deepEqual(result.diagnostics, []);

  assert.equal(result.indexes.sourceFilesById.size, 0);
  assert.equal(result.indexes.sourceFileIdByPath.size, 0);
  assert.equal(result.indexes.stylesheetsById.size, 0);
  assert.equal(result.indexes.stylesheetIdByPath.size, 0);
  assert.equal(result.indexes.componentsById.size, 0);
  assert.equal(result.indexes.componentIdsBySourceFileId.size, 0);
  assert.equal(result.indexes.classDefinitionsById.size, 0);
  assert.equal(result.indexes.classDefinitionIdsByClassName.size, 0);
  assert.equal(result.indexes.classDefinitionIdsByStylesheetId.size, 0);
  assert.equal(result.indexes.cssDeclarationsById.size, 0);
  assert.equal(result.indexes.cssDeclarationIdsByStylesheetId.size, 0);
  assert.equal(result.indexes.cssDeclarationIdsByRuleDefinitionNodeId.size, 0);
  assert.equal(result.indexes.cssDeclarationIdsBySelectorBranchId.size, 0);
  assert.equal(result.indexes.cssDeclarationIdsByProperty.size, 0);
  assert.equal(result.indexes.classReferencesById.size, 0);
  assert.equal(result.indexes.classReferenceIdsByClassName.size, 0);
  assert.equal(result.indexes.classReferenceIdsBySourceFileId.size, 0);
  assert.equal(result.indexes.classReferenceMatchIdsByDefinitionId.size, 0);
  assert.equal(result.indexes.classReferenceMatchIdsByReferenceId.size, 0);
  assert.equal(result.indexes.stylesheetReachabilityIdsByStylesheetId.size, 0);
  assert.equal(result.indexes.selectorBranchesById.size, 0);
  assert.equal(result.indexes.selectorBranchIdsByStylesheetId.size, 0);
  assert.equal(result.indexes.diagnosticById.size, 0);
  assert.equal(result.indexes.diagnosticsByTargetId.size, 0);
});

test("project evidence assembly sorts relations and builds relation indexes", () => {
  const result = buildProjectEvidence({
    entities: {
      sourceFiles: [
        { id: "source:b", filePath: "src/B.tsx", moduleKind: "source" },
        { id: "source:a", filePath: "src/A.tsx", moduleKind: "source" },
      ],
      stylesheets: [
        {
          id: "stylesheet:b",
          filePath: "src/b.css",
          origin: "project-css",
          definitions: [],
          selectors: [],
        },
        {
          id: "stylesheet:a",
          filePath: "src/a.css",
          origin: "project-css",
          definitions: [],
          selectors: [],
        },
      ],
      components: [
        {
          id: "component:b",
          componentKey: "src/B.tsx#B",
          filePath: "src/B.tsx",
          componentName: "B",
          exported: true,
          location: anchor("src/B.tsx", 1, 1),
        },
        {
          id: "component:a",
          componentKey: "src/A.tsx#A",
          filePath: "src/A.tsx",
          componentName: "A",
          exported: true,
          location: anchor("src/A.tsx", 1, 1),
        },
      ],
      classDefinitions: [
        classDefinition("definition:b", "stylesheet:b", "button"),
        classDefinition("definition:a", "stylesheet:a", "button"),
      ],
      classReferences: [
        classReference("reference:b", "source:b", "component:b", "button"),
        classReference("reference:a", "source:a", "component:a", "button"),
      ],
      selectorBranches: [
        selectorBranch("selector-branch:b", "stylesheet:b", "rule:b"),
        selectorBranch("selector-branch:a", "stylesheet:a", "rule:a"),
      ],
      cssDeclarations: [
        cssDeclaration("css-declaration:b", "stylesheet:b", "rule:b", "selector-branch:b"),
        cssDeclaration("css-declaration:a", "stylesheet:a", "rule:a", "selector-branch:a"),
      ],
    },
    relations: {
      referenceMatches: [
        referenceMatch("reference-match:b", "reference:b", "definition:b", "button"),
        referenceMatch("reference-match:a", "reference:a", "definition:a", "button"),
      ],
      stylesheetReachability: [
        stylesheetReachability("stylesheet:b", "source:b", "component:b", "possible"),
        stylesheetReachability("stylesheet:a", "source:a", "component:a", "definite"),
      ],
    },
  });

  assert.deepEqual(
    result.relations.referenceMatches.map((match) => match.id),
    ["reference-match:a", "reference-match:b"],
  );
  assert.deepEqual(result.indexes.classDefinitionIdsByClassName.get("button"), [
    "definition:a",
    "definition:b",
  ]);
  assert.deepEqual(result.indexes.classReferenceIdsByClassName.get("button"), [
    "reference:a",
    "reference:b",
  ]);
  assert.deepEqual(result.indexes.classReferenceMatchIdsByDefinitionId.get("definition:a"), [
    "reference-match:a",
  ]);
  assert.deepEqual(result.indexes.classReferenceMatchIdsByReferenceId.get("reference:b"), [
    "reference-match:b",
  ]);
  assert.deepEqual(result.indexes.selectorBranchIdsByStylesheetId.get("stylesheet:a"), [
    "selector-branch:a",
  ]);
  assert.deepEqual(result.indexes.cssDeclarationIdsByStylesheetId.get("stylesheet:a"), [
    "css-declaration:a",
  ]);
  assert.deepEqual(result.indexes.cssDeclarationIdsByRuleDefinitionNodeId.get("rule:a"), [
    "css-declaration:a",
  ]);
  assert.deepEqual(result.indexes.cssDeclarationIdsBySelectorBranchId.get("selector-branch:a"), [
    "css-declaration:a",
  ]);
  assert.deepEqual(result.indexes.cssDeclarationIdsByProperty.get("color"), [
    "css-declaration:a",
    "css-declaration:b",
  ]);
  assert.deepEqual(result.indexes.stylesheetReachabilityIdsByStylesheetId.get("stylesheet:a"), [
    "project-evidence:stylesheet-reachability:stylesheet:a:source:a:component:a:definite",
  ]);
});

test("project evidence assembly exposes stylesheet declarations from parsed CSS", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./styles.css";\nexport function App() { return <button className="button icon">Save</button>; }\n',
    )
    .withCssFile(
      "src/styles.css",
      ".button, .link { color: red !important; }\n@media (min-width: 40rem) { .button .icon { display: inline-block; } }\n",
    )
    .build();

  try {
    const result = await runAnalysisPipeline({
      scanInput: {
        rootDir: project.rootDir,
        sourceFilePaths: ["src/App.tsx"],
      },
      includeTraces: false,
    });
    const projectEvidence = result.analysisEvidence.projectEvidence;
    const declarations = projectEvidence.entities.cssDeclarations;

    assert.equal(projectEvidence.meta.cssDeclarationCount, 2);
    assert.equal(declarations.length, 2);
    assert.deepEqual(
      declarations.map((declaration) => [
        declaration.property,
        declaration.value,
        declaration.important,
        declaration.selectorText,
        declaration.atRuleContext.map((entry) => `${entry.name}:${entry.params}`).join("|"),
      ]),
      [
        ["color", "red", true, ".button, .link", ""],
        ["display", "inline-block", false, ".button .icon", "media:(min-width: 40rem)"],
      ],
    );

    const colorDeclarations = projectEvidence.indexes.cssDeclarationIdsByProperty.get("color");
    assert.equal(colorDeclarations?.length, 1);
    assert.equal(declarations[0].selectorBranchIds.length, 2);
    for (const declaration of declarations) {
      assert.equal(projectEvidence.indexes.cssDeclarationsById.get(declaration.id), declaration);
      assert.ok(declaration.location?.filePath.endsWith("src/styles.css"));
      assert.ok(declaration.selectorBranchIds.length > 0);
    }
  } finally {
    await project.cleanup();
  }
});

function anchor(filePath, startLine, startColumn) {
  return { filePath, startLine, startColumn };
}

function classDefinition(id, stylesheetId, className) {
  return {
    id,
    stylesheetId,
    className,
    selectorText: `.${className}`,
    selectorKind: "simple-root",
    line: 1,
    atRuleContext: [],
    declarationProperties: [],
    declarationSignature: "",
    isCssModule: false,
    sourceDefinition: {},
  };
}

function classReference(id, sourceFileId, componentId, className) {
  return {
    id,
    sourceFileId,
    componentId,
    location: anchor("src/App.tsx", 1, 1),
    origin: "render-ir",
    expressionKind: "exact-string",
    rawExpressionText: `"${className}"`,
    definiteClassNames: [className],
    possibleClassNames: [],
    unknownDynamic: false,
    confidence: "high",
    traces: [],
    sourceSummary: {},
  };
}

function selectorBranch(id, stylesheetId, ruleDefinitionNodeId) {
  return {
    id,
    selectorQueryId: `query:${id}`,
    ruleDefinitionNodeId,
    stylesheetId,
    selectorText: ".button",
    selectorListText: ".button",
    branchIndex: 0,
    branchCount: 1,
    ruleKey: `rule:${id}`,
    outcome: "matchable",
    status: "supported",
    confidence: "high",
    traces: [],
    sourceQuery: {},
  };
}

function cssDeclaration(id, stylesheetId, ruleDefinitionNodeId, selectorBranchId) {
  return {
    id,
    stylesheetId,
    ruleDefinitionNodeId,
    selectorBranchIds: [selectorBranchId],
    selectorText: ".button",
    declarationIndex: 0,
    ruleSourceOrder: 0,
    property: "color",
    value: "red",
    important: false,
    atRuleContext: [],
    sourceDeclaration: {
      property: "color",
      value: "red",
      important: false,
    },
  };
}

function referenceMatch(id, referenceId, definitionId, className) {
  return {
    id,
    referenceId,
    definitionId,
    className,
    referenceClassKind: "definite",
    reachability: "definite",
    matchKind: "reachable-stylesheet",
    reasons: [],
    traces: [],
  };
}

function stylesheetReachability(stylesheetId, sourceFileId, componentId, availability) {
  return {
    stylesheetId,
    sourceFileId,
    componentId,
    availability,
    contexts: [],
    reasons: [],
    traces: [],
  };
}
