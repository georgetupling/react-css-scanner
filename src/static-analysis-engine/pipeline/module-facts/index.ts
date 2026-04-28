import {
  getAllResolvedModuleFacts,
  getAnalyzedModuleFilePaths,
  getDirectSourceImportFacts,
  getDirectStylesheetImportFacts,
  getResolvedModuleExportsByFilePath,
  getResolvedModuleFacts,
} from "./api/getModuleFacts.js";
import { buildModuleFacts, buildModuleFactsStore } from "./buildModuleFacts.js";
import {
  collectAvailableExportedNames,
  resolveModuleFactExport,
} from "./resolve/resolveExportedName.js";
import { resolveModuleFactSourceSpecifier } from "./resolve/resolveModuleFactSourceSpecifier.js";
import { resolveSourceSpecifier } from "./resolve/resolveSourceSpecifier.js";

export {
  buildModuleFacts,
  buildModuleFactsStore,
  collectAvailableExportedNames,
  getAllResolvedModuleFacts,
  getAnalyzedModuleFilePaths,
  getDirectSourceImportFacts,
  getDirectStylesheetImportFacts,
  getResolvedModuleExportsByFilePath,
  getResolvedModuleFacts,
  resolveModuleFactExport,
  resolveModuleFactSourceSpecifier,
  resolveSourceSpecifier,
};

export type {
  ResolvedModuleFactExport,
  ResolveModuleFactExportResult,
} from "./resolve/resolveExportedName.js";
export type {
  ModuleFacts,
  ModuleFactsConfidence,
  ModuleFactsCssSemantics,
  ModuleFactsImportKind,
  ResolvedModuleExportFact,
  ResolvedModuleFacts,
  ResolvedModuleImportFact,
  ResolvedTopLevelBindingFact,
} from "./types.js";
