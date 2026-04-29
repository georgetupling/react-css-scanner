import type { ModuleFacts } from "../module-facts/index.js";
import type { RenderGraph } from "../render-model/render-graph/types.js";
import type { RenderSubtree } from "../render-model/render-ir/index.js";
import type { ExternalCssSummary } from "../external-css/types.js";
import type { ProjectResourceEdge } from "../workspace-discovery/types.js";
import type { ReachabilityStylesheetInput, ReachabilitySummary } from "./types.js";
import { normalizeProjectPath } from "./pathUtils.js";
import {
  compareProjectWideEntrySources,
  compareStylesheetImportRecords,
  createPackageCssImportKey,
} from "./sortAndKeys.js";
import { collectAnalyzedSourceFilePaths } from "./sourceFiles.js";
import {
  collectDirectCssImportersByStylesheetPath,
  collectLocalStylesheetImportRecords,
  applyStylesheetImportReachability,
} from "./stylesheetImports.js";
import { buildReachabilityGraphContext } from "./reachabilityGraphContext.js";
import { computeBatchedComponentAvailability } from "./componentAvailability.js";
import { buildStylesheetReachabilityRecord } from "./stylesheetRecords.js";

export function buildReachabilitySummary(input: {
  moduleFacts: ModuleFacts;
  renderGraph: RenderGraph;
  renderSubtrees: RenderSubtree[];
  stylesheets: ReachabilityStylesheetInput[];
  resourceEdges?: ProjectResourceEdge[];
  externalCssSummary: ExternalCssSummary;
  includeTraces?: boolean;
}): ReachabilitySummary {
  const includeTraces = input.includeTraces ?? true;
  const knownCssFilePaths = new Set(
    input.stylesheets
      .map((stylesheet) => normalizeProjectPath(stylesheet.filePath))
      .filter(Boolean) as string[],
  );
  const projectWideExternalStylesheetFilePaths = new Set(
    input.externalCssSummary.projectWideStylesheetFilePaths
      .map((filePath) => normalizeProjectPath(filePath))
      .filter(Boolean) as string[],
  );
  const projectWideEntrySources = input.externalCssSummary.projectWideEntrySources
    .map((entrySource) => ({
      entrySourceFilePath:
        normalizeProjectPath(entrySource.entrySourceFilePath) ?? entrySource.entrySourceFilePath,
      appRootPath: normalizeProjectPath(entrySource.appRootPath) ?? entrySource.appRootPath,
    }))
    .sort(compareProjectWideEntrySources);
  const packageCssImportBySpecifier = new Map(
    input.externalCssSummary.packageCssImports
      .filter((importRecord) => importRecord.importerKind === "source")
      .map((importRecord) => [
        createPackageCssImportKey(importRecord.importerFilePath, importRecord.specifier),
        normalizeProjectPath(importRecord.resolvedFilePath) ?? importRecord.resolvedFilePath,
      ]),
  );
  const analyzedSourceFilePaths = collectAnalyzedSourceFilePaths(input.moduleFacts);
  const directCssImportersByStylesheetPath = collectDirectCssImportersByStylesheetPath({
    moduleFacts: input.moduleFacts,
    knownCssFilePaths,
    packageCssImportBySpecifier,
    sourcePackageCssImports: input.externalCssSummary.packageCssImports,
  });
  const reachabilityGraphContext = buildReachabilityGraphContext({
    renderGraph: input.renderGraph,
    renderSubtrees: input.renderSubtrees,
  });
  const componentAvailability = computeBatchedComponentAvailability({
    stylesheets: input.stylesheets,
    directCssImportersByStylesheetPath,
    reachabilityGraphContext,
    includeTraces,
  });

  const stylesheets = input.stylesheets.map((stylesheet) =>
    buildStylesheetReachabilityRecord({
      stylesheet,
      renderGraph: input.renderGraph,
      renderSubtrees: input.renderSubtrees,
      knownCssFilePaths,
      projectWideExternalStylesheetFilePaths,
      projectWideEntrySources,
      packageCssImportBySpecifier,
      directCssImportersByStylesheetPath,
      reachabilityGraphContext,
      analyzedSourceFilePaths,
      componentAvailability,
      includeTraces,
    }),
  );

  return {
    stylesheets: applyStylesheetImportReachability({
      stylesheets,
      localCssImports:
        input.resourceEdges !== undefined
          ? collectLocalStylesheetImportRecordsFromResourceEdges(input.resourceEdges)
          : collectLocalStylesheetImportRecords({
              stylesheets: input.stylesheets,
              knownCssFilePaths,
            }),
      packageCssImports: input.externalCssSummary.packageCssImports,
      includeTraces,
    }),
  };
}

function collectLocalStylesheetImportRecordsFromResourceEdges(
  resourceEdges: ProjectResourceEdge[],
): ReturnType<typeof collectLocalStylesheetImportRecords> {
  return resourceEdges
    .filter((edge) => edge.kind === "stylesheet-import")
    .map((edge) => ({
      importerFilePath: normalizeProjectPath(edge.importerFilePath) ?? edge.importerFilePath,
      specifier: edge.specifier,
      resolvedFilePath: normalizeProjectPath(edge.resolvedFilePath) ?? edge.resolvedFilePath,
    }))
    .sort(compareStylesheetImportRecords);
}
