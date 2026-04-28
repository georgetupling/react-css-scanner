import type { EngineModuleId } from "../../../types/core.js";
import { resolveModuleFactSourceSpecifier } from "../resolve/resolveModuleFactSourceSpecifier.js";
import type {
  ModuleFactsImportRecord,
  ModuleFactsStore,
  ResolvedModuleImportFact,
} from "../types.js";
import { createModuleFactsBindingId, createModuleFactsModuleId } from "./moduleIds.js";

export function normalizeImportFacts(input: {
  moduleFacts: ModuleFactsStore;
  filePath: string;
  moduleId: EngineModuleId;
  imports: ModuleFactsImportRecord[];
}): ResolvedModuleImportFact[] {
  return input.imports.map((importRecord) =>
    normalizeImportFact({
      moduleFacts: input.moduleFacts,
      filePath: input.filePath,
      moduleId: input.moduleId,
      importRecord,
    }),
  );
}

function normalizeImportFact(input: {
  moduleFacts: ModuleFactsStore;
  filePath: string;
  moduleId: EngineModuleId;
  importRecord: ModuleFactsImportRecord;
}): ResolvedModuleImportFact {
  const resolvedImport = resolveImportFact({
    moduleFacts: input.moduleFacts,
    filePath: input.filePath,
    importRecord: input.importRecord,
  });

  return {
    specifier: input.importRecord.specifier,
    importKind: input.importRecord.importKind,
    ...(input.importRecord.importKind === "css"
      ? { cssSemantics: getCssSemantics(input.importRecord.specifier) }
      : {}),
    importedBindings: input.importRecord.importNames.map((importName) => ({
      importedName: importName.importedName,
      localName: importName.localName,
      bindingKind: importName.kind,
      typeOnly: importName.typeOnly,
      localBindingId: createModuleFactsBindingId(input.moduleId, importName.localName),
    })),
    resolution: resolvedImport,
  };
}

function resolveImportFact(input: {
  moduleFacts: ModuleFactsStore;
  filePath: string;
  importRecord: ModuleFactsImportRecord;
}): ResolvedModuleImportFact["resolution"] {
  if (input.importRecord.importKind === "source" || input.importRecord.importKind === "type-only") {
    const resolvedFilePath = resolveModuleFactSourceSpecifier({
      moduleFacts: input.moduleFacts,
      fromFilePath: input.filePath,
      specifier: input.importRecord.specifier,
    });

    return resolvedFilePath
      ? {
          status: "resolved",
          resolvedFilePath,
          resolvedModuleId: createModuleFactsModuleId(resolvedFilePath),
          confidence: getSpecifierResolutionConfidence(input.importRecord.specifier),
        }
      : {
          status: "unresolved",
          reason: "source-specifier-not-found",
        };
  }

  if (input.importRecord.importKind === "css") {
    if (isRelativeOrAbsolutePath(input.importRecord.specifier)) {
      const resolvedFilePath = resolveStylesheetSpecifierPath({
        fromFilePath: input.filePath,
        specifier: input.importRecord.specifier,
      });
      return {
        status: "resolved",
        resolvedFilePath,
        resolvedModuleId: createModuleFactsModuleId(resolvedFilePath),
        confidence: "exact",
      };
    }

    return {
      status: "external",
      reason: "package-stylesheet-import",
    };
  }

  if (input.importRecord.importKind === "external-css") {
    return {
      status: "external",
      reason: "remote-stylesheet-import",
    };
  }

  return {
    status: "unsupported",
    reason: "unknown-import-kind",
  };
}

function getCssSemantics(specifier: string): "global" | "module" {
  return /\.module\.[cm]?css$/i.test(specifier) ? "module" : "global";
}

function isRelativeOrAbsolutePath(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("/");
}

function getSpecifierResolutionConfidence(specifier: string): "exact" | "heuristic" {
  return specifier.startsWith(".") ? "exact" : "heuristic";
}

function resolveStylesheetSpecifierPath(input: {
  fromFilePath: string;
  specifier: string;
}): string {
  if (input.specifier.startsWith("/")) {
    return input.specifier.replace(/^\/+/, "").replace(/\\/g, "/");
  }

  const fromSegments = input.fromFilePath.replace(/\\/g, "/").split("/");
  fromSegments.pop();
  const specifierSegments = input.specifier.split("/").filter(Boolean);
  return normalizeSegments([...fromSegments, ...specifierSegments]);
}

function normalizeSegments(segments: string[]): string {
  const normalized: string[] = [];

  for (const segment of segments) {
    if (segment === ".") {
      continue;
    }

    if (segment === "..") {
      normalized.pop();
      continue;
    }

    normalized.push(segment);
  }

  return normalized.join("/");
}
