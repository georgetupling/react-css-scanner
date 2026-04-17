import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";

import {
  DEFAULT_CONFIG,
  discoverProjectFiles,
  extractProjectFacts,
  normalizeReactCssScannerConfig,
} from "../../dist/index.js";

async function withTempDir(run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "react-css-scanner-facts-test-"));

  try {
    await writeProjectFile(
      tempDir,
      "package.json",
      '{\n  "name": "facts-test",\n  "dependencies": {\n    "react": "^18.0.0"\n  }\n}\n',
    );
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
    await writeProjectFile(
      tempDir,
      "index.html",
      '<link rel="stylesheet" href="https://example.com/app.css" />',
    );
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
    assert.deepEqual(
      result.htmlFiles.map((file) => file.relativePath),
      ["index.html"],
    );
  });
});

test("auto-discovers nested React source roots when source.include is omitted", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "apps/web/package.json",
      '{\n  "name": "apps-web",\n  "dependencies": {\n    "react": "^18.0.0"\n  }\n}\n',
    );
    await writeProjectFile(
      tempDir,
      "packages/ui/package.json",
      '{\n  "name": "packages-ui",\n  "peerDependencies": {\n    "react": "^18.0.0"\n  }\n}\n',
    );
    await writeProjectFile(
      tempDir,
      "apps/web/src/App.tsx",
      "export function App() { return null; }",
    );
    await writeProjectFile(
      tempDir,
      "packages/ui/src/Button.tsx",
      "export function Button() { return null; }",
    );
    await writeProjectFile(tempDir, "tools/scripts/index.ts", "export const task = true;");

    const result = await discoverProjectFiles(DEFAULT_CONFIG, tempDir);

    assert.deepEqual(
      result.sourceFiles.map((file) => file.relativePath),
      ["apps/web/src/App.tsx", "packages/ui/src/Button.tsx"],
    );
  });
});

test("auto-discovery fails clearly when no React source roots are found", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(tempDir, "package.json", '{\n  "name": "no-react"\n}\n');
    await writeProjectFile(tempDir, "src/App.tsx", "export function App() { return null; }");

    await assert.rejects(
      () => discoverProjectFiles(DEFAULT_CONFIG, tempDir),
      (error) => {
        assert.match(error.message, /No React source roots were discovered automatically/i);
        return true;
      },
    );
  });
});

test("explicit source.include bypasses React auto-discovery", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(tempDir, "package.json", '{\n  "name": "explicit-include-test"\n}\n');
    await writeProjectFile(tempDir, "custom/App.tsx", "export function App() { return null; }");

    const config = normalizeReactCssScannerConfig({
      source: {
        include: ["custom"],
      },
    });

    const result = await discoverProjectFiles(config, tempDir);

    assert.deepEqual(
      result.sourceFiles.map((file) => file.relativePath),
      ["custom/App.tsx"],
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
          reference.confidence === "high" &&
          typeof reference.line === "number" &&
          typeof reference.column === "number",
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

test("extracts class references through const indirection and boolean-gated expressions", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/Button.tsx",
      [
        "const variant = 'primary';",
        "const iconOnly = true;",
        "const buttonClassName = `button button--${variant}`;",
        "export function Button() {",
        "  return (",
        "    <button className={buttonClassName}>",
        '      {iconOnly && <span className={iconOnly && "button__spinner"} />}',
        "    </button>",
        "  );",
        "}",
      ].join("\n"),
    );

    const result = await extractProjectFacts(DEFAULT_CONFIG, tempDir);
    const buttonFacts = result.sourceFacts.find((fact) => fact.filePath === "src/Button.tsx");

    assert.ok(buttonFacts);
    assert.ok(buttonFacts.classReferences.some((reference) => reference.className === "button"));
    assert.ok(
      buttonFacts.classReferences.some((reference) => reference.className === "button--primary"),
    );
    assert.ok(
      buttonFacts.classReferences.some((reference) => reference.className === "button__spinner"),
    );
    assert.ok(buttonFacts.classReferences.every((reference) => typeof reference.line === "number"));
    assert.ok(
      buttonFacts.classReferences.every((reference) => typeof reference.column === "number"),
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
    const buttonDefinition = cssFacts.classDefinitions.find(
      (definition) => definition.className === "button",
    );
    assert.equal(buttonDefinition?.selector, ".page .button");
    assert.equal(buttonDefinition?.selectorBranch.matchKind, "contextual");
    assert.deepEqual(buttonDefinition?.selectorBranch.contextClassNames, ["page"]);

    const buttonPrimaryDefinition = cssFacts.classDefinitions.find(
      (definition) => definition.className === "buttonPrimary",
    );
    assert.equal(buttonPrimaryDefinition?.selector, ".buttonPrimary:hover");
    assert.equal(buttonPrimaryDefinition?.selectorBranch.matchKind, "standalone");
    assert.equal(buttonPrimaryDefinition?.selectorBranch.hasSubjectModifiers, true);
    assert.ok(cssFacts.classDefinitions.every((definition) => typeof definition.line === "number"));
  });
});

test("extracts selector branch semantics for standalone, compound, and contextual selectors", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/styles/selector-shapes.css",
      [
        ".button {}",
        ".button.button--primary {}",
        ".toolbar .button__icon {}",
        ".button:not(.button--disabled) {}",
      ].join("\n"),
    );

    const result = await extractProjectFacts(DEFAULT_CONFIG, tempDir);
    const cssFacts = result.cssFacts.find(
      (fact) => fact.filePath === "src/styles/selector-shapes.css",
    );

    assert.ok(cssFacts);

    const baseButton = cssFacts.classDefinitions.find(
      (definition) => definition.className === "button" && definition.selector === ".button",
    );
    assert.equal(baseButton?.selectorBranch.matchKind, "standalone");

    const compoundButton = cssFacts.classDefinitions.find(
      (definition) =>
        definition.className === "button" && definition.selector === ".button.button--primary",
    );
    assert.equal(compoundButton?.selectorBranch.matchKind, "compound");
    assert.deepEqual(compoundButton?.selectorBranch.requiredClassNames, [
      "button",
      "button--primary",
    ]);

    const contextualIcon = cssFacts.classDefinitions.find(
      (definition) => definition.className === "button__icon",
    );
    assert.equal(contextualIcon?.selectorBranch.matchKind, "contextual");
    assert.deepEqual(contextualIcon?.selectorBranch.contextClassNames, ["toolbar"]);

    const negatedButton = cssFacts.classDefinitions.find(
      (definition) =>
        definition.className === "button" &&
        definition.selector === ".button:not(.button--disabled)",
    );
    assert.equal(negatedButton?.selectorBranch.matchKind, "standalone");
    assert.deepEqual(negatedButton?.selectorBranch.negativeClassNames, ["button--disabled"]);
  });
});

test("extracts at-rule context and declaration values for style rules", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "src/styles/responsive.css",
      [
        ".card { display: flex; gap: 1rem; }",
        "@media (min-width: 768px) {",
        "  .card { display: grid; gap: 2rem; }",
        "  .card__empty {}",
        "}",
      ].join("\n"),
    );

    const result = await extractProjectFacts(DEFAULT_CONFIG, tempDir);
    const cssFacts = result.cssFacts.find((fact) => fact.filePath === "src/styles/responsive.css");

    assert.ok(cssFacts);
    assert.equal(cssFacts.styleRules.length, 3);

    const rootCardRule = cssFacts.styleRules.find(
      (styleRule) => styleRule.selector === ".card" && styleRule.atRuleContext.length === 0,
    );
    assert.deepEqual(rootCardRule?.declarations, [
      { property: "display", value: "flex" },
      { property: "gap", value: "1rem" },
    ]);

    const mediaCardRule = cssFacts.styleRules.find(
      (styleRule) => styleRule.selector === ".card" && styleRule.atRuleContext.length === 1,
    );
    assert.deepEqual(mediaCardRule?.atRuleContext, [
      { name: "media", params: "(min-width: 768px)" },
    ]);
    assert.deepEqual(mediaCardRule?.declarations, [
      { property: "display", value: "grid" },
      { property: "gap", value: "2rem" },
    ]);

    const emptyCardDefinition = cssFacts.classDefinitions.find(
      (definition) => definition.className === "card__empty",
    );
    assert.deepEqual(emptyCardDefinition?.declarationDetails, []);
    assert.deepEqual(emptyCardDefinition?.atRuleContext, [
      { name: "media", params: "(min-width: 768px)" },
    ]);
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

test("extracts html stylesheet facts for linked external stylesheets", async () => {
  await withTempDir(async (tempDir) => {
    await writeProjectFile(
      tempDir,
      "index.html",
      [
        "<!doctype html>",
        '<html><head><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" />',
        '<link rel="stylesheet" href="/assets/app.css?v=1" />',
        '<link rel="preconnect" href="https://fonts.googleapis.com" /></head><body></body></html>',
      ].join("\n"),
    );

    const result = await extractProjectFacts(
      normalizeReactCssScannerConfig({
        source: {
          include: ["src"],
        },
      }),
      tempDir,
    );

    assert.deepEqual(result.htmlFacts, [
      {
        filePath: "index.html",
        stylesheetLinks: [
          {
            href: "/assets/app.css?v=1",
            isRemote: false,
          },
          {
            href: "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css",
            isRemote: true,
          },
        ],
      },
    ]);
  });
});
