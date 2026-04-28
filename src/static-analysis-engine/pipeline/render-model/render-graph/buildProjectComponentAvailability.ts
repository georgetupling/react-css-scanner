import type { AnalysisTrace } from "../../../types/analysis.js";
import type {
  ResolvedImportedBinding,
  ResolvedNamespaceMemberResult,
  ResolvedNamespaceImport,
} from "../../symbol-resolution/types.js";
import type { SameFileComponentDefinition } from "../render-ir/index.js";

export type ProjectComponentAvailability = {
  componentsByFilePath: Map<string, Map<string, SameFileComponentDefinition>>;
  importedComponentBindingTracesByFilePath: Map<string, Map<string, AnalysisTrace[]>>;
  importedNamespaceComponentDefinitionsBySymbolIdByFilePath: Map<
    string,
    Map<string, Map<string, SameFileComponentDefinition>>
  >;
};

export function buildProjectComponentAvailability(input: {
  filePaths: string[];
  componentDefinitionsByFilePath: Map<string, SameFileComponentDefinition[]>;
  exportedComponentsByFilePath: Map<string, Map<string, SameFileComponentDefinition>>;
  resolvedImportedComponentBindingsByFilePath: Map<string, ResolvedImportedBinding[]>;
  resolvedNamespaceImportsByFilePath: Map<string, ResolvedNamespaceImport[]>;
}): ProjectComponentAvailability {
  return {
    componentsByFilePath: new Map(
      input.filePaths.map((filePath) => [
        filePath,
        buildAvailableComponentsForFile({
          localDefinitions: input.componentDefinitionsByFilePath.get(filePath) ?? [],
          resolvedImportedComponentBindings:
            input.resolvedImportedComponentBindingsByFilePath.get(filePath) ?? [],
          exportedComponentsByFilePath: input.exportedComponentsByFilePath,
        }),
      ]),
    ),
    importedComponentBindingTracesByFilePath: new Map(
      input.filePaths.map((filePath) => [
        filePath,
        new Map(
          (input.resolvedImportedComponentBindingsByFilePath.get(filePath) ?? []).map((binding) => [
            binding.localName,
            binding.traces,
          ]),
        ),
      ]),
    ),
    importedNamespaceComponentDefinitionsBySymbolIdByFilePath: new Map(
      input.filePaths.map((filePath) => [
        filePath,
        buildResolvedNamespaceBindingsBySymbolIdForFile({
          resolvedNamespaceImports: input.resolvedNamespaceImportsByFilePath.get(filePath) ?? [],
          getResolvedValue: (resolvedExport) =>
            input.exportedComponentsByFilePath
              .get(resolvedExport.targetFilePath)
              ?.get(resolvedExport.targetExportName),
        }),
      ]),
    ),
  };
}

function buildAvailableComponentsForFile(input: {
  localDefinitions: SameFileComponentDefinition[];
  resolvedImportedComponentBindings: ResolvedImportedBinding[];
  exportedComponentsByFilePath: Map<string, Map<string, SameFileComponentDefinition>>;
}): Map<string, SameFileComponentDefinition> {
  const availableComponents = new Map<string, SameFileComponentDefinition>(
    input.localDefinitions.map((definition) => [definition.componentName, definition]),
  );

  for (const resolvedBinding of input.resolvedImportedComponentBindings) {
    const targetDefinition = input.exportedComponentsByFilePath
      .get(resolvedBinding.targetFilePath)
      ?.get(resolvedBinding.targetExportName);
    if (!targetDefinition) {
      continue;
    }

    availableComponents.set(resolvedBinding.localName, targetDefinition);
  }

  return availableComponents;
}

function buildResolvedNamespaceBindingsBySymbolIdForFile<T>(input: {
  resolvedNamespaceImports: ResolvedNamespaceImport[];
  getResolvedValue: (input: { targetFilePath: string; targetExportName: string }) => T | undefined;
}): Map<string, Map<string, T>> {
  const namespaceBindings = new Map<string, Map<string, T>>();
  for (const namespaceImport of input.resolvedNamespaceImports) {
    if (!namespaceImport.localSymbolId) {
      continue;
    }

    const resolvedBindings = new Map<string, T>();
    for (const [exportName, memberResult] of namespaceImport.members.entries()) {
      const resolvedValue = getResolvedNamespaceMemberValue({
        memberResult,
        getResolvedValue: input.getResolvedValue,
      });
      if (resolvedValue) {
        resolvedBindings.set(exportName, resolvedValue);
      }
    }

    namespaceBindings.set(namespaceImport.localSymbolId, resolvedBindings);
  }

  return namespaceBindings;
}

function getResolvedNamespaceMemberValue<T>(input: {
  memberResult: ResolvedNamespaceMemberResult;
  getResolvedValue: (input: { targetFilePath: string; targetExportName: string }) => T | undefined;
}): T | undefined {
  if (input.memberResult.kind !== "resolved") {
    return undefined;
  }

  return input.getResolvedValue(input.memberResult.target);
}
