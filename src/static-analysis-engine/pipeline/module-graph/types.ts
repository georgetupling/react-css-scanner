import type { EngineModuleId, EngineSymbolId } from "../../types/core.js";

export type ModuleImportKind = "source" | "css" | "external-css" | "type-only" | "unknown";

export type ModuleImportRecord = {
  specifier: string;
  resolvedModuleId?: EngineModuleId;
  importKind: ModuleImportKind;
  importedNames: Array<{
    importedName: string;
    localName: string;
  }>;
};

export type ModuleExportRecord = {
  exportedName: string;
  sourceExportedName?: string;
  localSymbolId?: EngineSymbolId;
  reexportedModuleId?: EngineModuleId;
  reexportKind?: "named" | "namespace" | "star";
};

export type ModuleNode = {
  id: EngineModuleId;
  filePath: string;
  kind: "source" | "css" | "external-css";
  imports: ModuleImportRecord[];
  exports: ModuleExportRecord[];
  topLevelSymbols: EngineSymbolId[];
};

export type ModuleImportEdge = {
  fromModuleId: EngineModuleId;
  toModuleId: EngineModuleId;
  kind: ModuleImportKind;
};

export type ModuleExportEdge = {
  fromModuleId: EngineModuleId;
  toModuleId: EngineModuleId;
  exportedName: string;
};

export type ModuleGraph = {
  modulesById: Map<EngineModuleId, ModuleNode>;
  importEdges: ModuleImportEdge[];
  exportEdges: ModuleExportEdge[];
};
