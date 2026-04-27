import { MAX_CROSS_FILE_IMPORT_PROPAGATION_DEPTH } from "../../libraries/policy/index.js";
import type { AnalysisTrace } from "../../types/analysis.js";
import type { SourceAnchor } from "../../types/core.js";
import { normalizeFilePath } from "./pathUtils.js";
import { resolveProjectSourceSpecifier } from "./resolveProjectSourceSpecifier.js";
import type { ProjectResolution, ProjectResolutionExportRecord } from "./types.js";

export type ResolvedProjectResolutionExport = {
  targetFilePath: string;
  targetExportName: string;
  targetLocalName?: string;
};

export type ResolveProjectResolutionExportResult = {
  resolvedExport?: ResolvedProjectResolutionExport;
  traces: AnalysisTrace[];
  reason?: string;
};

export function resolveProjectExport(input: {
  projectResolution: ProjectResolution;
  filePath: string;
  exportedName: string;
  visitedExports: Set<string>;
  currentDepth: number;
  importAnchor?: SourceAnchor;
  includeTraces?: boolean;
}): ResolveProjectResolutionExportResult {
  const filePath = normalizeFilePath(input.filePath);
  const includeTraces = input.includeTraces ?? true;
  const exportRecords = input.projectResolution.exportsByFilePath.get(filePath);

  if (!exportRecords) {
    return {
      reason: "target-module-not-found",
      traces: includeTraces
        ? [
            createSymbolResolutionTrace({
              traceId: `symbol-resolution:module-not-found:${filePath}:${input.exportedName}`,
              summary: `could not resolve export ${input.exportedName} because module ${filePath} was not found`,
              anchor: input.importAnchor,
              metadata: {
                filePath,
                exportedName: input.exportedName,
                reason: "target-module-not-found",
              },
            }),
          ]
        : [],
    };
  }

  const directExport = exportRecords.find(
    (exportRecord) => exportRecord.exportedName === input.exportedName && !exportRecord.specifier,
  );
  if (directExport) {
    return {
      resolvedExport: {
        targetFilePath: filePath,
        targetExportName: directExport.exportedName,
        targetLocalName: directExport.localName,
      },
      traces: includeTraces
        ? [
            createSymbolResolutionTrace({
              traceId: `symbol-resolution:direct-export:${filePath}:${input.exportedName}`,
              summary: `resolved export ${input.exportedName} directly from ${filePath}`,
              anchor: input.importAnchor,
              metadata: {
                filePath,
                exportedName: input.exportedName,
                resolution: "direct-export",
              },
            }),
          ]
        : [],
    };
  }

  if (input.currentDepth >= MAX_CROSS_FILE_IMPORT_PROPAGATION_DEPTH) {
    return {
      reason: "budget-exceeded",
      traces: includeTraces
        ? [
            createSymbolResolutionTrace({
              traceId: `symbol-resolution:budget-exceeded:${filePath}:${input.exportedName}`,
              summary: `stopped resolving export ${input.exportedName} after hitting the cross-file symbol-resolution budget`,
              anchor: input.importAnchor,
              metadata: {
                filePath,
                exportedName: input.exportedName,
                reason: "budget-exceeded",
                currentDepth: input.currentDepth,
              },
            }),
          ]
        : [],
    };
  }

  for (const exportRecord of exportRecords) {
    const targetFilePath = resolveReExportTargetFilePath({
      projectResolution: input.projectResolution,
      exportRecord,
    });
    if (!targetFilePath) {
      continue;
    }

    if (exportRecord.exportedName === input.exportedName) {
      const sourceExportedName = exportRecord.sourceExportedName ?? exportRecord.exportedName;
      const exportKey = `${targetFilePath}:${sourceExportedName}`;
      if (input.visitedExports.has(exportKey)) {
        continue;
      }

      const resolvedValue = resolveProjectExport({
        ...input,
        filePath: targetFilePath,
        exportedName: sourceExportedName,
        visitedExports: new Set([...input.visitedExports, exportKey]),
        currentDepth: input.currentDepth + 1,
      });
      if (resolvedValue.resolvedExport) {
        return {
          resolvedExport: resolvedValue.resolvedExport,
          traces: includeTraces
            ? [
                createSymbolResolutionTrace({
                  traceId: `symbol-resolution:re-export:${filePath}:${input.exportedName}:${targetFilePath}`,
                  summary: `followed re-export ${input.exportedName} from ${filePath} to ${targetFilePath}`,
                  anchor: input.importAnchor,
                  children: resolvedValue.traces,
                  metadata: {
                    filePath,
                    exportedName: input.exportedName,
                    targetFilePath,
                    reexportKind: exportRecord.reexportKind ?? "named",
                  },
                }),
              ]
            : [],
        };
      }
    }

    if (exportRecord.exportedName !== "*") {
      continue;
    }

    const exportKey = `${targetFilePath}:${input.exportedName}`;
    if (input.visitedExports.has(exportKey)) {
      continue;
    }

    const resolvedValue = resolveProjectExport({
      ...input,
      filePath: targetFilePath,
      exportedName: input.exportedName,
      visitedExports: new Set([...input.visitedExports, exportKey]),
      currentDepth: input.currentDepth + 1,
    });
    if (resolvedValue.resolvedExport) {
      return {
        resolvedExport: resolvedValue.resolvedExport,
        traces: includeTraces
          ? [
              createSymbolResolutionTrace({
                traceId: `symbol-resolution:star-re-export:${filePath}:${input.exportedName}:${targetFilePath}`,
                summary: `followed star re-export while resolving ${input.exportedName} from ${filePath} to ${targetFilePath}`,
                anchor: input.importAnchor,
                children: resolvedValue.traces,
                metadata: {
                  filePath,
                  exportedName: input.exportedName,
                  targetFilePath,
                  reexportKind: "star",
                },
              }),
            ]
          : [],
      };
    }
  }

  return {
    reason: "export-not-found",
    traces: includeTraces
      ? [
          createSymbolResolutionTrace({
            traceId: `symbol-resolution:export-not-found:${filePath}:${input.exportedName}`,
            summary: `could not resolve export ${input.exportedName} from ${filePath}`,
            anchor: input.importAnchor,
            metadata: {
              filePath,
              exportedName: input.exportedName,
              reason: "export-not-found",
            },
          }),
        ]
      : [],
  };
}

export function collectAvailableExportedNames(input: {
  projectResolution: ProjectResolution;
  filePath: string;
  visitedFilePaths: Set<string>;
  currentDepth: number;
}): Set<string> {
  const filePath = normalizeFilePath(input.filePath);
  const exportRecords = input.projectResolution.exportsByFilePath.get(filePath);
  const exportedNames = new Set<string>(
    exportRecords?.map((exportRecord) => exportRecord.exportedName) ?? [],
  );
  if (!exportRecords || input.currentDepth >= MAX_CROSS_FILE_IMPORT_PROPAGATION_DEPTH) {
    return exportedNames;
  }

  for (const exportRecord of exportRecords) {
    if (exportRecord.exportedName !== "*") {
      exportedNames.add(exportRecord.exportedName);
      continue;
    }

    const targetFilePath = resolveReExportTargetFilePath({
      projectResolution: input.projectResolution,
      exportRecord,
    });
    if (!targetFilePath || input.visitedFilePaths.has(targetFilePath)) {
      continue;
    }

    const nestedNames = collectAvailableExportedNames({
      ...input,
      filePath: targetFilePath,
      visitedFilePaths: new Set([...input.visitedFilePaths, targetFilePath]),
      currentDepth: input.currentDepth + 1,
    });
    for (const nestedName of nestedNames) {
      exportedNames.add(nestedName);
    }
  }

  return exportedNames;
}

export function resolveReExportTargetFilePath(input: {
  projectResolution: ProjectResolution;
  exportRecord: ProjectResolutionExportRecord;
}): string | undefined {
  if (!input.exportRecord.specifier) {
    return undefined;
  }

  const cacheKey = `${input.exportRecord.filePath}\0${input.exportRecord.specifier}\0re-export`;
  const cached = input.projectResolution.caches.moduleSpecifiers.get(cacheKey);
  if (cached) {
    return cached.status === "resolved" ? cached.value : undefined;
  }

  const targetFilePath = resolveProjectSourceSpecifier({
    projectResolution: input.projectResolution,
    fromFilePath: input.exportRecord.filePath,
    specifier: input.exportRecord.specifier,
  });

  input.projectResolution.caches.moduleSpecifiers.set(
    cacheKey,
    targetFilePath
      ? {
          status: "resolved",
          confidence: input.exportRecord.specifier.startsWith(".") ? "exact" : "heuristic",
          value: targetFilePath,
        }
      : { status: "not-found", reason: "re-export-target-not-found" },
  );

  return targetFilePath;
}

function createSymbolResolutionTrace(input: {
  traceId: string;
  summary: string;
  anchor?: SourceAnchor;
  metadata?: Record<string, unknown>;
  children?: AnalysisTrace[];
}): AnalysisTrace {
  return {
    traceId: input.traceId,
    category: "symbol-resolution",
    summary: input.summary,
    ...(input.anchor ? { anchor: input.anchor } : {}),
    children: [...(input.children ?? [])],
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}
