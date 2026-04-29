import type { ResolvedScannerConfig } from "../../../../config/index.js";
import type { ExternalCssAnalysisInput } from "../../external-css/types.js";
import type { ProjectAnalysisStylesheetInput } from "../../project-analysis/types.js";
import type { SelectorSourceInput } from "../../selector-analysis/types.js";
import type { ProjectBoundary, ProjectResourceEdge, ProjectSnapshot } from "../types.js";

// TODO(workspace-discovery): this adapter type exists only to connect ProjectSnapshot to the
// current engine entrypoint. Remove it when downstream stages consume ProjectSnapshot directly.
export type ProjectSnapshotEngineInput = {
  sourceFiles: Array<{ filePath: string; sourceText: string }>;
  projectRoot: string;
  selectorCssSources: SelectorSourceInput[];
  stylesheets: ProjectAnalysisStylesheetInput[];
  boundaries: ProjectBoundary[];
  resourceEdges: ProjectResourceEdge[];
  cssModules: ResolvedScannerConfig["cssModules"];
  externalCss: ExternalCssAnalysisInput;
};

export function projectSnapshotToEngineInput(
  snapshot: ProjectSnapshot,
): ProjectSnapshotEngineInput {
  return {
    sourceFiles: snapshot.files.sourceFiles.map((sourceFile) => ({
      filePath: sourceFile.filePath,
      sourceText: sourceFile.sourceText,
    })),
    projectRoot: snapshot.rootDir,
    selectorCssSources: snapshot.files.stylesheets.map((stylesheet) => ({
      filePath: stylesheet.filePath,
      cssText: stylesheet.cssText,
    })),
    stylesheets: snapshot.files.stylesheets.map((stylesheet) => ({
      filePath: stylesheet.filePath,
      cssKind: stylesheet.cssKind,
      origin: stylesheet.origin,
    })),
    boundaries: snapshot.boundaries,
    resourceEdges: snapshot.edges,
    cssModules: snapshot.config.cssModules,
    externalCss: {
      fetchRemote: snapshot.externalCss.fetchRemote,
      globalProviders: snapshot.externalCss.globalProviders,
    },
  };
}
