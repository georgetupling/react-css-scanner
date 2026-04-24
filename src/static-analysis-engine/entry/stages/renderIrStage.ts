import ts from "typescript";

import { buildSameFileRenderSubtrees } from "../../pipeline/render-ir/index.js";
import type { ProjectRenderIrStageInput, RenderIrStageResult } from "./types.js";

export function runRenderIrStage(input: {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
}): RenderIrStageResult {
  return {
    renderSubtrees: buildSameFileRenderSubtrees(input),
  };
}

export function runProjectRenderIrStage(input: {
  componentDefinitionsByFilePath: ProjectRenderIrStageInput["componentDefinitionsByFilePath"];
  componentsByFilePath: ProjectRenderIrStageInput["componentsByFilePath"];
  importedExpressionBindingsByFilePath: ProjectRenderIrStageInput["importedExpressionBindingsByFilePath"];
  importedHelperDefinitionsByFilePath: ProjectRenderIrStageInput["importedHelperDefinitionsByFilePath"];
  importedNamespaceExpressionBindingsByFilePath: ProjectRenderIrStageInput["importedNamespaceExpressionBindingsByFilePath"];
  importedNamespaceHelperDefinitionsByFilePath: ProjectRenderIrStageInput["importedNamespaceHelperDefinitionsByFilePath"];
  importedNamespaceComponentDefinitionsByFilePath: ProjectRenderIrStageInput["importedNamespaceComponentDefinitionsByFilePath"];
}): RenderIrStageResult {
  return {
    renderSubtrees: [...input.componentDefinitionsByFilePath.entries()].flatMap(
      ([filePath, componentDefinitions]) =>
        buildSameFileRenderSubtrees({
          filePath,
          parsedSourceFile:
            componentDefinitions[0]?.parsedSourceFile ??
            ts.createSourceFile(filePath, "", ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
          componentDefinitions,
          componentsByFilePath: input.componentsByFilePath,
          importedExpressionBindings:
            input.importedExpressionBindingsByFilePath.get(filePath) ?? new Map(),
          importedHelperDefinitions:
            input.importedHelperDefinitionsByFilePath.get(filePath) ?? new Map(),
          importedNamespaceExpressionBindings:
            input.importedNamespaceExpressionBindingsByFilePath.get(filePath) ?? new Map(),
          importedNamespaceHelperDefinitions:
            input.importedNamespaceHelperDefinitionsByFilePath.get(filePath) ?? new Map(),
          importedNamespaceComponentDefinitions:
            input.importedNamespaceComponentDefinitionsByFilePath.get(filePath) ?? new Map(),
        }),
    ),
  };
}
