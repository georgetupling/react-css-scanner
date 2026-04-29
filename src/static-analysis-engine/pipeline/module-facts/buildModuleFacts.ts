import type ts from "typescript";

import {
  buildSourceFrontendFactsFromParsedFiles,
  type SourceFrontendFacts,
} from "../language-frontends/index.js";
import type { ParsedProjectFile } from "../../entry/stages/types.js";
import type { ProjectBoundary, ProjectResourceEdge } from "../workspace-discovery/index.js";
import { collectWorkspacePackageBoundaries } from "../workspace-discovery/boundaries/collectWorkspacePackageBoundaries.js";
import { buildResolvedModuleFacts } from "./normalize/buildResolvedModuleFacts.js";
import { createModuleFactsCaches } from "./resolve/cache.js";
import { buildTypescriptResolution } from "./resolve/typescriptResolution.js";
import { normalizeFilePath } from "./shared/pathUtils.js";
import { collectSourceImportEdgesByImportKey } from "./sourceImportEdges.js";
import type {
  ModuleFacts,
  ModuleFactsStore,
  ModuleFactsDeclarationIndex,
  ModuleFactsExportRecord,
  ModuleFactsImportRecord,
  WorkspacePackageEntryPoint,
} from "./types.js";

export function buildModuleFacts(input: {
  source?: SourceFrontendFacts;
  parsedFiles?: ParsedProjectFile[];
  stylesheetFilePaths?: Iterable<string>;
  projectRoot?: string;
  compilerOptions?: ts.CompilerOptions;
  boundaries?: ProjectBoundary[];
  resourceEdges?: ProjectResourceEdge[];
}): ModuleFacts {
  const moduleFactsStore = buildModuleFactsStore(input);
  return {
    resolvedModuleFactsByFilePath: new Map(moduleFactsStore.resolvedModuleFactsByFilePath),
  };
}

function buildModuleFactsStore(input: {
  source?: SourceFrontendFacts;
  parsedFiles?: ParsedProjectFile[];
  stylesheetFilePaths?: Iterable<string>;
  projectRoot?: string;
  compilerOptions?: ts.CompilerOptions;
  boundaries?: ProjectBoundary[];
  resourceEdges?: ProjectResourceEdge[];
}): ModuleFactsStore {
  const source = input.source ?? buildSourceFrontendFactsFromParsedFiles(input.parsedFiles ?? []);
  const sortedSourceFiles = [...source.files].sort((left, right) =>
    normalizeFilePath(left.filePath).localeCompare(normalizeFilePath(right.filePath)),
  );
  const parsedSourceFilesByFilePath = new Map<string, ts.SourceFile>();
  const importsByFilePath = new Map<string, ModuleFactsImportRecord[]>();
  const exportsByFilePath = new Map<string, ModuleFactsExportRecord[]>();
  const declarationsByFilePath = new Map<string, ModuleFactsDeclarationIndex>();

  for (const sourceFile of sortedSourceFiles) {
    const filePath = normalizeFilePath(sourceFile.filePath);
    parsedSourceFilesByFilePath.set(filePath, sourceFile.legacy.parsedFile.parsedSourceFile);
    importsByFilePath.set(filePath, sourceFile.moduleSyntax.imports);
    exportsByFilePath.set(filePath, sourceFile.moduleSyntax.exports);
    declarationsByFilePath.set(filePath, sourceFile.moduleSyntax.declarations);
  }
  const boundaries =
    input.boundaries ??
    collectWorkspacePackageBoundaries(
      sortedSourceFiles.map((sourceFile) => ({
        kind: "source" as const,
        filePath: sourceFile.filePath,
        absolutePath: sourceFile.absolutePath,
        sourceText: sourceFile.sourceText,
      })),
    );

  const moduleFacts: ModuleFactsStore = {
    parsedSourceFilesByFilePath,
    importsByFilePath,
    exportsByFilePath,
    declarationsByFilePath,
    knownStylesheetFilePaths: new Set(
      [...(input.stylesheetFilePaths ?? [])].map((filePath) => normalizeFilePath(filePath)),
    ),
    resolvedModuleFactsByFilePath: new Map(),
    workspacePackageEntryPointsByPackageName:
      collectWorkspacePackageEntryPointsFromBoundaries(boundaries),
    sourceImportEdgesByImportKey: collectSourceImportEdgesByImportKey(input.resourceEdges ?? []),
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

function collectWorkspacePackageEntryPointsFromBoundaries(
  boundaries: ProjectBoundary[],
): Map<string, WorkspacePackageEntryPoint[]> {
  const entryPointsByPackageName = new Map<string, WorkspacePackageEntryPoint[]>();

  for (const boundary of boundaries) {
    if (boundary.kind !== "workspace-package") {
      continue;
    }

    const entryPoints = entryPointsByPackageName.get(boundary.packageName) ?? [];
    entryPoints.push({
      packageName: boundary.packageName,
      filePath: normalizeFilePath(boundary.entryFilePath),
      confidence: boundary.confidence,
      reason: boundary.reason,
    });
    entryPointsByPackageName.set(boundary.packageName, entryPoints);
  }

  for (const entryPoints of entryPointsByPackageName.values()) {
    entryPoints.sort((left, right) => left.filePath.localeCompare(right.filePath));
  }

  return new Map(
    [...entryPointsByPackageName.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}
