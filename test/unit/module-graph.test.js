import assert from "node:assert/strict";
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
