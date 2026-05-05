import type {
  HtmlScriptSourceFact,
  HtmlStylesheetLinkFact,
  PackageCssImportFact,
  SourceImportFact,
  StylesheetImportFact,
} from "../types.js";
import type { ProjectResourceEdge } from "../types.js";
import { compareProjectResourceEdges } from "../utils/sorting.js";

export function collectProjectResourceEdges(input: {
  htmlStylesheetLinks: HtmlStylesheetLinkFact[];
  htmlScriptSources: HtmlScriptSourceFact[];
  packageCssImports: PackageCssImportFact[];
  stylesheetImports: StylesheetImportFact[];
  sourceImports: SourceImportFact[];
}): ProjectResourceEdge[] {
  const edges: ProjectResourceEdge[] = [
    ...input.htmlStylesheetLinks.map((stylesheetLink) => ({
      kind: "html-stylesheet" as const,
      fromHtmlFilePath: stylesheetLink.filePath,
      href: stylesheetLink.href,
      isRemote: stylesheetLink.isRemote,
      ...(stylesheetLink.resolvedFilePath
        ? { resolvedFilePath: stylesheetLink.resolvedFilePath }
        : {}),
    })),
    ...input.htmlScriptSources.map((scriptSource) => ({
      kind: "html-script" as const,
      fromHtmlFilePath: scriptSource.filePath,
      src: scriptSource.src,
      ...(scriptSource.resolvedFilePath ? { resolvedFilePath: scriptSource.resolvedFilePath } : {}),
      ...(scriptSource.appRootPath ? { appRootPath: scriptSource.appRootPath } : {}),
    })),
    ...input.packageCssImports.map((importRecord) => ({
      kind: "package-css-import" as const,
      importerKind: importRecord.importerKind,
      importerFilePath: importRecord.importerFilePath,
      specifier: importRecord.specifier,
      resolvedFilePath: importRecord.resolvedFilePath,
    })),
    ...input.stylesheetImports.map((importRecord) => ({
      kind: "stylesheet-import" as const,
      importerFilePath: importRecord.importerFilePath,
      specifier: importRecord.specifier,
      resolvedFilePath: importRecord.resolvedFilePath,
    })),
    ...input.sourceImports.map((importRecord) => ({
      kind: "source-import" as const,
      importerFilePath: importRecord.importerFilePath,
      specifier: importRecord.specifier,
      importKind: importRecord.importKind,
      importLoading: importRecord.importLoading,
      resolutionStatus: importRecord.resolutionStatus,
      ...(importRecord.resolvedFilePath ? { resolvedFilePath: importRecord.resolvedFilePath } : {}),
    })),
  ];

  return edges.sort(compareProjectResourceEdges);
}
