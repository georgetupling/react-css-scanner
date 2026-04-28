import {
  getExportedNamesByLocalName,
  getAllResolvedModuleFacts,
  getAnalyzedModuleFilePaths,
  getDirectSourceImportFacts,
  getDirectStylesheetImportFacts,
  getResolvedModuleFacts,
  getTopLevelBindingFacts,
} from "./api/getModuleFacts.js";
import { buildModuleFacts } from "./buildModuleFacts.js";
import {
  collectAvailableExportedNames,
  resolveModuleFactExport,
} from "./resolve/resolveExportedName.js";
import { resolveModuleFactSourceSpecifier } from "./resolve/resolveModuleFactSourceSpecifier.js";
import { resolveSourceSpecifier } from "./resolve/resolveSourceSpecifier.js";

export {
  buildModuleFacts,
  collectAvailableExportedNames,
  getExportedNamesByLocalName,
  getAllResolvedModuleFacts,
  getAnalyzedModuleFilePaths,
  getDirectSourceImportFacts,
  getDirectStylesheetImportFacts,
  getResolvedModuleFacts,
  getTopLevelBindingFacts,
  resolveModuleFactExport,
  resolveModuleFactSourceSpecifier,
  resolveSourceSpecifier,
};

export type { ResolvedModuleFactExport } from "./resolve/resolveExportedName.js";
export type { ModuleFacts, ModuleFactsImportKind, ResolvedModuleFacts } from "./types.js";
