import assert from "node:assert/strict";
import test from "node:test";
import { discoverProjectFileRecords } from "../../dist/static-analysis-engine/pipeline/workspace-discovery/files/discoverProjectFileRecords.js";
import { buildProjectSnapshot } from "../../dist/static-analysis-engine/pipeline/workspace-discovery/buildProjectSnapshot.js";
import { buildLanguageFrontends } from "../../dist/static-analysis-engine/pipeline/language-frontends/buildLanguageFrontends.js";
import { TestProjectBuilder } from "../support/TestProjectBuilder.js";

test("discoverProjectFileRecords scans source, CSS, and HTML under a root directory", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile("src/components/Card.tsx", "export function Card() { return <div />; }\n")
    .withCssFile("src/components/Card.css", ".card {}\n")
    .withFile("index.html", '<link rel="stylesheet" href="/assets/app.css">\n')
    .withFile("public/nested/page.html", "<main></main>\n")
    .withSourceFile("dist/generated.tsx", "export const ignored = true;\n")
    .withNodeModuleFile("library/index.tsx", "export const ignored = true;\n")
    .withNodeModuleFile("library/ignored.html", "<html></html>\n")
    .build();

  try {
    const discovered = await discoverProjectFileRecords({
      rootDir: project.rootDir,
    });

    assert.deepEqual(
      discovered.sourceFiles.map((file) => file.filePath),
      ["src/App.tsx", "src/components/Card.tsx"],
    );
    assert.deepEqual(
      discovered.cssFiles.map((file) => file.filePath),
      ["src/components/Card.css"],
    );
    assert.deepEqual(
      discovered.htmlFiles.map((file) => file.filePath),
      ["index.html", "public/nested/page.html"],
    );
    assert.deepEqual(discovered.diagnostics, []);
  } finally {
    await project.cleanup();
  }
});

test("discoverProjectFileRecords applies default test exclusions and explicit file overrides", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile("src/App.test.tsx", "export function AppTest() { return null; }\n")
    .withSourceFile("src/components/Card.tsx", "export function Card() { return <div />; }\n")
    .withSourceFile("src/components/Card.test.tsx", "export function CardTest() { return null; }\n")
    .withSourceFile("src/__tests__/Fixture.tsx", "export function Fixture() { return null; }\n")
    .withSourceFile("src/test/Helper.tsx", "export function Helper() { return null; }\n")
    .withSourceFile("src/tests/OtherHelper.tsx", "export function OtherHelper() { return null; }\n")
    .withSourceFile("src/components/Card.spec.ts", "export const spec = true;\n")
    .withCssFile("src/components/Card.css", ".card {}\n")
    .build();

  try {
    const defaultDiscovery = await discoverProjectFileRecords({
      rootDir: project.rootDir,
    });
    assert.deepEqual(
      defaultDiscovery.sourceFiles.map((file) => file.filePath),
      ["src/App.tsx", "src/components/Card.tsx"],
    );

    const explicitDiscovery = await discoverProjectFileRecords({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.test.tsx"],
    });
    assert.deepEqual(
      explicitDiscovery.sourceFiles.map((file) => file.filePath),
      ["src/App.test.tsx"],
    );
    assert.deepEqual(
      explicitDiscovery.cssFiles.map((file) => file.filePath),
      ["src/components/Card.css"],
    );
  } finally {
    await project.cleanup();
  }
});

test("discoverProjectFileRecords supports configured source roots and excludes", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile("apps/web/src/App.tsx", "export function App() { return null; }\n")
    .withSourceFile("apps/web/src/App.stories.tsx", "export function Story() { return null; }\n")
    .withSourceFile("backend/src/server.ts", "export const server = true;\n")
    .withSourceFile("packages/ui/src/Button.tsx", "export function Button() { return null; }\n")
    .build();

  try {
    const discovered = await discoverProjectFileRecords({
      rootDir: project.rootDir,
      discovery: {
        sourceRoots: ["apps/web/src", "packages/ui/src"],
        exclude: ["**/*.stories.tsx"],
      },
    });

    assert.deepEqual(
      discovered.sourceFiles.map((file) => file.filePath),
      ["apps/web/src/App.tsx", "packages/ui/src/Button.tsx"],
    );
  } finally {
    await project.cleanup();
  }
});

test("discoverProjectFileRecords discovers configured stylesheet extensions", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile("src/App.tsx", 'import styles from "./App.module.less";\n')
    .withCssFile("src/App.module.less", ".root { color: red; }\n")
    .withCssFile("src/theme.scss", ".theme { color: blue; }\n")
    .build();

  try {
    const discovered = await discoverProjectFileRecords({
      rootDir: project.rootDir,
      discovery: {
        sourceRoots: [],
        exclude: [],
        publicRoots: ["public"],
        aliases: {},
        stylesheetExtensions: [".css", ".less", ".scss", ".sass"],
      },
    });

    assert.deepEqual(
      discovered.cssFiles.map((file) => file.filePath),
      ["src/App.module.less", "src/theme.scss"],
    );
  } finally {
    await project.cleanup();
  }
});

test("buildProjectSnapshot resolves root HTML stylesheet links through public roots", async () => {
  const project = await new TestProjectBuilder()
    .withFile("index.html", '<link rel="stylesheet" href="/styles/initial-loading-screen.css">\n')
    .withCssFile("public/styles/initial-loading-screen.css", ".loading { display: block; }\n")
    .build();

  try {
    const snapshot = await buildProjectSnapshot({
      scanInput: {
        rootDir: project.rootDir,
      },
      runStage: async (_stage, _message, run) => run(),
    });

    assert.ok(
      snapshot.edges.some(
        (edge) =>
          edge.kind === "html-stylesheet" &&
          edge.href === "/styles/initial-loading-screen.css" &&
          edge.resolvedFilePath === "public/styles/initial-loading-screen.css",
      ),
    );
    assert.ok(
      snapshot.files.stylesheets.some(
        (stylesheet) =>
          stylesheet.filePath === "public/styles/initial-loading-screen.css" &&
          stylesheet.origin === "project",
      ),
    );
  } finally {
    await project.cleanup();
  }
});

test("buildProjectSnapshot resolves aliased project stylesheet imports before package CSS", async () => {
  const project = await new TestProjectBuilder()
    .withFile(
      "tsconfig.json",
      JSON.stringify(
        {
          compilerOptions: {
            paths: {
              "shell/*": ["./src/shell/*"],
            },
          },
        },
        null,
        2,
      ),
    )
    .withSourceFile(
      "src/App.tsx",
      'import "shell/components/legacy/vendor.css";\nexport function App() { return null; }\n',
    )
    .withCssFile("src/shell/components/legacy/vendor.css", ".legacy { display: block; }\n")
    .build();

  try {
    const snapshot = await buildProjectSnapshot({
      scanInput: {
        rootDir: project.rootDir,
      },
      runStage: async (_stage, _message, run) => run(),
    });

    assert.ok(
      snapshot.edges.some(
        (edge) =>
          edge.kind === "source-import" &&
          edge.importerFilePath === "src/App.tsx" &&
          edge.specifier === "shell/components/legacy/vendor.css" &&
          edge.importKind === "css" &&
          edge.resolutionStatus === "resolved" &&
          edge.resolvedFilePath === "src/shell/components/legacy/vendor.css",
      ),
    );
    assert.deepEqual(
      snapshot.edges.filter(
        (edge) =>
          edge.kind === "package-css-import" &&
          edge.specifier === "shell/components/legacy/vendor.css",
      ),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("buildProjectSnapshot ignores local export declarations while collecting source reexports", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import { Button } from "./components";',
        "export const localToken = true;",
        "export { localToken };",
        "export function App() { return <Button />; }",
        "",
      ].join("\n"),
    )
    .withSourceFile("src/components/index.ts", 'export { Button } from "./Button";\n')
    .withSourceFile(
      "src/components/Button.tsx",
      'export function Button() { return <button className="button">Save</button>; }\n',
    )
    .withCssFile("src/components/Button.css", ".button { display: inline-flex; }\n")
    .build();

  try {
    const snapshot = await buildProjectSnapshot({
      scanInput: {
        rootDir: project.rootDir,
      },
      runStage: async (_stage, _message, run) => run(),
    });

    assert.ok(
      snapshot.edges.some(
        (edge) =>
          edge.kind === "source-import" &&
          edge.importerFilePath === "src/App.tsx" &&
          edge.specifier === "./components" &&
          edge.resolutionStatus === "resolved" &&
          edge.resolvedFilePath === "src/components/index.ts",
      ),
    );
    assert.ok(
      snapshot.edges.some(
        (edge) =>
          edge.kind === "source-import" &&
          edge.importerFilePath === "src/components/index.ts" &&
          edge.specifier === "./Button" &&
          edge.resolutionStatus === "resolved" &&
          edge.resolvedFilePath === "src/components/Button.tsx",
      ),
    );
  } finally {
    await project.cleanup();
  }
});

test("buildProjectSnapshot compiles Less stylesheets and keeps source maps", async () => {
  const project = await new TestProjectBuilder()
    .withCssFile(
      "src/Card.less",
      [
        '@import "theme/tokens.less";',
        ".card {",
        "  &__title { color: @brand; }",
        "  .icon { color: blue; }",
        "}",
      ].join("\n"),
    )
    .withCssFile("src/theme/tokens.less", "@brand: red;\n.aliasImported { color: blue; }\n")
    .withFile(
      "tsconfig.json",
      JSON.stringify(
        {
          compilerOptions: {
            paths: {
              "theme/*": ["./src/theme/*"],
            },
          },
        },
        null,
        2,
      ),
    )
    .build();

  try {
    const snapshot = await buildProjectSnapshot({
      scanInput: {
        rootDir: project.rootDir,
      },
      runStage: async (_stage, _message, run) => run(),
    });
    const stylesheet = snapshot.files.stylesheets.find(
      (candidate) => candidate.filePath === "src/Card.less",
    );

    assert.ok(stylesheet);
    assert.equal(stylesheet.sourceSyntax, "less");
    assert.equal(stylesheet.compiledFrom?.syntax, "less");
    assert.ok(stylesheet.compiledFrom?.sourceMap);
    assert.match(stylesheet.cssText, /\.card__title/);
    assert.match(stylesheet.cssText, /\.card \.icon/);
    assert.match(stylesheet.cssText, /\.aliasImported/);

    const frontends = buildLanguageFrontends({ snapshot });
    const selectorLocations = frontends.css.files
      .flatMap((file) => file.selectorEntries)
      .map((entry) => entry.source.selectorAnchor)
      .filter(Boolean);
    assert.ok(
      selectorLocations.some(
        (location) => location.filePath === "src/Card.less" && location.startLine === 3,
      ),
    );
    assert.ok(
      selectorLocations.some(
        (location) => location.filePath === "src/theme/tokens.less" && location.startLine === 2,
      ),
    );
    assert.ok(
      frontends.css.files.some((file) =>
        file.rules.some((rule) =>
          rule.selectorBranches.some((branch) => branch.subjectClassNames.includes("card__title")),
        ),
      ),
    );
  } finally {
    await project.cleanup();
  }
});

test("buildProjectSnapshot falls back to raw Less text when Less compilation fails", async () => {
  const project = await new TestProjectBuilder()
    .withCssFile("src/Broken.less", ".broken { color: @missing; }\n")
    .build();

  try {
    const snapshot = await buildProjectSnapshot({
      scanInput: {
        rootDir: project.rootDir,
      },
      runStage: async (_stage, _message, run) => run(),
    });
    const stylesheet = snapshot.files.stylesheets.find(
      (candidate) => candidate.filePath === "src/Broken.less",
    );

    assert.ok(stylesheet);
    assert.equal(stylesheet.cssText, ".broken { color: @missing; }\n");
    assert.ok(
      snapshot.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "loading.less-compile-failed" &&
          diagnostic.filePath === "src/Broken.less",
      ),
    );
  } finally {
    await project.cleanup();
  }
});

test("buildProjectSnapshot inventories bundler config files outside source roots", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile("src/App.tsx", "export function App() { return null; }\n")
    .withSourceFile(
      "vite.config.ts",
      'import { defineConfig } from "vite";\nexport default defineConfig({ build: { cssCodeSplit: false } });\n',
    )
    .withFile(
      "src/shell/webpack.config.js",
      "module.exports = { entry: { manager: path.resolve(__dirname, './index.js') } };\n",
    )
    .withConfig({
      discovery: {
        sourceRoots: ["src"],
      },
    })
    .build();

  try {
    const snapshot = await buildProjectSnapshot({
      scanInput: {
        rootDir: project.rootDir,
      },
      runStage: async (_stage, _message, run) => run(),
    });

    assert.deepEqual(
      snapshot.files.sourceFiles.map((file) => file.filePath),
      ["src/App.tsx"],
    );
    assert.deepEqual(
      snapshot.files.bundlerConfigFiles.map((file) => ({
        kind: file.kind,
        bundler: file.bundler,
        filePath: file.filePath,
        sourceText: file.sourceText,
      })),
      [
        {
          kind: "bundler-config",
          bundler: "webpack",
          filePath: "src/shell/webpack.config.js",
          sourceText:
            "module.exports = { entry: { manager: path.resolve(__dirname, './index.js') } };\n",
        },
        {
          kind: "bundler-config",
          bundler: "vite",
          filePath: "vite.config.ts",
          sourceText:
            'import { defineConfig } from "vite";\nexport default defineConfig({ build: { cssCodeSplit: false } });\n',
        },
      ],
    );
  } finally {
    await project.cleanup();
  }
});

test("buildProjectSnapshot inventories root package metadata outside source roots", async () => {
  const project = await new TestProjectBuilder()
    .withFile(
      "package.json",
      '{ "name": "vite-app", "devDependencies": { "vite": "^5.0.0" }, "scripts": { "build": "vite build" } }\n',
    )
    .withSourceFile("src/App.tsx", "export function App() { return null; }\n")
    .withConfig({
      discovery: {
        sourceRoots: ["src"],
      },
    })
    .build();

  try {
    const snapshot = await buildProjectSnapshot({
      scanInput: {
        rootDir: project.rootDir,
      },
      runStage: async (_stage, _message, run) => run(),
    });

    assert.deepEqual(
      snapshot.files.packageJsonFiles.map((file) => ({
        kind: file.kind,
        filePath: file.filePath,
        packageName: file.packageName,
        devDependencies: file.devDependencies,
        scripts: file.scripts,
      })),
      [
        {
          kind: "package-json",
          filePath: "package.json",
          packageName: "vite-app",
          devDependencies: {
            vite: "^5.0.0",
          },
          scripts: {
            build: "vite build",
          },
        },
      ],
    );
  } finally {
    await project.cleanup();
  }
});

test("discoverProjectFileRecords reports file roots without traversing them", async () => {
  const project = await new TestProjectBuilder().build();

  try {
    const discovered = await discoverProjectFileRecords({
      rootDir: project.filePath("src/App.tsx"),
    });

    assert.deepEqual(discovered.sourceFiles, []);
    assert.deepEqual(discovered.cssFiles, []);
    assert.deepEqual(discovered.htmlFiles, []);
    assert.equal(discovered.diagnostics.length, 1);
    assert.equal(discovered.diagnostics[0].code, "discovery.root-not-directory");
    assert.equal(discovered.diagnostics[0].severity, "error");
    assert.match(discovered.diagnostics[0].message, /scan root must be a directory/);
  } finally {
    await project.cleanup();
  }
});

test("buildProjectSnapshot inventories files, boundaries, and resource edges", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import styles from "./App.module.css";',
        'import "pkg/styles.css";',
        'import "ui";',
        "export function App() { return <main className={styles.root}>Hello</main>; }",
      ].join("\n"),
    )
    .withSourceFile("packages/ui/src/index.ts", "export const Button = 'button';\n")
    .withCssFile("src/App.module.css", ".root { display: block; }\n")
    .withFile(
      "index.html",
      '<link rel="stylesheet" href="/public/global.css">\n<script src="/src/App.tsx"></script>\n',
    )
    .withCssFile(
      "public/global.css",
      '@import "./reset.css";\n@import "pkg/reset.css";\n.global { color: red; }\n',
    )
    .withCssFile("public/reset.css", ".reset { box-sizing: border-box; }\n")
    .withNodeModuleFile("pkg/styles.css", ".pkg { color: blue; }\n")
    .withNodeModuleFile("pkg/reset.css", ".pkg-reset { margin: 0; }\n")
    .build();

  try {
    const snapshot = await buildProjectSnapshot({
      scanInput: {
        rootDir: project.rootDir,
        cssFilePaths: ["src/App.module.css", "public/reset.css"],
      },
      runStage: async (_stage, _message, run) => run(),
    });

    assert.deepEqual(
      snapshot.files.sourceFiles.map((file) => file.filePath),
      ["packages/ui/src/index.ts", "src/App.tsx"],
    );
    assert.deepEqual(
      snapshot.files.stylesheets.map((stylesheet) => ({
        filePath: stylesheet.filePath,
        cssKind: stylesheet.cssKind,
        origin: stylesheet.origin,
      })),
      [
        {
          filePath: "node_modules/pkg/reset.css",
          cssKind: "global-css",
          origin: "package",
        },
        {
          filePath: "node_modules/pkg/styles.css",
          cssKind: "global-css",
          origin: "package",
        },
        {
          filePath: "public/global.css",
          cssKind: "global-css",
          origin: "html-linked",
        },
        {
          filePath: "public/reset.css",
          cssKind: "global-css",
          origin: "project",
        },
        {
          filePath: "src/App.module.css",
          cssKind: "css-module",
          origin: "project",
        },
      ],
    );
    assert.ok(snapshot.boundaries.some(isHtmlAppEntryBoundary));
    assert.ok(snapshot.boundaries.some(isWorkspacePackageBoundary));
    assert.ok(snapshot.edges.some(isHtmlStylesheetEdge));
    assert.ok(snapshot.edges.some(isSourcePackageCssImportEdge));
    assert.ok(snapshot.edges.some(isStylesheetPackageCssImportEdge));
    assert.ok(snapshot.edges.some(isStylesheetImportEdge));
    assert.ok(snapshot.edges.some(isLocalCssSourceImportEdge));
    assert.ok(snapshot.edges.some(isExternalCssSourceImportEdge));
    assert.ok(snapshot.edges.some(isWorkspaceSourceImportEdge));
    assert.deepEqual(snapshot.boundaries, [...snapshot.boundaries].sort(compareSerialized));
    assert.deepEqual(snapshot.edges, [...snapshot.edges].sort(compareSerialized));
  } finally {
    await project.cleanup();
  }
});

test("buildProjectSnapshot does not fetch remote CSS by default", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response(".remote-btn { display: block; }\n", { status: 200 });
  };
  const project = await new TestProjectBuilder()
    .withFile("index.html", '<link rel="stylesheet" href="https://cdn.example/app.css">\n')
    .build();

  try {
    const snapshot = await buildProjectSnapshot({
      scanInput: {
        rootDir: project.rootDir,
      },
      runStage: async (_stage, _message, run) => run(),
    });

    assert.equal(fetchCount, 0);
    assert.equal(
      snapshot.files.stylesheets.some((stylesheet) => stylesheet.origin === "remote"),
      false,
    );
    assert.ok(
      snapshot.edges.some(
        (edge) =>
          edge.kind === "html-stylesheet" &&
          edge.href === "https://cdn.example/app.css" &&
          edge.isRemote,
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
    await project.cleanup();
  }
});

test("buildProjectSnapshot fetches remote CSS only when enabled", async () => {
  const originalFetch = globalThis.fetch;
  const fetchCalls = [];
  globalThis.fetch = async (url) => {
    fetchCalls.push(String(url));
    return new Response(".remote-btn { display: block; }\n", { status: 200 });
  };
  const project = await new TestProjectBuilder()
    .withConfig({
      externalCss: {
        fetchRemote: true,
      },
    })
    .withFile("index.html", '<link rel="stylesheet" href="https://cdn.example/app.css">\n')
    .build();

  try {
    const snapshot = await buildProjectSnapshot({
      scanInput: {
        rootDir: project.rootDir,
      },
      runStage: async (_stage, _message, run) => run(),
    });

    assert.deepEqual(fetchCalls, ["https://cdn.example/app.css"]);
    assert.deepEqual(
      snapshot.files.stylesheets
        .filter((stylesheet) => stylesheet.origin === "remote")
        .map((stylesheet) => ({
          filePath: stylesheet.filePath,
          cssText: stylesheet.cssText,
          cssKind: stylesheet.cssKind,
        })),
      [
        {
          filePath: "https://cdn.example/app.css",
          cssText: ".remote-btn { display: block; }\n",
          cssKind: "global-css",
        },
      ],
    );
  } finally {
    globalThis.fetch = originalFetch;
    await project.cleanup();
  }
});

function isHtmlAppEntryBoundary(boundary) {
  return (
    boundary.kind === "html-app-entry" &&
    boundary.htmlFilePath === "index.html" &&
    boundary.entrySourceFilePath === "src/App.tsx" &&
    boundary.appRootPath === "."
  );
}

function isWorkspacePackageBoundary(boundary) {
  return (
    boundary.kind === "workspace-package" &&
    boundary.packageName === "ui" &&
    boundary.entryFilePath === "packages/ui/src/index.ts" &&
    boundary.confidence === "heuristic" &&
    boundary.reason === "discovered-workspace-entrypoint"
  );
}

function isHtmlStylesheetEdge(edge) {
  return (
    edge.kind === "html-stylesheet" &&
    edge.fromHtmlFilePath === "index.html" &&
    edge.resolvedFilePath === "public/global.css"
  );
}

function isSourcePackageCssImportEdge(edge) {
  return (
    edge.kind === "package-css-import" &&
    edge.importerKind === "source" &&
    edge.importerFilePath === "src/App.tsx" &&
    edge.resolvedFilePath === "node_modules/pkg/styles.css"
  );
}

function isStylesheetPackageCssImportEdge(edge) {
  return (
    edge.kind === "package-css-import" &&
    edge.importerKind === "stylesheet" &&
    edge.importerFilePath === "public/global.css" &&
    edge.resolvedFilePath === "node_modules/pkg/reset.css"
  );
}

function isStylesheetImportEdge(edge) {
  return (
    edge.kind === "stylesheet-import" &&
    edge.importerFilePath === "public/global.css" &&
    edge.specifier === "./reset.css" &&
    edge.resolvedFilePath === "public/reset.css"
  );
}

function isLocalCssSourceImportEdge(edge) {
  return (
    edge.kind === "source-import" &&
    edge.importerFilePath === "src/App.tsx" &&
    edge.specifier === "./App.module.css" &&
    edge.importKind === "css" &&
    edge.resolutionStatus === "resolved" &&
    edge.resolvedFilePath === "src/App.module.css"
  );
}

function isExternalCssSourceImportEdge(edge) {
  return (
    edge.kind === "source-import" &&
    edge.importerFilePath === "src/App.tsx" &&
    edge.specifier === "pkg/styles.css" &&
    edge.importKind === "css" &&
    edge.resolutionStatus === "external"
  );
}

function isWorkspaceSourceImportEdge(edge) {
  return (
    edge.kind === "source-import" &&
    edge.importerFilePath === "src/App.tsx" &&
    edge.specifier === "ui" &&
    edge.importKind === "source" &&
    edge.resolutionStatus === "unresolved"
  );
}

function compareSerialized(left, right) {
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}
