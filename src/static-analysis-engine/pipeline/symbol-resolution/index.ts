export { collectExportedExpressionBindings } from "./collectExportedExpressionBindings.js";
export { collectTopLevelSymbols, createSymbolId } from "./collection/collectTopLevelSymbols.js";
export { buildProjectBindingResolution } from "./assembly/buildProjectBindingResolution.js";
export { resolveImportedBindingsForFile } from "./value-resolution/resolveImportedBindings.js";
export { resolveNamespaceImportsForFile } from "./value-resolution/resolveNamespaceImports.js";
export type {
  EngineSymbol,
  ProjectBindingResolution,
  ResolvedImportedBinding,
  ResolvedImportedComponentBinding,
  ResolvedNamespaceImport,
  ResolvedProjectExport,
  SymbolKind,
} from "./types.js";
