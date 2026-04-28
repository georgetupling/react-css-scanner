import ts from "typescript";

import type { EngineSymbolId } from "../../types/core.js";
import type {
  EngineSymbol,
  LocalAliasResolution,
  ProjectBindingResolution,
  SourceScope,
  SymbolReference,
  ResolvedCssModuleBindingDiagnostic,
  ResolvedCssModuleImport,
  ResolvedCssModuleMemberBinding,
  ResolvedCssModuleMemberReference,
  ResolvedCssModuleNamespaceBinding,
  ResolvedImportedBinding,
  ResolvedNamespaceImport,
  ResolvedTypeBinding,
} from "./types.js";

export type ProjectBindingResolutionInternals = {
  allSymbolsByFilePath: Map<string, Map<EngineSymbolId, EngineSymbol>>;
  scopesByFilePath: Map<string, Map<string, SourceScope>>;
  referencesByFilePath: Map<string, SymbolReference[]>;
  localAliasesByFilePath: Map<string, LocalAliasResolution[]>;
  resolvedImportedBindingsByFilePath: Map<string, ResolvedImportedBinding[]>;
  resolvedImportedComponentBindingsByFilePath: Map<string, ResolvedImportedBinding[]>;
  resolvedTypeBindingsByFilePath: Map<string, Map<string, ResolvedTypeBinding>>;
  resolvedExportedTypeBindingsByFilePath: Map<string, Map<string, ResolvedTypeBinding>>;
  resolvedNamespaceImportsByFilePath: Map<string, ResolvedNamespaceImport[]>;
  resolvedCssModuleImportsByFilePath: Map<string, ResolvedCssModuleImport[]>;
  resolvedCssModuleNamespaceBindingsByFilePath: Map<
    string,
    Map<string, ResolvedCssModuleNamespaceBinding>
  >;
  resolvedCssModuleMemberBindingsByFilePath: Map<
    string,
    Map<string, ResolvedCssModuleMemberBinding>
  >;
  resolvedCssModuleMemberReferencesByFilePath: Map<string, ResolvedCssModuleMemberReference[]>;
  resolvedCssModuleBindingDiagnosticsByFilePath: Map<string, ResolvedCssModuleBindingDiagnostic[]>;
  exportedExpressionBindingsByFilePath: Map<string, Map<string, ts.Expression>>;
  importedExpressionBindingsBySymbolIdByFilePath: Map<string, Map<EngineSymbolId, ts.Expression>>;
};

export const SYMBOL_RESOLUTION_INTERNALS: unique symbol = Symbol("symbolResolutionInternals");

export type InternalProjectBindingResolution = ProjectBindingResolution & {
  [SYMBOL_RESOLUTION_INTERNALS]: ProjectBindingResolutionInternals;
};

export function attachSymbolResolutionInternals(input: {
  symbolResolution: ProjectBindingResolution;
  internals: ProjectBindingResolutionInternals;
}): InternalProjectBindingResolution {
  return {
    ...input.symbolResolution,
    [SYMBOL_RESOLUTION_INTERNALS]: input.internals,
  };
}

export function getSymbolResolutionInternals(
  symbolResolution: ProjectBindingResolution,
): ProjectBindingResolutionInternals {
  return (symbolResolution as InternalProjectBindingResolution)[SYMBOL_RESOLUTION_INTERNALS];
}
