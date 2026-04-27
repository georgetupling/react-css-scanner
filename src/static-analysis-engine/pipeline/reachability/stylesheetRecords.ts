import type { ModuleGraph } from "../module-graph/types.js";
import type { RenderGraph } from "../render-model/render-graph/types.js";
import type { RenderSubtree } from "../render-model/render-ir/index.js";
import type { SelectorSourceInput } from "../selector-analysis/types.js";
import type { StylesheetReachabilityContextRecord, StylesheetReachabilityRecord } from "./types.js";
import type {
  BatchedComponentAvailability,
  ProjectWideEntrySource,
  ReachabilityGraphContext,
} from "./internalTypes.js";
import { normalizeProjectPath, isPathInsideProjectPath } from "./pathUtils.js";
import { compareContextRecords, serializeContextKey } from "./sortAndKeys.js";
import { addContextRecord, withStylesheetRecordTraces } from "./recordUtils.js";
import { buildContextRecords } from "./contextRecords.js";

export function buildStylesheetReachabilityRecord(input: {
  cssSource: SelectorSourceInput;
  moduleGraph: ModuleGraph;
  renderGraph: RenderGraph;
  renderSubtrees: RenderSubtree[];
  knownCssFilePaths: Set<string>;
  projectWideExternalStylesheetFilePaths: Set<string>;
  projectWideEntrySources: ProjectWideEntrySource[];
  packageCssImportBySpecifier: Map<string, string>;
  directCssImportersByStylesheetPath: Map<string, string[]>;
  reachabilityGraphContext: ReachabilityGraphContext;
  analyzedSourceFilePaths: string[];
  componentAvailability: BatchedComponentAvailability;
  includeTraces: boolean;
}): StylesheetReachabilityRecord {
  const cssFilePath = normalizeProjectPath(input.cssSource.filePath);
  if (!cssFilePath) {
    return withStylesheetRecordTraces({
      cssFilePath: input.cssSource.filePath,
      availability: "unknown",
      contexts: [],
      reasons: [
        "stylesheet source does not have a file path, so reachability cannot be determined",
      ],
      traces: [],
      includeTraces: input.includeTraces,
    });
  }

  const contextRecordsByKey = new Map<string, StylesheetReachabilityContextRecord>();
  const sortedImportingSourceFilePaths =
    input.directCssImportersByStylesheetPath.get(cssFilePath) ?? [];

  if (sortedImportingSourceFilePaths.length > 0) {
    for (const contextRecord of buildContextRecords({
      importingSourceFilePaths: sortedImportingSourceFilePaths,
      reachabilityGraphContext: input.reachabilityGraphContext,
      componentAvailabilityByKey:
        input.componentAvailability.componentAvailabilityByStylesheetPath.get(cssFilePath) ??
        new Map(),
      includeTraces: input.includeTraces,
    })) {
      contextRecordsByKey.set(serializeContextKey(contextRecord), contextRecord);
    }
  }

  const isProjectWideExternalStylesheet =
    input.projectWideExternalStylesheetFilePaths.has(cssFilePath);
  if (isProjectWideExternalStylesheet) {
    for (const filePath of input.analyzedSourceFilePaths) {
      addContextRecord(
        contextRecordsByKey,
        {
          context: {
            kind: "source-file",
            filePath,
          },
          availability: "definite",
          reasons: [
            "source file is covered by a project-wide HTML-linked remote external stylesheet",
          ],
          derivations: [
            {
              kind: "source-file-project-wide-external-css",
              stylesheetHref: cssFilePath,
            },
          ],
        },
        input.includeTraces,
      );
    }
  }

  const sortedProjectWideEntryImportingSources = input.projectWideEntrySources.filter(
    (entrySource) => sortedImportingSourceFilePaths.includes(entrySource.entrySourceFilePath),
  );
  for (const entrySource of sortedProjectWideEntryImportingSources) {
    for (const filePath of input.analyzedSourceFilePaths) {
      if (!isPathInsideProjectPath(filePath, entrySource.appRootPath)) {
        addContextRecord(
          contextRecordsByKey,
          {
            context: {
              kind: "source-file",
              filePath,
            },
            availability: "unavailable",
            reasons: [
              `source file is outside the app boundary for HTML entry source ${entrySource.entrySourceFilePath}`,
            ],
            derivations: [
              {
                kind: "source-file-outside-app-entry-css-boundary",
                entrySourceFilePath: entrySource.entrySourceFilePath,
                appRootPath: entrySource.appRootPath,
              },
            ],
          },
          input.includeTraces,
        );
        continue;
      }

      addContextRecord(
        contextRecordsByKey,
        {
          context: {
            kind: "source-file",
            filePath,
          },
          availability: "definite",
          reasons: [
            `source file is covered by CSS imported from HTML entry source ${entrySource.entrySourceFilePath}`,
          ],
          derivations: [
            {
              kind: "source-file-project-wide-app-entry-css",
              entrySourceFilePath: entrySource.entrySourceFilePath,
              appRootPath: entrySource.appRootPath,
            },
          ],
        },
        input.includeTraces,
      );
    }
  }

  const contextRecords = [...contextRecordsByKey.values()].sort(compareContextRecords);
  if (contextRecords.length === 0) {
    return withStylesheetRecordTraces({
      cssFilePath: input.cssSource.filePath,
      availability: "unavailable",
      contexts: [],
      reasons: [
        input.projectWideExternalStylesheetFilePaths.size > 0
          ? "no analyzed source file directly imports this stylesheet or reaches it project-wide"
          : "no analyzed source file directly imports this stylesheet",
      ],
      traces: [],
      includeTraces: input.includeTraces,
    });
  }

  const reasons: string[] = [];
  if (sortedImportingSourceFilePaths.length > 0) {
    reasons.push(
      `stylesheet is directly imported by ${sortedImportingSourceFilePaths.length} analyzed source file${sortedImportingSourceFilePaths.length === 1 ? "" : "s"}`,
    );
  }
  if (isProjectWideExternalStylesheet) {
    reasons.push(
      "stylesheet is active project-wide through an HTML-linked remote external stylesheet",
    );
  }
  if (sortedProjectWideEntryImportingSources.length > 0) {
    reasons.push(
      `stylesheet is active project-wide through ${sortedProjectWideEntryImportingSources.length} HTML entry source import${sortedProjectWideEntryImportingSources.length === 1 ? "" : "s"}`,
    );
  }
  reasons.push(
    `reachability is attached to ${contextRecords.length} explicit render context${contextRecords.length === 1 ? "" : "s"}`,
  );

  return withStylesheetRecordTraces({
    cssFilePath: input.cssSource.filePath,
    availability: contextRecords.some((context) => context.availability === "definite")
      ? "definite"
      : contextRecords.some((context) => context.availability === "possible")
        ? "possible"
        : contextRecords.some((context) => context.availability === "unknown")
          ? "unknown"
          : "unavailable",
    contexts: contextRecords,
    reasons,
    traces: [],
    includeTraces: input.includeTraces,
  });
}
