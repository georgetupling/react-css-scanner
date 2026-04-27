export { buildProjectResolution } from "./buildProjectResolution.js";
export { collectExportedExpressionBindings } from "./collectExportedExpressionBindings.js";
export {
  collectAvailableExportedNames,
  resolveProjectExport,
  resolveReExportTargetFilePath,
} from "./resolveExportedName.js";
export { resolveProjectSourceSpecifier } from "./resolveProjectSourceSpecifier.js";
export {
  getSourceSpecifierCandidatePaths,
  resolveSourceSpecifier,
} from "./resolveSourceSpecifier.js";
export type {
  ResolvedProjectResolutionExport,
  ResolveProjectResolutionExportResult,
} from "./resolveExportedName.js";
export type {
  ResolveSourceSpecifierInput,
  SourceFilePathLookup,
  WorkspacePackageEntryPointLike,
} from "./resolveSourceSpecifier.js";
export type {
  ProjectResolution,
  ProjectResolutionCacheEntry,
  ProjectResolutionCaches,
  ProjectResolutionConfidence,
  ProjectResolutionExportRecord,
  ProjectResolutionFileDeclarationIndex,
  ProjectResolutionImportKind,
  ProjectResolutionImportName,
  ProjectResolutionImportRecord,
  ProjectResolutionStatus,
  ProjectResolutionValueDeclaration,
  WorkspacePackageEntryPoint,
} from "./types.js";
