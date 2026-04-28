import type {
  ModuleFacts,
  ResolvedModuleExportFact,
  ResolvedModuleFacts,
  ResolvedModuleImportFact,
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
