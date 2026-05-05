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
          availability.sourceFilePath === "src/main.tsx",
      ),
      false,
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
