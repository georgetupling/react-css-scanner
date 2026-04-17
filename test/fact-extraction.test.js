import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";

import { DEFAULT_CONFIG, discoverProjectFiles, extractProjectFacts } from "../dist/index.js";

async function withTempDir(run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "react-css-scanner-facts-test-"));

  try {
    await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeProjectFile(rootDir, relativePath, content) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

test("discovers source and css files deterministically with include/exclude rules", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(tempDir, "src/App.tsx", "export const App = () => null;");
    await writeProjectFile(tempDir, "src/components/Button.css", ".button {}");
    await writeProjectFile(tempDir, "build/Ignore.tsx", "export const Ignore = () => null;");
    await writeProjectFile(tempDir, "src/notes.txt", "ignore");

    const result = await discoverProjectFiles(DEFAULT_CONFIG, tempDir);

    assert.deepEqual(
      result.sourceFiles.map((file) => file.relativePath),
      ["src/App.tsx"],
    );
    assert.deepEqual(
      result.cssFiles.map((file) => file.relativePath),
      ["src/components/Button.css"],
    );
  });
});

test("extracts source facts for local css, external css, helpers, and css modules", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      [
        'import clsx from "clsx";',
        'import styles from "./Button.module.css";',
        'import "./App.css";',
        'import "bootstrap/dist/css/bootstrap.css";',
        "",
        'const variant = "hero";',
        "export function App() {",
        '  return <div className={clsx("app shell", styles.button, styles[variant])} />;',
        "}",
      ].join("\n"),
    );
    await writeProjectFile(tempDir, "src/App.css", ".app {} .shell {}");
    await writeProjectFile(tempDir, "src/Button.module.css", ".button {}");

    const result = await extractProjectFacts(DEFAULT_CONFIG, tempDir);
    const appFacts = result.sourceFacts.find((fact) => fact.filePath === "src/App.tsx");

    assert.ok(appFacts);
    assert.deepEqual(
      appFacts.imports.map((item) => [item.kind, item.specifier]),
      [
        ["css", "./App.css"],
        ["external-css", "bootstrap/dist/css/bootstrap.css"],
        ["source", "clsx"],
      ],
    );
    assert.deepEqual(appFacts.cssModuleImports, [
      {
        specifier: "./Button.module.css",
        localName: "styles",
        resolvedPath: "src/Button.module.css",
      },
    ]);
    assert.deepEqual(appFacts.helperImports, ["clsx"]);
    assert.ok(
      appFacts.classReferences.some(
        (reference) =>
          reference.className === "app" &&
          reference.kind === "helper-call" &&
          reference.confidence === "high",
      ),
    );
    assert.ok(
      appFacts.classReferences.some(
        (reference) => reference.className === "button" && reference.kind === "css-module-property",
      ),
    );
    assert.ok(
      appFacts.classReferences.some(
        (reference) => reference.kind === "css-module-dynamic-property",
      ),
    );
  });
});

test("extracts css facts for class definitions and css imports", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/styles/site.css",
      [
        '@import "./theme.css";',
        '@import "bootstrap/dist/css/bootstrap.css";',
        ".page .button, .buttonPrimary:hover { color: red; }",
      ].join("\n"),
    );

    const result = await extractProjectFacts(DEFAULT_CONFIG, tempDir);
    const cssFacts = result.cssFacts.find((fact) => fact.filePath === "src/styles/site.css");

    assert.ok(cssFacts);
    assert.deepEqual(
      cssFacts.imports.map((item) => [item.specifier, item.isExternal]),
      [
        ["./theme.css", false],
        ["bootstrap/dist/css/bootstrap.css", true],
      ],
    );
    assert.ok(cssFacts.classDefinitions.some((definition) => definition.className === "button"));
    assert.ok(
      cssFacts.classDefinitions.some((definition) => definition.className === "buttonPrimary"),
    );
  });
});

test("extracts imported external css facts from node_modules only when referenced", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/App.tsx",
      [
        'import "bootstrap/dist/css/bootstrap.css";',
        'export function App() { return <div className="btn" />; }',
      ].join("\n"),
    );
    await writeProjectFile(
      tempDir,
      "node_modules/bootstrap/dist/css/bootstrap.css",
      ".btn { display: inline-block; } .alert { color: red; }",
    );
    await writeProjectFile(tempDir, "node_modules/unused/styles.css", ".ghost {}");

    const result = await extractProjectFacts(DEFAULT_CONFIG, tempDir);

    assert.deepEqual(
      result.externalCssFacts.map((fact) => fact.specifier),
      ["bootstrap/dist/css/bootstrap.css"],
    );
    assert.ok(
      result.externalCssFacts[0].classDefinitions.some(
        (definition) => definition.className === "btn",
      ),
    );
    assert.ok(!result.externalCssFacts.some((fact) => fact.specifier === "unused/styles.css"));
  });
});
