import type {
  ModuleFacts,
  ResolvedModuleExportFact,
  ResolvedModuleFacts,
  ResolvedModuleImportFact,
  ResolvedTopLevelBindingFact,
} from "../types.js";
import { normalizeFilePath } from "../shared/pathUtils.js";

export function getResolvedModuleFacts(input: {
  moduleFacts: ModuleFacts;
  filePath: string;
}): ResolvedModuleFacts | undefined {
  return input.moduleFacts.resolvedModuleFactsByFilePath.get(normalizeFilePath(input.filePath));
}

export function getAllResolvedModuleFacts(input: {
  moduleFacts: ModuleFacts;
}): ResolvedModuleFacts[] {
  return [...input.moduleFacts.resolvedModuleFactsByFilePath.values()].sort((left, right) =>
    left.filePath.localeCompare(right.filePath),
  );
}

export function getAnalyzedModuleFilePaths(input: { moduleFacts: ModuleFacts }): string[] {
  return getAllResolvedModuleFacts(input).map((fact) => fact.filePath);
}

export function getResolvedModuleExportsByFilePath(input: {
  moduleFacts: ModuleFacts;
}): Map<string, ResolvedModuleExportFact[]> {
  return new Map(
    getAllResolvedModuleFacts(input).map((fact) => [fact.filePath, [...fact.exports]]),
  );
}

export function getTopLevelBindingFacts(input: {
  moduleFacts: ModuleFacts;
  filePath: string;
}): ResolvedTopLevelBindingFact[] {
  return [...(getResolvedModuleFacts(input)?.topLevelBindings ?? [])];
}

export function getExportedNamesByLocalName(input: {
  moduleFacts: ModuleFacts;
  filePath: string;
}): Map<string, string[]> {
  const exportedNamesByLocalName = new Map<string, string[]>();

  for (const exportFact of getResolvedModuleFacts(input)?.exports ?? []) {
    if (!exportFact.localName) {
      continue;
    }

    const exportedNames = exportedNamesByLocalName.get(exportFact.localName);
    if (exportedNames) {
      exportedNames.push(exportFact.exportedName);
      continue;
    }

    exportedNamesByLocalName.set(exportFact.localName, [exportFact.exportedName]);
  }

  return exportedNamesByLocalName;
}

export function getDirectSourceImportFacts(input: {
  moduleFacts: ModuleFacts;
  filePath: string;
}): ResolvedModuleImportFact[] {
  return (
    getResolvedModuleFacts(input)?.imports.filter(
      (importFact) =>
        importFact.importKind === "source" && importFact.resolution.status === "resolved",
    ) ?? []
  );
}

export function getDirectStylesheetImportFacts(input: {
  moduleFacts: ModuleFacts;
  filePath: string;
}): ResolvedModuleImportFact[] {
  return (
    getResolvedModuleFacts(input)?.imports.filter(
      (importFact) => importFact.importKind === "css" || importFact.importKind === "external-css",
    ) ?? []
  );
}
