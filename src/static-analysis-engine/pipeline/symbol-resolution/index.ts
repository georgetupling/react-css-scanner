export { collectTopLevelSymbols, createSymbolId } from "./collectSymbols.js";
export {
  buildProjectBindingResolution,
  resolveImportedBindingsForFile,
  resolveNamespaceImportsForFile,
} from "./resolveProjectBindings.js";
export type {
  EngineSymbol,
  ProjectBindingResolution,
  ResolvedImportedBinding,
  ResolvedImportedComponentBinding,
  ResolvedNamespaceImport,
  ResolvedProjectExport,
  SymbolKind,
} from "./types.js";
