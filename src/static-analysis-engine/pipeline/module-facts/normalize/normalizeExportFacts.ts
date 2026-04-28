import type { EngineModuleId, EngineSymbolId } from "../../../types/core.js";
import { resolveModuleFactReExportTargetFilePath } from "../resolve/resolveExportedName.js";
import type {
  ModuleFactsExportRecord,
  ModuleFactsStore,
  ResolvedModuleExportFact,
} from "../types.js";
import { createModuleFactsBindingId, createModuleFactsModuleId } from "./moduleIds.js";

export function normalizeExportFacts(input: {
  moduleFacts: ModuleFactsStore;
  moduleId: EngineModuleId;
  localBindingIdsByName: Map<string, EngineSymbolId>;
  exports: ModuleFactsExportRecord[];
}): ResolvedModuleExportFact[] {
  return input.exports.map((exportRecord) =>
    normalizeExportFact({
      moduleFacts: input.moduleFacts,
      moduleId: input.moduleId,
      localBindingIdsByName: input.localBindingIdsByName,
      exportRecord,
    }),
  );
}

function normalizeExportFact(input: {
  moduleFacts: ModuleFactsStore;
  moduleId: EngineModuleId;
  localBindingIdsByName: Map<string, EngineSymbolId>;
  exportRecord: ModuleFactsExportRecord;
}): ResolvedModuleExportFact {
  const exportKind = getExportKind(input.exportRecord);
  const reexport = resolveExportFactReexport({
    moduleFacts: input.moduleFacts,
    exportRecord: input.exportRecord,
  });
  const localBindingId = input.exportRecord.localName
    ? (input.localBindingIdsByName.get(input.exportRecord.localName) ??
      createModuleFactsBindingId(input.moduleId, input.exportRecord.localName))
    : undefined;

  return {
    exportedName: input.exportRecord.exportedName,
    sourceExportedName: input.exportRecord.sourceExportedName,
    localName: input.exportRecord.localName,
    localBindingId,
    exportKind,
    declarationKind: input.exportRecord.declarationKind,
    typeOnly: input.exportRecord.typeOnly,
    reexportKind: input.exportRecord.reexportKind,
    reexport,
  };
}

function resolveExportFactReexport(input: {
  moduleFacts: ModuleFactsStore;
  exportRecord: ModuleFactsExportRecord;
}): ResolvedModuleExportFact["reexport"] {
  if (!input.exportRecord.specifier) {
    return {
      status: "none",
    };
  }

  const resolvedFilePath = resolveModuleFactReExportTargetFilePath({
    moduleFacts: input.moduleFacts,
    exportRecord: input.exportRecord,
  });

  return resolvedFilePath
    ? {
        status: "resolved",
        specifier: input.exportRecord.specifier,
        resolvedFilePath,
        resolvedModuleId: createModuleFactsModuleId(resolvedFilePath),
        confidence: getSpecifierResolutionConfidence(input.exportRecord.specifier),
      }
    : {
        status: "unresolved",
        specifier: input.exportRecord.specifier,
        reason: "re-export-target-not-found",
      };
}

function getExportKind(exportRecord: {
  specifier?: string;
  exportedName: string;
}): ResolvedModuleExportFact["exportKind"] {
  if (!exportRecord.specifier) {
    return exportRecord.exportedName === "default" ? "default-expression" : "local";
  }

  return exportRecord.exportedName === "*" ? "export-all" : "re-export";
}

function getSpecifierResolutionConfidence(specifier: string): "exact" | "heuristic" {
  return specifier.startsWith(".") ? "exact" : "heuristic";
}
