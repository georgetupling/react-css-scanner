import { buildRenderGraph, collectSameFileComponents } from "../../pipeline/render-graph/index.js";
import type { ProjectRenderGraphStageInput, RenderGraphStageResult } from "./types.js";

export function runRenderGraphStage(input: {
  filePath: string;
  parsedSourceFile: import("typescript").SourceFile;
}): RenderGraphStageResult {
  const componentDefinitions = collectSameFileComponents(input);
  const componentsByFilePath = new Map([
    [
      input.filePath,
      new Map(componentDefinitions.map((definition) => [definition.componentName, definition])),
    ],
  ]);

  return {
    renderGraph: buildRenderGraph({
      componentDefinitionsByFilePath: new Map([[input.filePath, componentDefinitions]]),
      componentsByFilePath,
      importedComponentBindingTracesByFilePath: new Map([[input.filePath, new Map()]]),
      importedNamespaceComponentDefinitionsByFilePath: new Map([[input.filePath, new Map()]]),
    }),
  };
}

export function runProjectRenderGraphStage(input: {
  componentDefinitionsByFilePath: ProjectRenderGraphStageInput["componentDefinitionsByFilePath"];
  componentsByFilePath: ProjectRenderGraphStageInput["componentsByFilePath"];
  importedComponentBindingTracesByFilePath: ProjectRenderGraphStageInput["importedComponentBindingTracesByFilePath"];
  importedNamespaceComponentDefinitionsByFilePath: ProjectRenderGraphStageInput["importedNamespaceComponentDefinitionsByFilePath"];
}): RenderGraphStageResult {
  return {
    renderGraph: buildRenderGraph({
      componentDefinitionsByFilePath: input.componentDefinitionsByFilePath,
      componentsByFilePath: input.componentsByFilePath,
      importedComponentBindingTracesByFilePath: input.importedComponentBindingTracesByFilePath,
      importedNamespaceComponentDefinitionsByFilePath:
        input.importedNamespaceComponentDefinitionsByFilePath,
    }),
  };
}
