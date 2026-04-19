import { buildRenderGraph, collectSameFileComponents } from "../../pipeline/render-graph/index.js";
import type { RenderGraphStageResult } from "./types.js";
import type { ProjectRenderContext } from "./buildProjectRenderContext.js";

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
  projectRenderContext: ProjectRenderContext;
}): RenderGraphStageResult {
  return {
    renderGraph: buildRenderGraph({
      componentDefinitionsByFilePath: input.projectRenderContext.componentDefinitionsByFilePath,
      componentsByFilePath: input.projectRenderContext.componentsByFilePath,
      importedComponentBindingTracesByFilePath:
        input.projectRenderContext.importedComponentBindingTracesByFilePath,
      importedNamespaceComponentDefinitionsByFilePath:
        input.projectRenderContext.importedNamespaceComponentDefinitionsByFilePath,
    }),
  };
}
