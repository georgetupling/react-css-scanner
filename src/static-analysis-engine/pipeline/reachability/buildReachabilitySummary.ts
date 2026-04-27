import type { ModuleGraph } from "../module-graph/types.js";
import type { RenderGraph } from "../render-model/render-graph/types.js";
import type { RenderSubtree } from "../render-model/render-ir/index.js";
import type { ExternalCssSummary } from "../external-css/types.js";
import type { SelectorSourceInput } from "../selector-analysis/types.js";
import type { ReachabilitySummary } from "./types.js";
import { normalizeProjectPath } from "./pathUtils.js";
import { compareProjectWideEntrySources, createPackageCssImportKey } from "./sortAndKeys.js";
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
  moduleGraph: ModuleGraph;
  renderGraph: RenderGraph;
  renderSubtrees: RenderSubtree[];
  cssSources: SelectorSourceInput[];
  externalCssSummary: ExternalCssSummary;
  includeTraces?: boolean;
}): ReachabilitySummary {
  const includeTraces = input.includeTraces ?? true;
  const knownCssFilePaths = new Set(
    input.cssSources
      .map((cssSource) => normalizeProjectPath(cssSource.filePath))
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
  const analyzedSourceFilePaths = collectAnalyzedSourceFilePaths(input.moduleGraph);
  const directCssImportersByStylesheetPath = collectDirectCssImportersByStylesheetPath({
    moduleGraph: input.moduleGraph,
    knownCssFilePaths,
    packageCssImportBySpecifier,
  });
  const reachabilityGraphContext = buildReachabilityGraphContext({
    renderGraph: input.renderGraph,
    renderSubtrees: input.renderSubtrees,
  });
  const componentAvailability = computeBatchedComponentAvailability({
    cssSources: input.cssSources,
    directCssImportersByStylesheetPath,
    reachabilityGraphContext,
    includeTraces,
  });

  const stylesheets = input.cssSources.map((cssSource) =>
    buildStylesheetReachabilityRecord({
      cssSource,
      moduleGraph: input.moduleGraph,
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
      localCssImports: collectLocalStylesheetImportRecords({
        cssSources: input.cssSources,
        knownCssFilePaths,
      }),
      packageCssImports: input.externalCssSummary.packageCssImports,
      includeTraces,
    }),
  };
}
