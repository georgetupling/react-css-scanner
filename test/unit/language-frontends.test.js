import assert from "node:assert/strict";
import test from "node:test";

import { buildLanguageFrontends } from "../../dist/static-analysis-engine/pipeline/language-frontends/buildLanguageFrontends.js";
import { buildProjectSnapshot } from "../../dist/static-analysis-engine/pipeline/workspace-discovery/buildProjectSnapshot.js";
import { TestProjectBuilder } from "../support/TestProjectBuilder.js";

test("language frontends consume ProjectSnapshot and expose compatibility projections", async () => {
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
      frontends.compatibility.sourceFiles.map((file) => file.filePath),
      ["src/components/Button.tsx", "src/Zed.jsx"],
    );
    assert.deepEqual(
      frontends.compatibility.parsedFiles.map((file) => file.filePath),
      ["src/components/Button.tsx", "src/Zed.jsx"],
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
    assert.deepEqual(
      frontends.compatibility.selectorCssSources.map((file) => file.filePath),
      ["src/components/Button.module.css", "src/zed.css"],
    );
    assert.deepEqual(frontends.compatibility.projectAnalysisStylesheets, [
      {
        filePath: "src/components/Button.module.css",
        cssKind: "css-module",
        origin: "project",
      },
      {
        filePath: "src/zed.css",
        cssKind: "global-css",
        origin: "project",
      },
    ]);
    assert.equal(frontends.compatibility.projectRoot, snapshot.rootDir);
    assert.equal(frontends.compatibility.cssModules, snapshot.config.cssModules);
    assert.deepEqual(frontends.compatibility.boundaries, snapshot.boundaries);
    assert.deepEqual(frontends.compatibility.resourceEdges, snapshot.edges);
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
  } finally {
    await project.cleanup();
  }
});
