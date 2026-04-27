import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import ts from "typescript";

import { buildModuleGraphFromSources } from "../../dist/static-analysis-engine/pipeline/module-graph/buildModuleGraph.js";
import { buildProjectResolution } from "../../dist/static-analysis-engine/pipeline/project-resolution/buildProjectResolution.js";

test("module graph consumes project-resolution source specifier answers", () => {
  const parsedFiles = [
    sourceFile(
      "src/App.tsx",
      `
        import { buttonClass } from "./tokens.js";
        export { buttonClass as appButtonClass } from "./tokens.js";
      `,
    ),
    sourceFile("src/tokens.ts", 'export const buttonClass = "btn";'),
  ];
  const projectResolution = buildProjectResolution({ parsedFiles });

  const moduleGraph = buildModuleGraphFromSources(parsedFiles, { projectResolution });
  const appModule = moduleGraph.modulesById.get("module:src/App.tsx");

  assert.equal(appModule?.imports[0]?.resolvedModuleId, "module:src/tokens.ts");
  assert.equal(appModule?.exports[0]?.reexportedModuleId, "module:src/tokens.ts");
  assert.deepEqual(moduleGraph.importEdges, [
    {
      fromModuleId: "module:src/App.tsx",
      toModuleId: "module:src/tokens.ts",
      kind: "source",
    },
  ]);
  assert.deepEqual(moduleGraph.exportEdges, [
    {
      fromModuleId: "module:src/App.tsx",
      toModuleId: "module:src/tokens.ts",
      exportedName: "appButtonClass",
    },
  ]);
});

test("module graph consumes TypeScript path alias answers from project resolution", () => {
  const parsedFiles = [
    sourceFile("src/App.tsx", 'import { buttonClass } from "@app/tokens";'),
    sourceFile("src/tokens.ts", 'export const buttonClass = "btn";'),
  ];
  const projectResolution = buildProjectResolution({
    parsedFiles,
    projectRoot: "/virtual-project",
    compilerOptions: {
      baseUrl: ".",
      paths: {
        "@app/*": ["src/*"],
      },
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
    },
  });

  const moduleGraph = buildModuleGraphFromSources(parsedFiles, { projectResolution });
  const appModule = moduleGraph.modulesById.get("module:src/App.tsx");

  assert.equal(appModule?.imports[0]?.resolvedModuleId, "module:src/tokens.ts");
  assert.deepEqual(moduleGraph.importEdges, [
    {
      fromModuleId: "module:src/App.tsx",
      toModuleId: "module:src/tokens.ts",
      kind: "source",
    },
  ]);
});

test("module graph consumes TypeScript package export answers from project resolution", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "scan-react-css-module-graph-"));
  try {
    await mkdir(path.join(projectRoot, "node_modules/workspace-lib"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "node_modules/workspace-lib/package.json"),
      JSON.stringify({
        name: "workspace-lib",
        type: "module",
        exports: {
          ".": "./src/index.ts",
        },
      }),
      "utf8",
    );

    const parsedFiles = [
      sourceFile("src/App.tsx", 'import { buttonClass } from "workspace-lib";'),
      sourceFile("node_modules/workspace-lib/src/index.ts", 'export const buttonClass = "btn";'),
    ];
    const projectResolution = buildProjectResolution({
      parsedFiles,
      projectRoot,
      compilerOptions: {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
      },
    });

    const moduleGraph = buildModuleGraphFromSources(parsedFiles, { projectResolution });
    const appModule = moduleGraph.modulesById.get("module:src/App.tsx");

    assert.equal(
      appModule?.imports[0]?.resolvedModuleId,
      "module:node_modules/workspace-lib/src/index.ts",
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

function sourceFile(filePath, sourceText) {
  return {
    filePath,
    parsedSourceFile: ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    ),
  };
}
