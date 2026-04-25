import assert from "node:assert/strict";
import test from "node:test";
import { analyzeProjectSourceTexts } from "../../dist/static-analysis-engine.js";

test("ProjectAnalysis records CSS Module imports, member references, and matches", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/Button.tsx",
        sourceText:
          'import styles from "./Button.module.css";\nexport function Button() { return <button className={styles.root}>Button</button>; }\n',
      },
    ],
    selectorCssSources: [
      {
        filePath: "src/Button.module.css",
        cssText: ".root { display: block; }\n",
      },
    ],
  });

  const analysis = result.projectAnalysis;
  const cssModuleImport = analysis.entities.cssModuleImports[0];
  const reference = analysis.entities.cssModuleMemberReferences[0];
  const match = analysis.relations.cssModuleMemberMatches[0];

  assert.equal(cssModuleImport.localName, "styles");
  assert.equal(cssModuleImport.stylesheetFilePath, "src/Button.module.css");
  assert.equal(reference.memberName, "root");
  assert.equal(reference.accessKind, "property");
  assert.equal(match.status, "matched");
  assert.equal(match.className, "root");
  assert.equal(match.exportName, "root");
  assert.equal(match.definitionId, analysis.entities.classDefinitions[0].id);
  assert.deepEqual(analysis.indexes.cssModuleMemberReferencesByImportId.get(cssModuleImport.id), [
    reference.id,
  ]);
});

test("ProjectAnalysis matches CSS Module members through camelCase locals convention", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/Button.tsx",
        sourceText:
          'import styles from "./Button.module.css";\nexport function Button() { return <button className={styles.fooBar}>Button</button>; }\n',
      },
    ],
    selectorCssSources: [
      {
        filePath: "src/Button.module.css",
        cssText: ".foo-bar { display: block; }\n",
      },
    ],
  });

  const analysis = result.projectAnalysis;
  const match = analysis.relations.cssModuleMemberMatches[0];

  assert.equal(match.status, "matched");
  assert.equal(match.className, "foo-bar");
  assert.equal(match.exportName, "fooBar");
  assert.equal(match.definitionId, analysis.entities.classDefinitions[0].id);
});

test("ProjectAnalysis can require exact CSS Module export names", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/Button.tsx",
        sourceText:
          'import styles from "./Button.module.css";\nexport function Button() { return <button className={styles.fooBar}>Button</button>; }\n',
      },
    ],
    selectorCssSources: [
      {
        filePath: "src/Button.module.css",
        cssText: ".foo-bar { display: block; }\n",
      },
    ],
    cssModules: {
      localsConvention: "asIs",
    },
  });

  const match = result.projectAnalysis.relations.cssModuleMemberMatches[0];

  assert.equal(match.status, "missing");
  assert.equal(match.className, "fooBar");
  assert.equal(match.exportName, "fooBar");
  assert.equal(match.definitionId, undefined);
});

test("ProjectAnalysis records CSS Module destructured bindings as member references", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/Button.tsx",
        sourceText: [
          'import styles from "./Button.module.css";',
          "const { root, button: buttonClass } = styles;",
          "export function Button() { return <button className={buttonClass}>Button</button>; }",
          "",
        ].join("\n"),
      },
    ],
    selectorCssSources: [
      {
        filePath: "src/Button.module.css",
        cssText: ".root { display: block; }\n.button { color: red; }\n",
      },
    ],
  });

  const analysis = result.projectAnalysis;
  const cssModuleImport = analysis.entities.cssModuleImports[0];
  const bindings = analysis.entities.cssModuleDestructuredBindings;
  const references = analysis.entities.cssModuleMemberReferences;
  const matches = analysis.relations.cssModuleMemberMatches;

  assert.deepEqual(
    bindings.map((binding) => [binding.memberName, binding.bindingName]),
    [
      ["button", "buttonClass"],
      ["root", "root"],
    ],
  );
  assert.deepEqual(
    references.map((reference) => [reference.memberName, reference.accessKind]),
    [
      ["button", "destructured-binding"],
      ["root", "destructured-binding"],
    ],
  );
  assert.deepEqual(
    matches.map((match) => [match.className, match.exportName, match.status]),
    [
      ["button", "button", "matched"],
      ["root", "root", "matched"],
    ],
  );
  assert.deepEqual(
    analysis.indexes.cssModuleDestructuredBindingsByImportId.get(cssModuleImport.id),
    [bindings[0].id, bindings[1].id],
  );
});

test("ProjectAnalysis diagnoses unsupported CSS Module destructuring patterns", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/Button.tsx",
        sourceText: [
          'import styles from "./Button.module.css";',
          "const name = 'root';",
          "const { [name]: computed, ...rest } = styles;",
          "",
        ].join("\n"),
      },
    ],
    selectorCssSources: [
      {
        filePath: "src/Button.module.css",
        cssText: ".root { display: block; }\n",
      },
    ],
  });

  assert.deepEqual(
    result.projectAnalysis.entities.cssModuleReferenceDiagnostics.map(
      (diagnostic) => diagnostic.reason,
    ),
    ["rest-css-module-destructuring", "computed-css-module-destructuring"],
  );
});

test("ProjectAnalysis records missing and computed CSS Module member access", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/Button.tsx",
        sourceText:
          'import styles from "./Button.module.css";\nconst name = "root";\nexport function Button() { return <button className={styles.missing + styles[name]}>Button</button>; }\n',
      },
    ],
    selectorCssSources: [
      {
        filePath: "src/Button.module.css",
        cssText: ".root { display: block; }\n",
      },
    ],
  });

  const analysis = result.projectAnalysis;
  const missingMatch = analysis.relations.cssModuleMemberMatches.find(
    (match) => match.className === "missing",
  );
  const diagnostic = analysis.entities.cssModuleReferenceDiagnostics[0];

  assert.equal(missingMatch?.status, "missing");
  assert.equal(diagnostic.reason, "computed-css-module-member");
  assert.equal(diagnostic.rawExpressionText, "styles[name]");
});
