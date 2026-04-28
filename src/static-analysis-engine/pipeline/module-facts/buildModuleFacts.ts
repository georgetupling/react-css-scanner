import type ts from "typescript";

import type { ParsedProjectFile } from "../../entry/stages/types.js";
import { collectDeclarations } from "./collect/collectDeclarations.js";
import { applyExportEvidenceToDeclarations, collectExports } from "./collect/collectExports.js";
import { collectImports } from "./collect/collectImports.js";
import { buildResolvedModuleFacts } from "./normalize/buildResolvedModuleFacts.js";
import { createModuleFactsCaches } from "./resolve/cache.js";
import { buildTypescriptResolution } from "./resolve/typescriptResolution.js";
import { collectWorkspacePackageEntryPoints } from "./resolve/workspaceEntryPoints.js";
import { normalizeFilePath } from "./shared/pathUtils.js";
import type {
  ModuleFacts,
  ModuleFactsStore,
  ModuleFactsDeclarationIndex,
  ModuleFactsExportRecord,
  ModuleFactsImportRecord,
} from "./types.js";

export function buildModuleFacts(input: {
  parsedFiles: ParsedProjectFile[];
  projectRoot?: string;
  compilerOptions?: ts.CompilerOptions;
}): ModuleFacts {
  const moduleFactsStore = buildModuleFactsStore(input);
  return {
    resolvedModuleFactsByFilePath: new Map(moduleFactsStore.resolvedModuleFactsByFilePath),
  };
}

export function buildModuleFactsStore(input: {
  parsedFiles: ParsedProjectFile[];
  projectRoot?: string;
  compilerOptions?: ts.CompilerOptions;
}): ModuleFactsStore {
  const sortedParsedFiles = [...input.parsedFiles].sort((left, right) =>
    normalizeFilePath(left.filePath).localeCompare(normalizeFilePath(right.filePath)),
  );
  const parsedSourceFilesByFilePath = new Map<string, ts.SourceFile>();
  const importsByFilePath = new Map<string, ModuleFactsImportRecord[]>();
  const exportsByFilePath = new Map<string, ModuleFactsExportRecord[]>();
  const declarationsByFilePath = new Map<string, ModuleFactsDeclarationIndex>();

  for (const parsedFile of sortedParsedFiles) {
    const filePath = normalizeFilePath(parsedFile.filePath);
    parsedSourceFilesByFilePath.set(filePath, parsedFile.parsedSourceFile);
    importsByFilePath.set(filePath, collectImports(filePath, parsedFile.parsedSourceFile));

    const declarations = collectDeclarations(parsedFile.parsedSourceFile);
    const exports = collectExports(filePath, parsedFile.parsedSourceFile);
    applyExportEvidenceToDeclarations(declarations, exports);

    exportsByFilePath.set(filePath, exports);
    declarationsByFilePath.set(filePath, declarations);
  }

  const moduleFacts: ModuleFactsStore = {
    parsedSourceFilesByFilePath,
    importsByFilePath,
    exportsByFilePath,
    declarationsByFilePath,
    resolvedModuleFactsByFilePath: new Map(),
    workspacePackageEntryPointsByPackageName: collectWorkspacePackageEntryPoints(sortedParsedFiles),
    typescriptResolution: buildTypescriptResolution({
      projectRoot: input.projectRoot,
      filePaths: parsedSourceFilesByFilePath.keys(),
      compilerOptions: input.compilerOptions,
    }),
    caches: createModuleFactsCaches(),
  };

  moduleFacts.resolvedModuleFactsByFilePath = buildResolvedModuleFacts({
    moduleFacts,
  });

  return moduleFacts;
}
