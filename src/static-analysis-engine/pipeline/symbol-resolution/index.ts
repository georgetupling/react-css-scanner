export { collectSourceSymbols } from "../language-frontends/source/symbol-syntax/collectSourceSymbols.js";
export {
  createScopeId,
  createSymbolId,
} from "../language-frontends/source/symbol-syntax/shared.js";
export { buildProjectBindingResolution } from "./assembly/buildProjectBindingResolution.js";
export {
  getLocalAliasAt,
  getLocalAliasResolutionsForFile,
  resolveAliasedSymbol,
  resolveLocalAliasAt,
} from "./api/getLocalAliasResolution.js";
export { getScopeAt } from "./api/getScopeAt.js";
export { getSymbol, getSymbolAt } from "./api/getSymbol.js";
export { getSymbolReferenceAt, resolveReferenceAt } from "./api/getReferenceResolution.js";
export {
  getExportedExpressionBindingsForFile,
  getImportedBindingsForFile,
  getImportedComponentBindingsForFile,
  getImportedExpressionBindingsBySymbolIdForFile,
  getNamespaceImportsForFile,
  getSymbolResolutionFilePaths,
} from "./api/getValueResolution.js";
export {
  getCssModuleBindingsForFile,
  resolveCssModuleMember,
  resolveCssModuleMemberAccess,
  resolveCssModuleNamespace,
} from "./api/getCssModuleResolution.js";
export type { ResolvedCssModuleBindingsForFile } from "./api/getCssModuleResolution.js";
export {
  resolveExportedTypeDeclaration,
  resolveExportedTypeBinding,
  resolveTypeDeclaration,
  resolveTypeBinding,
} from "./api/getTypeResolution.js";
export type { ResolvedTypeDeclaration } from "./api/getTypeResolution.js";
export type {
  EngineSymbol,
  LocalAliasResolution,
  ProjectBindingResolution,
  ScopeId,
  ScopeKind,
  ResolvedCssModuleBindingDiagnostic,
  ResolvedCssModuleImport,
  ResolvedCssModuleMemberAccessResult,
  ResolvedCssModuleMemberBinding,
  ResolvedCssModuleMemberReference,
  ResolvedCssModuleNamespaceBinding,
  ResolvedImportedBinding,
  ResolvedNamespaceMemberResult,
  ResolvedNamespaceImport,
  ResolvedProjectExport,
  ResolvedTypeBinding,
  SourceScope,
  SymbolReference,
  SymbolSpace,
  SymbolResolutionReason,
  SymbolKind,
} from "./types.js";
