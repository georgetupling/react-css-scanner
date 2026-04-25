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

test("ProjectAnalysis treats namespace CSS Module imports as object imports", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/Button.tsx",
        sourceText:
          'import * as styles from "./Button.module.css";\nexport function Button() { return <button className={styles.root}>Button</button>; }\n',
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
  const match = analysis.relations.cssModuleMemberMatches[0];

  assert.equal(cssModuleImport.importKind, "namespace");
  assert.equal(cssModuleImport.importedName, "*");
  assert.equal(match.status, "matched");
});

test("ProjectAnalysis records named CSS Module imports as member references", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/Button.tsx",
        sourceText:
          'import { fooBar, button as buttonClass } from "./Button.module.css";\nexport function Button() { return <button className={buttonClass}>Button</button>; }\n',
      },
    ],
    selectorCssSources: [
      {
        filePath: "src/Button.module.css",
        cssText: ".foo-bar { display: block; }\n.button { color: red; }\n",
      },
    ],
  });

  const analysis = result.projectAnalysis;
  const bindings = analysis.entities.cssModuleNamedImportBindings;
  const references = analysis.entities.cssModuleMemberReferences;
  const matches = analysis.relations.cssModuleMemberMatches;

  assert.deepEqual(
    bindings.map((binding) => [binding.importedName, binding.localName]),
    [
      ["button", "buttonClass"],
      ["fooBar", "fooBar"],
    ],
  );
  assert.deepEqual(
    references.map((reference) => [reference.memberName, reference.accessKind]),
    [
      ["button", "named-import"],
      ["fooBar", "named-import"],
    ],
  );
  assert.deepEqual(
    matches.map((match) => [match.className, match.exportName, match.status]),
    [
      ["button", "button", "matched"],
      ["foo-bar", "fooBar", "matched"],
    ],
  );
  assert.deepEqual(
    analysis.indexes.cssModuleNamedImportBindingsByImportId.get(bindings[0].importId),
    [bindings[0].id],
  );
});

test("ProjectAnalysis projects CSS Module members into generic class references", () => {
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
  const memberReference = analysis.entities.cssModuleMemberReferences[0];
  const classReference = analysis.entities.classReferences.find(
    (reference) => reference.origin === "css-module-member",
  );
  const referenceMatch = analysis.relations.referenceMatches.find(
    (match) => match.referenceId === classReference?.id,
  );

  assert.ok(classReference);
  assert.equal(classReference.sourceCssModuleMemberReferenceId, memberReference.id);
  assert.deepEqual(classReference.definiteClassNames, ["foo-bar"]);
  assert.equal(classReference.rawExpressionText, "styles.fooBar");
  assert.equal(referenceMatch?.matchKind, "css-module");
  assert.equal(referenceMatch?.className, "foo-bar");
  assert.equal(referenceMatch?.reachability, "definite");
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

test("ProjectAnalysis projects missing CSS Module members as generic class references", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/Button.tsx",
        sourceText:
          'import styles from "./Button.module.css";\nexport function Button() { return <button className={styles.missing}>Button</button>; }\n',
      },
    ],
    selectorCssSources: [
      {
        filePath: "src/Button.module.css",
        cssText: ".root { display: block; }\n",
      },
    ],
  });

  const classReference = result.projectAnalysis.entities.classReferences.find(
    (reference) => reference.origin === "css-module-member",
  );

  assert.ok(classReference);
  assert.deepEqual(classReference.definiteClassNames, ["missing"]);
  assert.equal(
    result.projectAnalysis.relations.referenceMatches.some(
      (match) => match.referenceId === classReference.id,
    ),
    false,
  );
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

test("ProjectAnalysis resolves CSS Module member references through simple aliases", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/Button.tsx",
        sourceText: [
          'import styles from "./Button.module.css";',
          "const s = styles;",
          "export function Button() { return <button className={s.root}>Button</button>; }",
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

  const analysis = result.projectAnalysis;
  const cssModuleImport = analysis.entities.cssModuleImports[0];
  const alias = analysis.entities.cssModuleAliases[0];
  const reference = analysis.entities.cssModuleMemberReferences[0];
  const match = analysis.relations.cssModuleMemberMatches[0];

  assert.equal(alias.localName, "styles");
  assert.equal(alias.aliasName, "s");
  assert.equal(reference.localName, "styles");
  assert.equal(reference.memberName, "root");
  assert.equal(reference.rawExpressionText, "s.root");
  assert.equal(match.status, "matched");
  assert.deepEqual(analysis.indexes.cssModuleAliasesByImportId.get(cssModuleImport.id), [alias.id]);
});

test("ProjectAnalysis diagnoses unsupported CSS Module alias declarations", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/Button.tsx",
        sourceText: [
          'import styles from "./Button.module.css";',
          "let s = styles;",
          "const styles = styles;",
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
    ["reassignable-css-module-alias", "self-referential-css-module-alias"],
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
