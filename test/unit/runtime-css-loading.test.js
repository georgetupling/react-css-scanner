import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFactGraph,
  buildLanguageFrontends,
  buildRuntimeCssLoading,
} from "../../dist/static-analysis-engine.js";
import { buildProjectSnapshot } from "../../dist/static-analysis-engine/pipeline/workspace-discovery/buildProjectSnapshot.js";
import { TestProjectBuilder } from "../support/TestProjectBuilder.js";

test("runtime CSS loading treats eager route siblings as sharing initial CSS", async () => {
  const project = await new TestProjectBuilder()
    .withFile("index.html", '<script type="module" src="/src/main.tsx"></script>\n')
    .withSourceFile("src/main.tsx", 'import "./routes";\n')
    .withSourceFile("src/routes.tsx", 'import "./StyledRoute";\nimport "./OtherRoute";\n')
    .withSourceFile("src/StyledRoute.tsx", 'import "./StyledRoute.css";\n')
    .withSourceFile("src/OtherRoute.tsx", "export const other = true;\n")
    .withCssFile("src/StyledRoute.css", ".shared-route-class {}\n")
    .build();

  try {
    const result = await buildRuntimeCssLoadingForProject(project, {
      sourceFilePaths: [
        "src/main.tsx",
        "src/routes.tsx",
        "src/StyledRoute.tsx",
        "src/OtherRoute.tsx",
      ],
      cssFilePaths: ["src/StyledRoute.css"],
      htmlFilePaths: ["index.html"],
    });

    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].kind, "html-entry");
    assert.equal(result.chunks.length, 1);
    assert.equal(result.chunks[0].loading, "initial");
    assert.deepEqual(result.chunks[0].sourceFilePaths, [
      "src/main.tsx",
      "src/OtherRoute.tsx",
      "src/routes.tsx",
      "src/StyledRoute.tsx",
    ]);
    assert.deepEqual(result.chunks[0].stylesheetFilePaths, ["src/StyledRoute.css"]);
    assert.ok(
      result.availability.some(
        (availability) =>
          availability.stylesheetFilePath === "src/StyledRoute.css" &&
          availability.sourceFilePath === "src/OtherRoute.tsx" &&
          availability.reason === "stylesheet is loaded by the same HTML app entry bundle",
      ),
    );
  } finally {
    await project.cleanup();
  }
});

test("runtime CSS loading scopes dynamic route CSS to lazy chunks", async () => {
  const project = await new TestProjectBuilder()
    .withFile("index.html", '<script type="module" src="/src/main.tsx"></script>\n')
    .withSourceFile(
      "vite.config.ts",
      'import { defineConfig } from "vite";\nexport default defineConfig({});\n',
    )
    .withSourceFile(
      "src/main.tsx",
      'export const loadRoutes = () => import("./lazy/LazyRoutes");\n',
    )
    .withSourceFile(
      "src/lazy/LazyRoutes.tsx",
      'import "./StyledLazy";\nimport "./OtherLazy";\nexport const nested = () => import("./NestedLazy");\n',
    )
    .withSourceFile("src/lazy/StyledLazy.tsx", 'import "./StyledLazy.css";\n')
    .withSourceFile("src/lazy/OtherLazy.tsx", "export const other = true;\n")
    .withSourceFile("src/lazy/NestedLazy.tsx", 'import "./NestedLazy.css";\n')
    .withCssFile("src/lazy/StyledLazy.css", ".lazy-shared {}\n")
    .withCssFile("src/lazy/NestedLazy.css", ".nested-lazy {}\n")
    .build();

  try {
    const result = await buildRuntimeCssLoadingForProject(project, {
      sourceFilePaths: [
        "src/main.tsx",
        "src/lazy/LazyRoutes.tsx",
        "src/lazy/StyledLazy.tsx",
        "src/lazy/OtherLazy.tsx",
        "src/lazy/NestedLazy.tsx",
      ],
      cssFilePaths: ["src/lazy/StyledLazy.css", "src/lazy/NestedLazy.css"],
      htmlFilePaths: ["index.html"],
    });

    const initialChunk = result.chunks.find((chunk) => chunk.loading === "initial");
    const lazyRoutesChunk = result.chunks.find(
      (chunk) => chunk.rootSourceFilePath === "src/lazy/LazyRoutes.tsx",
    );
    const nestedLazyChunk = result.chunks.find(
      (chunk) => chunk.rootSourceFilePath === "src/lazy/NestedLazy.tsx",
    );

    assert.ok(initialChunk);
    assert.deepEqual(initialChunk.sourceFilePaths, ["src/main.tsx"]);
    assert.deepEqual(initialChunk.stylesheetFilePaths, []);
    assert.ok(lazyRoutesChunk);
    assert.equal(lazyRoutesChunk.loading, "lazy");
    assert.deepEqual(lazyRoutesChunk.sourceFilePaths, [
      "src/lazy/LazyRoutes.tsx",
      "src/lazy/OtherLazy.tsx",
      "src/lazy/StyledLazy.tsx",
    ]);
    assert.deepEqual(lazyRoutesChunk.stylesheetFilePaths, ["src/lazy/StyledLazy.css"]);
    assert.ok(nestedLazyChunk);
    assert.deepEqual(nestedLazyChunk.stylesheetFilePaths, ["src/lazy/NestedLazy.css"]);
    assert.ok(
      result.availability.some(
        (availability) =>
          availability.stylesheetFilePath === "src/lazy/StyledLazy.css" &&
          availability.sourceFilePath === "src/lazy/OtherLazy.tsx" &&
          availability.reason === "stylesheet is loaded by the same lazy runtime CSS chunk",
      ),
    );
    assert.equal(
      result.availability.some(
        (availability) =>
          availability.stylesheetFilePath === "src/lazy/StyledLazy.css" &&
          availability.sourceFilePath === "src/main.tsx" &&
          availability.availability !== "unavailable",
      ),
      false,
    );
  } finally {
    await project.cleanup();
  }
});

test("runtime CSS loading marks lazy CSS possible when bundler behavior is unknown", async () => {
  const project = await new TestProjectBuilder()
    .withFile("index.html", '<script type="module" src="/src/main.tsx"></script>\n')
    .withSourceFile("src/main.tsx", 'export const loadRoute = () => import("./LazyRoute");\n')
    .withSourceFile("src/LazyRoute.tsx", 'import "./LazyRoute.css";\n')
    .withCssFile("src/LazyRoute.css", ".lazy-global {}\n")
    .build();

  try {
    const result = await buildRuntimeCssLoadingForProject(project, {
      sourceFilePaths: ["src/main.tsx", "src/LazyRoute.tsx"],
      cssFilePaths: ["src/LazyRoute.css"],
      htmlFilePaths: ["index.html"],
    });

    assert.ok(
      result.availability.some(
        (availability) =>
          availability.stylesheetFilePath === "src/LazyRoute.css" &&
          availability.sourceFilePath === "src/main.tsx" &&
          availability.availability === "possible" &&
          availability.reason ===
            "stylesheet may be loaded because bundler CSS chunk behavior is unknown",
      ),
    );
  } finally {
    await project.cleanup();
  }
});

test("runtime CSS loading marks stylesheets possible after unresolved dynamic imports", async () => {
  const project = await new TestProjectBuilder()
    .withFile("index.html", '<script type="module" src="/src/main.tsx"></script>\n')
    .withSourceFile(
      "vite.config.ts",
      'import { defineConfig } from "vite";\nexport default defineConfig({});\n',
    )
    .withSourceFile("src/main.tsx", 'export const loadMissing = () => import("./MissingRoute");\n')
    .withCssFile("src/MissingRoute.css", ".maybe-loaded {}\n")
    .build();

  try {
    const result = await buildRuntimeCssLoadingForProject(project, {
      sourceFilePaths: ["src/main.tsx"],
      cssFilePaths: ["src/MissingRoute.css"],
      htmlFilePaths: ["index.html"],
    });

    assert.ok(
      result.availability.some(
        (availability) =>
          availability.stylesheetFilePath === "src/MissingRoute.css" &&
          availability.sourceFilePath === "src/main.tsx" &&
          availability.availability === "possible" &&
          availability.reason === "stylesheet may be loaded by an unresolved dynamic import",
      ),
    );
  } finally {
    await project.cleanup();
  }
});

test("runtime CSS loading marks dynamic CSS imports possible", async () => {
  const project = await new TestProjectBuilder()
    .withFile("index.html", '<script type="module" src="/src/main.tsx"></script>\n')
    .withSourceFile(
      "vite.config.ts",
      'import { defineConfig } from "vite";\nexport default defineConfig({});\n',
    )
    .withSourceFile("src/main.tsx", 'export const loadCss = () => import("./dynamic.css");\n')
    .withCssFile("src/dynamic.css", ".dynamic-css {}\n")
    .build();

  try {
    const result = await buildRuntimeCssLoadingForProject(project, {
      sourceFilePaths: ["src/main.tsx"],
      cssFilePaths: ["src/dynamic.css"],
      htmlFilePaths: ["index.html"],
    });

    assert.ok(
      result.availability.some(
        (availability) =>
          availability.stylesheetFilePath === "src/dynamic.css" &&
          availability.sourceFilePath === "src/main.tsx" &&
          availability.availability === "possible" &&
          availability.reason === "stylesheet may be loaded by a dynamic CSS import",
      ),
    );
  } finally {
    await project.cleanup();
  }
});

test("runtime CSS loading treats Vite cssCodeSplit false CSS as initial", async () => {
  const project = await new TestProjectBuilder()
    .withFile("index.html", '<script type="module" src="/src/main.tsx"></script>\n')
    .withSourceFile(
      "vite.config.ts",
      'import { defineConfig } from "vite";\nexport default defineConfig({ build: { cssCodeSplit: false } });\n',
    )
    .withSourceFile("src/main.tsx", 'export const loadRoutes = () => import("./lazy/LazyRoute");\n')
    .withSourceFile("src/lazy/LazyRoute.tsx", 'import "./LazyRoute.css";\n')
    .withCssFile("src/lazy/LazyRoute.css", ".lazy-global {}\n")
    .build();

  try {
    const result = await buildRuntimeCssLoadingForProject(project, {
      sourceFilePaths: ["src/main.tsx", "src/lazy/LazyRoute.tsx"],
      cssFilePaths: ["src/lazy/LazyRoute.css"],
      htmlFilePaths: ["index.html"],
    });

    assert.deepEqual(
      result.bundlerProfiles.map((profile) => ({
        bundler: profile.bundler,
        cssLoading: profile.cssLoading,
        confidence: profile.confidence,
        evidence: profile.evidence,
      })),
      [
        {
          bundler: "vite",
          cssLoading: "single-initial-stylesheet",
          confidence: "high",
          evidence: ["vite.config.ts"],
        },
      ],
    );
    assert.equal(result.chunks.length, 1);
    assert.equal(result.chunks[0].loading, "initial");
    assert.deepEqual(result.chunks[0].sourceFilePaths, ["src/lazy/LazyRoute.tsx", "src/main.tsx"]);
    assert.deepEqual(result.chunks[0].stylesheetFilePaths, ["src/lazy/LazyRoute.css"]);
    assert.ok(
      result.availability.some(
        (availability) =>
          availability.stylesheetFilePath === "src/lazy/LazyRoute.css" &&
          availability.sourceFilePath === "src/main.tsx" &&
          availability.reason === "stylesheet is loaded by the same HTML app entry bundle",
      ),
    );
  } finally {
    await project.cleanup();
  }
});

test("runtime CSS loading detects Vite from package metadata when config is absent", async () => {
  const project = await new TestProjectBuilder()
    .withFile(
      "package.json",
      '{ "name": "vite-package-app", "devDependencies": { "vite": "^5.0.0" } }\n',
    )
    .withFile("index.html", '<script type="module" src="/src/main.tsx"></script>\n')
    .withSourceFile("src/main.tsx", 'export const loadRoute = () => import("./LazyRoute");\n')
    .withSourceFile("src/LazyRoute.tsx", 'import "./LazyRoute.css";\n')
    .withCssFile("src/LazyRoute.css", ".lazy-global {}\n")
    .build();

  try {
    const result = await buildRuntimeCssLoadingForProject(project, {
      sourceFilePaths: ["src/main.tsx", "src/LazyRoute.tsx"],
      cssFilePaths: ["src/LazyRoute.css"],
      htmlFilePaths: ["index.html"],
    });

    assert.deepEqual(
      result.bundlerProfiles.map((profile) => ({
        bundler: profile.bundler,
        cssLoading: profile.cssLoading,
        confidence: profile.confidence,
        evidence: profile.evidence,
      })),
      [
        {
          bundler: "vite",
          cssLoading: "split-by-runtime-chunk",
          confidence: "medium",
          evidence: ["package.json"],
        },
      ],
    );
    assert.equal(
      result.availability.some(
        (availability) =>
          availability.stylesheetFilePath === "src/LazyRoute.css" &&
          availability.sourceFilePath === "src/main.tsx",
      ),
      false,
    );
  } finally {
    await project.cleanup();
  }
});

test("runtime CSS loading uses Vite rollupOptions input to select multi-page HTML entries", async () => {
  const project = await new TestProjectBuilder()
    .withFile("admin.html", '<script type="module" src="/src/admin.tsx"></script>\n')
    .withFile("web.html", '<script type="module" src="/src/web.tsx"></script>\n')
    .withFile("ignored.html", '<script type="module" src="/src/ignored.tsx"></script>\n')
    .withSourceFile(
      "vite.config.ts",
      [
        'import { defineConfig } from "vite";',
        'import { resolve } from "node:path";',
        "export default defineConfig({",
        "  build: {",
        "    rollupOptions: {",
        "      input: {",
        '        admin: resolve(__dirname, "admin.html"),',
        '        web: "./web.html",',
        "      },",
        "    },",
        "  },",
        "});",
        "",
      ].join("\n"),
    )
    .withSourceFile("src/admin.tsx", 'import "./admin.css";\n')
    .withSourceFile("src/web.tsx", 'import "./web.css";\n')
    .withSourceFile("src/ignored.tsx", 'import "./ignored.css";\n')
    .withCssFile("src/admin.css", ".admin-only {}\n")
    .withCssFile("src/web.css", ".web-only {}\n")
    .withCssFile("src/ignored.css", ".ignored-only {}\n")
    .build();

  try {
    const result = await buildRuntimeCssLoadingForProject(project, {
      sourceFilePaths: ["src/admin.tsx", "src/web.tsx", "src/ignored.tsx"],
      cssFilePaths: ["src/admin.css", "src/web.css", "src/ignored.css"],
      htmlFilePaths: ["admin.html", "web.html", "ignored.html"],
    });

    assert.deepEqual(
      result.entries.map((entry) => ({
        kind: entry.kind,
        htmlFilePath: entry.htmlFilePath,
        entrySourceFilePath: entry.entrySourceFilePath,
        reason: entry.reason,
      })),
      [
        {
          kind: "html-entry",
          htmlFilePath: "admin.html",
          entrySourceFilePath: "src/admin.tsx",
          reason: "Vite rollupOptions.input admin.html resolved through HTML module script",
        },
        {
          kind: "html-entry",
          htmlFilePath: "web.html",
          entrySourceFilePath: "src/web.tsx",
          reason: "Vite rollupOptions.input web.html resolved through HTML module script",
        },
      ],
    );
    assert.equal(
      result.entries.some((entry) => entry.entrySourceFilePath === "src/ignored.tsx"),
      false,
    );
  } finally {
    await project.cleanup();
  }
});

test("runtime CSS loading accepts Vite rollupOptions input array and source entries", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "vite.config.ts",
      [
        'import { defineConfig } from "vite";',
        "export default defineConfig({",
        "  build: {",
        "    rollupOptions: {",
        '      input: ["src/client.tsx"],',
        "    },",
        "  },",
        "});",
        "",
      ].join("\n"),
    )
    .withSourceFile("src/client.tsx", 'import "./client.css";\n')
    .withCssFile("src/client.css", ".client-only {}\n")
    .build();

  try {
    const result = await buildRuntimeCssLoadingForProject(project, {
      sourceFilePaths: ["src/client.tsx"],
      cssFilePaths: ["src/client.css"],
    });

    assert.deepEqual(
      result.entries.map((entry) => ({
        kind: entry.kind,
        entrySourceFilePath: entry.entrySourceFilePath,
        reason: entry.reason,
      })),
      [
        {
          kind: "vite-input-entry",
          entrySourceFilePath: "src/client.tsx",
          reason: "Vite rollupOptions.input src/client.tsx resolved to an analyzed source entry",
        },
      ],
    );
  } finally {
    await project.cleanup();
  }
});

async function buildRuntimeCssLoadingForProject(project, scanInput) {
  const snapshot = await buildProjectSnapshot({
    scanInput: {
      rootDir: project.rootDir,
      ...scanInput,
    },
    runStage: async (_stage, _message, run) => run(),
  });
  const frontends = buildLanguageFrontends({ snapshot });
  const factGraph = buildFactGraph({ snapshot, frontends });
  return buildRuntimeCssLoading({ factGraph });
}
