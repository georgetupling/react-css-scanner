import assert from "node:assert/strict";
import test from "node:test";

import ts from "typescript";

import {
  buildLanguageFrontends,
  buildSourceFrontendFactsFromSourceFiles,
} from "../../dist/static-analysis-engine/pipeline/language-frontends/buildLanguageFrontends.js";
import { getCssModuleMemberAccess } from "../../dist/static-analysis-engine/pipeline/language-frontends/source/css-module-syntax/analyzeCssModuleMemberAccess.js";
import { buildCssModuleAliases } from "../../dist/static-analysis-engine/pipeline/language-frontends/source/css-module-syntax/analyzeCssModuleAliases.js";
import { getCssModuleDestructuring } from "../../dist/static-analysis-engine/pipeline/language-frontends/source/css-module-syntax/analyzeCssModuleDestructuring.js";
import { buildProjectSnapshot } from "../../dist/static-analysis-engine/pipeline/workspace-discovery/buildProjectSnapshot.js";
import { TestProjectBuilder } from "../support/TestProjectBuilder.js";

test("language frontends consume ProjectSnapshot and expose target source facts", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/Zed.jsx",
      'import "./zed.css";\nexport function Zed() { return <div className="zed" />; }\n',
    )
    .withSourceFile(
      "src/components/Button.tsx",
      'import styles from "./Button.module.css";\nexport function Button() { return <button className={styles.root}>Button</button>; }\n',
    )
    .withCssFile("src/zed.css", ".zed { color: red; }\n")
    .withCssFile(
      "src/components/Button.module.css",
      ".root, .root.primary { display: inline-flex; }\n",
    )
    .build();

  try {
    const snapshot = await buildProjectSnapshot({
      scanInput: {
        rootDir: project.rootDir,
        sourceFilePaths: ["src/Zed.jsx", "src/components/Button.tsx"],
        cssFilePaths: ["src/zed.css", "src/components/Button.module.css"],
      },
      runStage: async (_stage, _message, run) => run(),
    });

    const frontends = buildLanguageFrontends({ snapshot });

    assert.deepEqual(
      frontends.source.files.map((file) => ({
        filePath: file.filePath,
        languageKind: file.languageKind,
        parsedFileName: file.legacy.parsedFile.parsedSourceFile.fileName,
      })),
      [
        {
          filePath: "src/components/Button.tsx",
          languageKind: "tsx",
          parsedFileName: "src/components/Button.tsx",
        },
        {
          filePath: "src/Zed.jsx",
          languageKind: "jsx",
          parsedFileName: "src/Zed.jsx",
        },
      ],
    );
    assert.deepEqual(
      frontends.source.files.map((file) => ({
        filePath: file.filePath,
        imports: file.moduleSyntax.imports.map((importRecord) => ({
          specifier: importRecord.specifier,
          importKind: importRecord.importKind,
        })),
        exports: file.moduleSyntax.exports.map((exportRecord) => exportRecord.exportedName),
        values: [...file.moduleSyntax.declarations.valueDeclarations.keys()],
      })),
      [
        {
          filePath: "src/components/Button.tsx",
          imports: [
            {
              specifier: "./Button.module.css",
              importKind: "css",
            },
          ],
          exports: ["Button"],
          values: ["Button"],
        },
        {
          filePath: "src/Zed.jsx",
          imports: [
            {
              specifier: "./zed.css",
              importKind: "css",
            },
          ],
          exports: ["Zed"],
          values: ["Zed"],
        },
      ],
    );
    assert.equal("compatibility" in frontends, false);
  } finally {
    await project.cleanup();
  }
});

test("language frontends parse CSS into deterministic frontend facts", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile("src/App.tsx", "export function App() { return null; }\n")
    .withCssFile("src/b.css", ".beta .item, .beta.active { color: blue; }\n")
    .withCssFile("src/a.module.css", ".root { color: red; }\n")
    .build();

  try {
    const snapshot = await buildProjectSnapshot({
      scanInput: {
        rootDir: project.rootDir,
        sourceFilePaths: ["src/App.tsx"],
        cssFilePaths: ["src/b.css", "src/a.module.css"],
      },
      runStage: async (_stage, _message, run) => run(),
    });

    const frontends = buildLanguageFrontends({ snapshot });

    assert.deepEqual(
      frontends.css.files.map((file) => file.filePath),
      ["src/a.module.css", "src/b.css"],
    );
    assert.deepEqual(
      frontends.css.files.map((file) => ({
        filePath: file.filePath,
        cssKind: file.cssKind,
        origin: file.origin,
        ruleCount: file.rules.length,
        selectorEntryCount: file.selectorEntries.length,
        ruleSelectors: file.rules.map((rule) => rule.selector),
      })),
      [
        {
          filePath: "src/a.module.css",
          cssKind: "css-module",
          origin: "project",
          ruleCount: 1,
          selectorEntryCount: 1,
          ruleSelectors: [".root"],
        },
        {
          filePath: "src/b.css",
          cssKind: "global-css",
          origin: "project",
          ruleCount: 1,
          selectorEntryCount: 2,
          ruleSelectors: [".beta .item, .beta.active"],
        },
      ],
    );
    assert.deepEqual(frontends.css.filesByPath.get("src/b.css").rules[0].declarations, [
      {
        property: "color",
        value: "blue",
      },
    ]);
    assert.deepEqual(
      frontends.css.filesByPath.get("src/b.css").selectorEntries.map((entry) => ({
        selectorText: entry.selectorText,
        branchIndex: entry.source.branchIndex,
        branchCount: entry.source.branchCount,
        ruleKey: entry.source.ruleKey,
      })),
      [
        {
          selectorText: ".beta .item",
          branchIndex: 0,
          branchCount: 2,
          ruleKey: "src/b.css:0:.beta .item, .beta.active",
        },
        {
          selectorText: ".beta.active",
          branchIndex: 1,
          branchCount: 2,
          ruleKey: "src/b.css:0:.beta .item, .beta.active",
        },
      ],
    );
  } finally {
    await project.cleanup();
  }
});

test("language frontends collect module syntax import, export, and declaration forms", () => {
  const file = buildSingleSourceFrontendFile(
    "src/module.ts",
    `
      import defaultExport, { named as localNamed, type TypeName } from "./source";
      import * as namespaceSource from "./namespace";
      import type { OnlyType } from "./types";
      import "./reset.css";
      import "https://cdn.test/theme.css";

      const internal = 1;
      export const token = "token";
      export default token;
      export { token as renamed };
      export * from "./barrel";
      export * as grouped from "./grouped";
      export interface Props { tone: Tone; }
      export type Tone = "dark";
      export enum Size { Small = "small" }
      export namespace Theme { export const root = "root"; }
    `,
  );

  assert.deepEqual(
    file.moduleSyntax.imports.map((importRecord) => ({
      specifier: importRecord.specifier,
      importKind: importRecord.importKind,
      importNames: importRecord.importNames.map((importName) => ({
        kind: importName.kind,
        importedName: importName.importedName,
        localName: importName.localName,
        typeOnly: importName.typeOnly,
      })),
    })),
    [
      {
        specifier: "./namespace",
        importKind: "source",
        importNames: [
          {
            kind: "namespace",
            importedName: "*",
            localName: "namespaceSource",
            typeOnly: false,
          },
        ],
      },
      {
        specifier: "./reset.css",
        importKind: "css",
        importNames: [],
      },
      {
        specifier: "./source",
        importKind: "source",
        importNames: [
          {
            kind: "default",
            importedName: "default",
            localName: "defaultExport",
            typeOnly: false,
          },
          {
            kind: "named",
            importedName: "named",
            localName: "localNamed",
            typeOnly: false,
          },
          {
            kind: "named",
            importedName: "TypeName",
            localName: "TypeName",
            typeOnly: true,
          },
        ],
      },
      {
        specifier: "./types",
        importKind: "type-only",
        importNames: [
          {
            kind: "named",
            importedName: "OnlyType",
            localName: "OnlyType",
            typeOnly: true,
          },
        ],
      },
      {
        specifier: "https://cdn.test/theme.css",
        importKind: "css",
        importNames: [],
      },
    ],
  );
  assert.deepEqual(
    file.moduleSyntax.exports.map((exportRecord) => ({
      exportedName: exportRecord.exportedName,
      localName: exportRecord.localName,
      specifier: exportRecord.specifier,
      reexportKind: exportRecord.reexportKind,
      declarationKind: exportRecord.declarationKind,
    })),
    [
      {
        exportedName: "*",
        localName: undefined,
        specifier: "./barrel",
        reexportKind: "star",
        declarationKind: "unknown",
      },
      {
        exportedName: "default",
        localName: "token",
        specifier: undefined,
        reexportKind: undefined,
        declarationKind: "value",
      },
      {
        exportedName: "grouped",
        localName: undefined,
        specifier: "./grouped",
        reexportKind: "namespace",
        declarationKind: "unknown",
      },
      {
        exportedName: "Props",
        localName: "Props",
        specifier: undefined,
        reexportKind: undefined,
        declarationKind: "type",
      },
      {
        exportedName: "renamed",
        localName: "token",
        specifier: undefined,
        reexportKind: undefined,
        declarationKind: "unknown",
      },
      {
        exportedName: "Size",
        localName: "Size",
        specifier: undefined,
        reexportKind: undefined,
        declarationKind: "value",
      },
      {
        exportedName: "Theme",
        localName: "Theme",
        specifier: undefined,
        reexportKind: undefined,
        declarationKind: "value",
      },
      {
        exportedName: "token",
        localName: "token",
        specifier: undefined,
        reexportKind: undefined,
        declarationKind: "value",
      },
      {
        exportedName: "Tone",
        localName: "Tone",
        specifier: undefined,
        reexportKind: undefined,
        declarationKind: "type",
      },
    ],
  );
  assert.deepEqual([...file.moduleSyntax.declarations.typeAliases.keys()], ["Tone"]);
  assert.deepEqual([...file.moduleSyntax.declarations.interfaces.keys()], ["Props"]);
  assert.deepEqual(
    [...file.moduleSyntax.declarations.valueDeclarations.keys()],
    ["internal", "token", "Size", "Theme"],
  );
  assert.deepEqual(
    [...file.moduleSyntax.declarations.exportedLocalNames.entries()],
    [
      ["default", "token"],
      ["Props", "Props"],
      ["renamed", "token"],
      ["Size", "Size"],
      ["Theme", "Theme"],
      ["token", "token"],
      ["Tone", "Tone"],
    ],
  );
});

test("language frontends attach normalized expression syntax to class expression sites", () => {
  const file = buildSingleSourceFrontendFile(
    "src/Button.tsx",
    [
      'import styles from "./Button.module.css";',
      "export function Button({ active, selected, tone }) {",
      '  return <button className={["button", active && styles.root, { selected }, `tone-${tone}`].filter(Boolean).join(" ")} />;',
      "}",
      "",
    ].join("\n"),
  );
  const expressions = new Map(
    file.expressionSyntax.map((expression) => [expression.expressionId, expression]),
  );
  const jsxSite = file.reactSyntax.classExpressionSites.find((site) => site.kind === "jsx-class");
  const cssModuleSite = file.reactSyntax.classExpressionSites.find(
    (site) => site.kind === "css-module-member",
  );

  assert.ok(jsxSite);
  assert.ok(cssModuleSite);
  assert.ok(jsxSite.expressionId);
  assert.equal(expressions.has(jsxSite.expressionId), true);
  assert.equal(cssModuleSite.rawExpressionText, "styles.root");
  assert.equal(expressions.has(cssModuleSite.expressionId), true);

  const joinCall = expressions.get(jsxSite.expressionId);
  assert.equal(joinCall.expressionKind, "call");
  const joinMember = expressions.get(joinCall.calleeExpressionId);
  assert.equal(joinMember.expressionKind, "member-access");
  assert.equal(joinMember.propertyName, "join");
  const filterCall = expressions.get(joinMember.objectExpressionId);
  assert.equal(filterCall.expressionKind, "call");
  const filterMember = expressions.get(filterCall.calleeExpressionId);
  assert.equal(filterMember.expressionKind, "member-access");
  assert.equal(filterMember.propertyName, "filter");
  const arrayExpression = expressions.get(filterMember.objectExpressionId);
  assert.equal(arrayExpression.expressionKind, "array-literal");
  assert.equal(arrayExpression.elementExpressionIds.length, 4);

  const conditionalClass = [...expressions.values()].find(
    (expression) => expression.expressionKind === "binary" && expression.operator === "&&",
  );
  assert.ok(conditionalClass);
  assert.equal(conditionalClass.rightExpressionId, cssModuleSite.expressionId);
  assert.ok(
    [...expressions.values()].some(
      (expression) =>
        expression.expressionKind === "template-literal" && expression.rawText === "`tone-${tone}`",
    ),
  );
});

test("language frontends expose normalized component prop, local binding, and helper facts", () => {
  const file = buildSingleSourceFrontendFile(
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
  );
  const expressions = new Map(
    file.expressionSyntax.map((expression) => [expression.expressionId, expression]),
  );

  assert.equal(file.reactSyntax.componentPropBindings.length, 1);
  const propBinding = file.reactSyntax.componentPropBindings[0];
  assert.equal(propBinding.bindingKind, "destructured-props");
  assert.deepEqual(
    propBinding.properties.map((property) => ({
      propertyName: property.propertyName,
      localName: property.localName,
      initializerRawText: property.initializerExpressionId
        ? expressions.get(property.initializerExpressionId).rawText
        : undefined,
    })),
    [
      {
        propertyName: "className",
        localName: "className",
        initializerRawText: undefined,
      },
      {
        propertyName: "tone",
        localName: "tone",
        initializerRawText: '"primary"',
      },
    ],
  );

  assert.deepEqual(
    file.reactSyntax.helperDefinitions.map((helper) => ({
      helperName: helper.helperName,
      ownerKind: helper.ownerKind,
      definitionKind: helper.definitionKind,
      restParameterName: helper.restParameterName,
      parameterKinds: helper.parameters.map((parameter) => parameter.parameterKind),
      returnRawText: expressions.get(helper.returnExpressionId).rawText,
    })),
    [
      {
        helperName: "joinClasses",
        ownerKind: "source-file",
        definitionKind: "function-declaration",
        restParameterName: "classes",
        parameterKinds: ["rest"],
        returnRawText: 'classes.filter(Boolean).join(" ")',
      },
      {
        helperName: "localJoin",
        ownerKind: "component",
        definitionKind: "function-declaration",
        restParameterName: undefined,
        parameterKinds: ["identifier"],
        returnRawText: "joinClasses(base, extra)",
      },
    ],
  );

  assert.deepEqual(
    file.reactSyntax.localValueBindings
      .map((binding) => ({
        localName: binding.localName,
        ownerKind: binding.ownerKind,
        bindingKind: binding.bindingKind,
        expressionRawText: expressions.get(binding.expressionId).rawText,
      }))
      .sort((left, right) => left.localName.localeCompare(right.localName)),
    [
      {
        localName: "base",
        ownerKind: "helper",
        bindingKind: "const-identifier",
        expressionRawText: "local",
      },
      {
        localName: "classes",
        ownerKind: "component",
        bindingKind: "const-identifier",
        expressionRawText: "localJoin(className)",
      },
      {
        localName: "local",
        ownerKind: "component",
        bindingKind: "const-identifier",
        expressionRawText: '"button"',
      },
    ],
  );
});

test("language frontends annotate render sites with semantic repetition metadata", () => {
  const file = buildSingleSourceFrontendFile(
    "src/List.tsx",
    [
      "export function List({ items }) {",
      "  return (",
      "    <ul>",
      "      {items.map((item) => <li key={item.id}>{item.label}</li>)}",
      "      {Array.from(items, (item) => <li key={item.id}>{item.label}</li>)}",
      "    </ul>",
      "  );",
      "}",
      "",
    ].join("\n"),
  );

  const repeatedSites = file.reactSyntax.renderSites.filter((site) => site.repeatedRegion);
  assert.equal(repeatedSites.length > 0, true);
  assert.equal(
    repeatedSites.some((site) => site.repeatedRegion?.repeatKind === "array-map"),
    true,
  );
  assert.equal(
    repeatedSites.some((site) => site.repeatedRegion?.repeatKind === "array-from"),
    true,
  );
});

test("language frontends annotate finite map callback parameter string values", () => {
  const file = buildSingleSourceFrontendFile(
    "src/App.tsx",
    [
      'const items = ["primary", "secondary"] as const;',
      "export function App() {",
      "  return <>{items.map((tone) => <button className={`btn-${tone}`} />)}</>;",
      "}",
      "",
    ].join("\n"),
  );

  const toneIdentifier = file.expressionSyntax.find(
    (expression) => expression.expressionKind === "identifier" && expression.name === "tone",
  );

  assert.ok(toneIdentifier);
  assert.deepEqual(toneIdentifier.possibleStringValues, ["primary", "secondary"]);
});

test("language frontends expose CSS Module syntax collectors", () => {
  const file = buildSingleSourceFrontendFile(
    "src/Button.tsx",
    `
      import styles from "./Button.module.css";
      const alias = styles;
      let mutable = styles;
      const { root, "foo-bar": fooBar, ...rest } = styles;
      const rootClass = alias.root;
      const literalClass = alias["foo-bar"];
      const computedClass = alias[token];
    `,
  );
  const parsedSourceFile = file.legacy.parsedFile.parsedSourceFile;
  const directBinding = {
    sourceFilePath: file.filePath,
    stylesheetFilePath: "src/Button.module.css",
    specifier: "./Button.module.css",
    localName: "styles",
    originLocalName: "styles",
    importKind: "default",
    sourceKind: "import",
    location: sourceAnchor(file.filePath),
    rawExpressionText: 'import styles from "./Button.module.css"',
    traces: [],
  };
  const aliases = buildCssModuleAliases({
    parsedSourceFile,
    sourceFilePath: file.filePath,
    directNamespaceBindingsByLocalName: new Map([["styles", directBinding]]),
    includeTraces: false,
  });
  const aliasBinding = aliases.aliases[0];
  const namespaceBindings = new Map([
    ["styles", directBinding],
    [aliasBinding.localName, aliasBinding],
  ]);
  const memberAccesses = collectNodes(parsedSourceFile)
    .map((node) =>
      getCssModuleMemberAccess({
        node,
        parsedSourceFile,
        sourceFilePath: file.filePath,
        namespaceBindings,
        includeTraces: false,
      }),
    )
    .filter(Boolean);
  const destructuring = collectNodes(parsedSourceFile)
    .map((node) =>
      getCssModuleDestructuring({
        node,
        parsedSourceFile,
        sourceFilePath: file.filePath,
        namespaceBindings,
        includeTraces: false,
      }),
    )
    .find(Boolean);

  assert.deepEqual(
    aliases.aliases.map((alias) => ({
      localName: alias.localName,
      originLocalName: alias.originLocalName,
      sourceKind: alias.sourceKind,
      rawExpressionText: alias.rawExpressionText,
    })),
    [
      {
        localName: "alias",
        originLocalName: "styles",
        sourceKind: "alias",
        rawExpressionText: "alias = styles",
      },
    ],
  );
  assert.deepEqual(
    aliases.diagnostics.map((diagnostic) => diagnostic.reason),
    ["reassignable-css-module-alias"],
  );
  assert.deepEqual(
    memberAccesses.map((access) =>
      access.kind === "reference"
        ? {
            kind: access.kind,
            memberName: access.reference.memberName,
            accessKind: access.reference.accessKind,
          }
        : {
            kind: access.kind,
            reason: access.diagnostic.reason,
          },
    ),
    [
      {
        kind: "reference",
        memberName: "root",
        accessKind: "property",
      },
      {
        kind: "reference",
        memberName: "foo-bar",
        accessKind: "string-literal-element",
      },
      {
        kind: "diagnostic",
        reason: "computed-css-module-member",
      },
    ],
  );
  assert.deepEqual(
    destructuring.bindings.map((binding) => ({
      localName: binding.localName,
      memberName: binding.memberName,
    })),
    [
      {
        localName: "root",
        memberName: "root",
      },
      {
        localName: "fooBar",
        memberName: "foo-bar",
      },
    ],
  );
  assert.deepEqual(
    destructuring.diagnostics.map((diagnostic) => diagnostic.reason),
    ["rest-css-module-destructuring"],
  );
});

test("language frontends extract runtime DOM class sites from module-backed adapters", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/editor.ts",
      [
        'import { EditorView as ProseMirrorView } from "prosemirror-view";',
        "",
        "new ProseMirrorView(undefined, {",
        "  attributes: {",
        '    class: "ProseMirror editor-shell",',
        "  },",
        "});",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const snapshot = await buildProjectSnapshot({
      scanInput: {
        rootDir: project.rootDir,
        sourceFilePaths: ["src/editor.ts"],
      },
      runStage: async (_stage, _message, run) => run(),
    });

    const frontends = buildLanguageFrontends({ snapshot });
    const runtimeExpression = frontends.source.files[0].expressionSyntax[0];

    assert.deepEqual(
      frontends.source.files.flatMap((file) =>
        file.runtimeDomClassSites.map((site) => ({
          kind: site.kind,
          filePath: site.filePath,
          expressionId: site.expressionId,
          rawExpressionText: site.rawExpressionText,
          classText: site.classText,
          runtimeLibraryHint: site.runtimeLibraryHint,
          adapterName: site.trace.adapterName,
        })),
      ),
      [
        {
          kind: "prosemirror-editor-view-attributes",
          filePath: "src/editor.ts",
          expressionId: runtimeExpression.expressionId,
          rawExpressionText: '"ProseMirror editor-shell"',
          classText: "ProseMirror editor-shell",
          runtimeLibraryHint: {
            packageName: "prosemirror-view",
            importedName: "EditorView",
            localName: "ProseMirrorView",
          },
          adapterName: "prosemirror-editor-view",
        },
      ],
    );
    assert.deepEqual(
      frontends.source.files[0].expressionSyntax.map((expression) => ({
        expressionId: expression.expressionId,
        expressionKind: expression.expressionKind,
        rawText: expression.rawText,
        value: expression.value,
      })),
      [
        {
          expressionId: runtimeExpression.expressionId,
          expressionKind: "string-literal",
          rawText: '"ProseMirror editor-shell"',
          value: "ProseMirror editor-shell",
        },
      ],
    );
  } finally {
    await project.cleanup();
  }
});

function buildSingleSourceFrontendFile(filePath, sourceText) {
  return buildSourceFrontendFactsFromSourceFiles([
    {
      filePath,
      absolutePath: filePath,
      sourceText,
    },
  ]).filesByPath.get(filePath);
}

function sourceAnchor(filePath) {
  return {
    filePath,
    startLine: 1,
    startColumn: 1,
    endLine: 1,
    endColumn: 1,
  };
}

function collectNodes(sourceFile) {
  const nodes = [];

  function visit(node) {
    nodes.push(node);
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return nodes;
}
