import type { ResolvedScannerConfig } from "../../../config/index.js";
import type { ProjectFileRecord, ScanDiagnostic } from "../../../project/types.js";

export type ProjectSnapshotStageRunner = <T>(
  stage: string,
  message: string,
  run: () => T | Promise<T>,
) => Promise<T>;

export type ProjectSnapshot = {
  rootDir: string;
  config: ResolvedScannerConfig;
  files: ProjectSnapshotFiles;
  discoveredFiles: {
    sourceFiles: ProjectFileRecord[];
    cssFiles: ProjectFileRecord[];
    htmlFiles: ProjectFileRecord[];
  };
  boundaries: ProjectBoundary[];
  edges: ProjectResourceEdge[];
  externalCss: ProjectExternalCssSurface;
  diagnostics: ScanDiagnostic[];
};

export type ProjectSnapshotFiles = {
  sourceFiles: ProjectSourceFile[];
  stylesheets: ProjectStylesheetFile[];
  htmlFiles: ProjectHtmlFile[];
  configFiles: ProjectConfigFile[];
};

export type ProjectSourceFile = {
  kind: "source";
  filePath: string;
  absolutePath: string;
  sourceText: string;
};

export type ProjectStylesheetFile = {
  kind: "stylesheet";
  filePath: string;
  absolutePath?: string;
  cssText: string;
  cssKind: "global-css" | "css-module";
  origin: "project" | "html-linked" | "package" | "remote";
};

export type HtmlStylesheetLinkFact = {
  filePath: string;
  href: string;
  isRemote: boolean;
  resolvedFilePath?: string;
};

export type HtmlScriptSourceFact = {
  filePath: string;
  src: string;
  resolvedFilePath?: string;
  appRootPath?: string;
};

export type PackageCssImportFact = {
  importerKind: "source" | "stylesheet";
  importerFilePath: string;
  specifier: string;
  resolvedFilePath: string;
};

export type StylesheetImportFact = {
  importerFilePath: string;
  specifier: string;
  resolvedFilePath: string;
};

export type SourceImportKind = "source" | "css" | "external-css" | "type-only" | "unknown";

export type SourceImportFact = {
  importerFilePath: string;
  specifier: string;
  importKind: SourceImportKind;
  resolutionStatus: "resolved" | "unresolved" | "external" | "unsupported";
  resolvedFilePath?: string;
};

// TODO(workspace-discovery): compatibility aliases for existing external-css/direct engine inputs.
// Prefer the *Fact names inside workspace-discovery and remove these once downstream APIs are renamed.
export type HtmlStylesheetLinkInput = HtmlStylesheetLinkFact;
export type HtmlScriptSourceInput = HtmlScriptSourceFact;
export type PackageCssImportInput = PackageCssImportFact;

export type ProjectHtmlFile = {
  kind: "html";
  filePath: string;
  absolutePath: string;
  htmlText: string;
};

export type ProjectConfigFile = {
  kind: "config";
  source: ResolvedScannerConfig["source"];
  filePath?: string;
};

export type ProjectBoundary =
  | {
      kind: "scan-root";
      rootDir: string;
    }
  | {
      kind: "source-root";
      filePath: string;
      source: "config";
    }
  | {
      kind: "workspace-package";
      packageName: string;
      entryFilePath: string;
      confidence: "heuristic";
      reason: "discovered-workspace-entrypoint";
    }
  | {
      kind: "html-app-entry";
      htmlFilePath: string;
      entrySourceFilePath: string;
      appRootPath: string;
    };

export type ProjectResourceEdge =
  | HtmlStylesheetEdge
  | HtmlScriptEdge
  | PackageCssImportEdge
  | StylesheetImportEdge
  | SourceImportEdge;

export type HtmlStylesheetEdge = Omit<HtmlStylesheetLinkFact, "filePath"> & {
  kind: "html-stylesheet";
  fromHtmlFilePath: string;
};

export type HtmlScriptEdge = Omit<HtmlScriptSourceFact, "filePath"> & {
  kind: "html-script";
  fromHtmlFilePath: string;
};

export type PackageCssImportEdge = PackageCssImportFact & {
  kind: "package-css-import";
};

export type StylesheetImportEdge = StylesheetImportFact & {
  kind: "stylesheet-import";
};

export type SourceImportEdge = SourceImportFact & {
  kind: "source-import";
};

export type ProjectExternalCssSurface = {
  fetchRemote: boolean;
  globalProviders: ResolvedScannerConfig["externalCss"]["globals"];
};
