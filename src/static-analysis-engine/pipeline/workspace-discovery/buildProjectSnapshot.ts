import type { ResolvedScannerConfig } from "../../../config/index.js";
import { loadScannerConfig } from "../../../config/index.js";
import { discoverProjectFiles } from "../../../project/discovery.js";
import { resolveRootDir } from "../../../project/pathUtils.js";
import type { ScanDiagnostic, ScanProjectInput } from "../../../project/types.js";
import { collectProjectBoundaries } from "./boundaries/collectProjectBoundaries.js";
import { collectProjectResourceEdges } from "./edges/collectResourceEdges.js";
import { mergeStylesheets, toCssSources, toStylesheetFiles } from "./files/stylesheetInventory.js";
import { readCssFiles, readHtmlFiles, readSourceFiles } from "./files/loadProjectFiles.js";
import { collectHtmlResources } from "./html/htmlLinks.js";
import { collectLinkedCssFiles } from "./html/htmlPathResolution.js";
import { loadPackageCssImports } from "./packages/loadPackageCssImports.js";
import { fetchRemoteCssSources } from "./remote/fetchRemoteCssSources.js";
import { collectSourceImports } from "./source/collectSourceImports.js";
import { collectStylesheetImports } from "./stylesheets/collectStylesheetImports.js";
import type { ProjectConfigFile, ProjectSnapshot, ProjectSnapshotStageRunner } from "./types.js";

export async function buildProjectSnapshot(input: {
  scanInput: ScanProjectInput;
  rootDir?: string;
  runStage: ProjectSnapshotStageRunner;
}): Promise<ProjectSnapshot> {
  const rootDir = resolveRootDir(input.rootDir ?? input.scanInput.rootDir);
  const diagnostics: ScanDiagnostic[] = [];
  const config = await input.runStage("load-config", "Loading config", () =>
    loadScannerConfig({
      rootDir,
      configBaseDir: input.scanInput.configBaseDir,
      configPath: input.scanInput.configPath,
      diagnostics,
    }),
  );
  const discovered = await input.runStage("discover-files", "Discovering project files", () =>
    discoverProjectFiles({
      ...input.scanInput,
      rootDir,
      discovery: config.discovery,
    }),
  );
  diagnostics.push(...discovered.diagnostics);

  const [sourceFiles, cssFiles, htmlFiles] = await input.runStage(
    "load-files",
    "Loading project files",
    () =>
      Promise.all([
        readSourceFiles(discovered.sourceFiles, diagnostics),
        readCssFiles(discovered.cssFiles, diagnostics, "project"),
        readHtmlFiles(discovered.htmlFiles, diagnostics),
      ]),
  );
  const { htmlStylesheetLinks, htmlScriptSources } = collectHtmlResources({
    rootDir: discovered.rootDir,
    htmlFiles,
    diagnostics,
  });
  const linkedCssFiles = await input.runStage("load-html-css", "Loading HTML-linked CSS", () =>
    readCssFiles(
      collectLinkedCssFiles({
        rootDir: discovered.rootDir,
        cssFiles: discovered.cssFiles,
        htmlStylesheetLinks,
      }),
      diagnostics,
      "html-linked",
    ),
  );
  const packageCssImports = await input.runStage(
    "load-package-css",
    "Loading package CSS imports",
    () =>
      loadPackageCssImports({
        rootDir: discovered.rootDir,
        sourceFiles,
        cssSources: toCssSources([...cssFiles, ...linkedCssFiles]),
        diagnostics,
      }),
  );
  const packageStylesheets = toStylesheetFiles(packageCssImports.cssSources, "package");
  const remoteCssSources = config.externalCss.fetchRemote
    ? await input.runStage("fetch-remote-css", "Fetching remote CSS", () =>
        fetchRemoteCssSources({
          htmlStylesheetLinks,
          remoteTimeoutMs: config.externalCss.remoteTimeoutMs,
          diagnostics,
        }),
      )
    : [];
  const remoteStylesheets = toStylesheetFiles(remoteCssSources, "remote");
  const stylesheets = mergeStylesheets([
    ...cssFiles,
    ...linkedCssFiles,
    ...packageStylesheets,
    ...remoteStylesheets,
  ]);
  const stylesheetImports = collectStylesheetImports({
    stylesheets,
  });
  const sourceImports = collectSourceImports({
    sourceFiles,
    stylesheets,
  });

  return {
    rootDir: discovered.rootDir,
    config,
    files: {
      sourceFiles,
      stylesheets,
      htmlFiles,
      configFiles: collectConfigFiles(config),
    },
    discoveredFiles: {
      sourceFiles: discovered.sourceFiles,
      cssFiles: discovered.cssFiles,
      htmlFiles: discovered.htmlFiles,
    },
    boundaries: collectProjectBoundaries({
      rootDir: discovered.rootDir,
      config,
      htmlScriptSources,
      sourceFiles,
    }),
    edges: collectProjectResourceEdges({
      htmlStylesheetLinks,
      htmlScriptSources,
      packageCssImports: packageCssImports.imports,
      stylesheetImports,
      sourceImports,
    }),
    externalCss: {
      fetchRemote: config.externalCss.fetchRemote,
      globalProviders: config.externalCss.globals,
    },
    diagnostics,
  };
}

function collectConfigFiles(config: ResolvedScannerConfig): ProjectConfigFile[] {
  return [
    {
      kind: "config",
      source: config.source,
      ...("path" in config.source ? { filePath: config.source.path } : {}),
    },
  ];
}
