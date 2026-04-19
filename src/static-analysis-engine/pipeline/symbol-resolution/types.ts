import ts from "typescript";

import type { EngineModuleId, EngineSymbolId, SourceAnchor } from "../../types/core.js";

export type SymbolKind =
  | "component"
  | "function"
  | "constant"
  | "variable"
  | "prop"
  | "imported-binding"
  | "css-resource"
  | "unknown";

export type EngineSymbol = {
  id: EngineSymbolId;
  moduleId: EngineModuleId;
  kind: SymbolKind;
  localName: string;
  exportedNames: string[];
  declaration: SourceAnchor;
  resolution:
    | { kind: "local" }
    | { kind: "imported"; targetSymbolId?: EngineSymbolId; targetModuleId?: EngineModuleId }
    | { kind: "synthetic" }
    | { kind: "unresolved"; reason: string };
  metadata?: Record<string, unknown>;
};

export type ResolvedProjectExport = {
  targetModuleId: EngineModuleId;
  targetFilePath: string;
  targetExportName: string;
  targetSymbolId?: EngineSymbolId;
};

export type ResolvedImportedBinding = {
  localName: string;
  importedName: string;
  targetModuleId: EngineModuleId;
  targetFilePath: string;
  targetExportName: string;
  targetSymbolId?: EngineSymbolId;
};

export type ResolvedImportedComponentBinding = ResolvedImportedBinding;

export type ResolvedNamespaceImport = {
  localName: string;
  exports: Map<string, ResolvedProjectExport>;
};

export type ProjectBindingResolution = {
  symbols: Map<EngineSymbolId, EngineSymbol>;
  symbolsByFilePath: Map<string, Map<EngineSymbolId, EngineSymbol>>;
  resolvedImportedBindingsByFilePath: Map<string, ResolvedImportedBinding[]>;
  resolvedImportedComponentBindingsByFilePath: Map<string, ResolvedImportedComponentBinding[]>;
  resolvedNamespaceImportsByFilePath: Map<string, ResolvedNamespaceImport[]>;
  exportedExpressionBindingsByFilePath: Map<string, Map<string, ts.Expression>>;
  importedExpressionBindingsByFilePath: Map<string, Map<string, ts.Expression>>;
};
