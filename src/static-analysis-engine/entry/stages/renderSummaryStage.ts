import {
  runProjectComponentAvailabilityStage,
  runProjectRenderBindingsStage,
  runProjectRenderDefinitionsStage,
} from "./basicStages.js";
import type {
  ParsedProjectFile,
  ProjectRenderSummaryStageResult,
  ProjectSymbolResolutionStageResult,
} from "./types.js";

export function runProjectRenderSummaryStage(input: {
  parsedFiles: ParsedProjectFile[];
  symbolResolution: ProjectSymbolResolutionStageResult;
}): ProjectRenderSummaryStageResult {
  const filePaths = input.parsedFiles.map((parsedFile) => parsedFile.filePath);
  const renderDefinitions = runProjectRenderDefinitionsStage({
    parsedFiles: input.parsedFiles,
  });
  const renderBindings = runProjectRenderBindingsStage({
    filePaths,
    exportedExpressionBindingsByFilePath:
      input.symbolResolution.exportedExpressionBindingsByFilePath,
    resolvedImportedBindingsByFilePath: input.symbolResolution.resolvedImportedBindingsByFilePath,
    exportedHelperDefinitionsByFilePath: renderDefinitions.exportedHelperDefinitionsByFilePath,
    resolvedNamespaceImportsByFilePath: input.symbolResolution.resolvedNamespaceImportsByFilePath,
  });
  const componentAvailability = runProjectComponentAvailabilityStage({
    filePaths,
    componentDefinitionsByFilePath: renderDefinitions.componentDefinitionsByFilePath,
    exportedComponentsByFilePath: renderDefinitions.exportedComponentsByFilePath,
    resolvedImportedComponentBindingsByFilePath:
      input.symbolResolution.resolvedImportedComponentBindingsByFilePath,
    resolvedNamespaceImportsByFilePath: input.symbolResolution.resolvedNamespaceImportsByFilePath,
  });

  return {
    renderDefinitions,
    renderBindings,
    componentAvailability,
    renderGraphInput: {
      componentDefinitionsByFilePath: renderDefinitions.componentDefinitionsByFilePath,
      componentsByFilePath: componentAvailability.componentsByFilePath,
      importedComponentBindingTracesByFilePath:
        componentAvailability.importedComponentBindingTracesByFilePath,
      importedNamespaceComponentDefinitionsByFilePath:
        componentAvailability.importedNamespaceComponentDefinitionsByFilePath,
    },
    renderIrInput: {
      componentDefinitionsByFilePath: renderDefinitions.componentDefinitionsByFilePath,
      componentsByFilePath: componentAvailability.componentsByFilePath,
      importedExpressionBindingsByFilePath:
        input.symbolResolution.importedExpressionBindingsByFilePath,
      importedHelperDefinitionsByFilePath: renderBindings.importedHelperDefinitionsByFilePath,
      importedNamespaceExpressionBindingsByFilePath:
        renderBindings.importedNamespaceExpressionBindingsByFilePath,
      importedNamespaceHelperDefinitionsByFilePath:
        renderBindings.importedNamespaceHelperDefinitionsByFilePath,
      importedNamespaceComponentDefinitionsByFilePath:
        componentAvailability.importedNamespaceComponentDefinitionsByFilePath,
    },
  };
}
