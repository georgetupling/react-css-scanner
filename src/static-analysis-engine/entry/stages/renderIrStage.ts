import ts from "typescript";

import { buildSameFileRenderSubtrees } from "../../pipeline/render-ir/index.js";
import type { RenderIrStageResult } from "./types.js";
import type { ProjectRenderContext } from "./buildProjectRenderContext.js";

export function runRenderIrStage(input: {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
}): RenderIrStageResult {
  return {
    renderSubtrees: buildSameFileRenderSubtrees(input),
  };
}

export function runProjectRenderIrStage(input: {
  projectRenderContext: ProjectRenderContext;
}): RenderIrStageResult {
  return {
    renderSubtrees: [
      ...input.projectRenderContext.componentDefinitionsByFilePath.entries(),
    ].flatMap(([filePath, componentDefinitions]) =>
      buildSameFileRenderSubtrees({
        filePath,
        parsedSourceFile:
          componentDefinitions[0]?.parsedSourceFile ??
          ts.createSourceFile(filePath, "", ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
        componentDefinitions,
        componentsByFilePath: input.projectRenderContext.componentsByFilePath,
        importedExpressionBindings:
          input.projectRenderContext.importedExpressionBindingsByFilePath.get(filePath) ??
          new Map(),
        importedHelperDefinitions:
          input.projectRenderContext.importedHelperDefinitionsByFilePath.get(filePath) ?? new Map(),
        importedNamespaceExpressionBindings:
          input.projectRenderContext.importedNamespaceExpressionBindingsByFilePath.get(filePath) ??
          new Map(),
        importedNamespaceHelperDefinitions:
          input.projectRenderContext.importedNamespaceHelperDefinitionsByFilePath.get(filePath) ??
          new Map(),
        importedNamespaceComponentDefinitions:
          input.projectRenderContext.importedNamespaceComponentDefinitionsByFilePath.get(
            filePath,
          ) ?? new Map(),
      }),
    ),
  };
}
