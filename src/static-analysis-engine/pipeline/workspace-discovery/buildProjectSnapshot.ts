import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { ResolvedScannerConfig } from "../../../config/index.js";
import { loadScannerConfig } from "../../../config/index.js";
import { normalizeProjectPath, resolveRootDir } from "../../../project/pathUtils.js";
import type { ScanDiagnostic, ScanProjectInput } from "../../../project/types.js";
import { collectProjectBoundaries } from "./boundaries/collectProjectBoundaries.js";
import { collectProjectResourceEdges } from "./edges/collectResourceEdges.js";
import { discoverProjectFileRecords } from "./files/discoverProjectFileRecords.js";
import { readCssFiles, readHtmlFiles, readSourceFiles } from "./files/readProjectFileContents.js";
import { mergeStylesheets, toCssSources, toStylesheetFiles } from "./files/stylesheetInventory.js";
import { collectHtmlResources } from "./html/htmlLinks.js";
import { collectLinkedCssFiles } from "./html/htmlPathResolution.js";
import { loadPackageCssImports } from "./packages/loadPackageCssImports.js";
import { fetchRemoteCssSources } from "./remote/fetchRemoteCssSources.js";
import { collectSourceImports } from "./source/collectSourceImports.js";
import { collectStylesheetImports } from "./stylesheets/collectStylesheetImports.js";
import type { ProjectBundlerConfigFile, ProjectConfigFile, ProjectSnapshot } from "./types.js";

export async function buildProjectSnapshot(input: {
  scanInput: ScanProjectInput;
  rootDir?: string;
}): Promise<ProjectSnapshot> {
  const rootDir = resolveRootDir(input.rootDir ?? input.scanInput.rootDir);
  const diagnostics: ScanDiagnostic[] = [];
  const config = await loadScannerConfig({
    rootDir,
    configBaseDir: input.scanInput.configBaseDir,
    configPath: input.scanInput.configPath,
    diagnostics,
  });
  const discovered = await discoverProjectFileRecords({
    ...input.scanInput,
    rootDir,
    discovery: config.discovery,
  });
  diagnostics.push(...discovered.diagnostics);

  const [sourceFiles, cssFiles, htmlFiles] = await Promise.all([
    readSourceFiles(discovered.sourceFiles, diagnostics),
    readCssFiles(discovered.cssFiles, diagnostics, "project"),
    readHtmlFiles(discovered.htmlFiles, diagnostics),
  ]);
  const bundlerConfigFiles = hasRootDiscoveryError(discovered.diagnostics)
    ? []
    : await collectRootBundlerConfigFiles({
        rootDir: discovered.rootDir,
        diagnostics,
      });
  const { htmlStylesheetLinks, htmlScriptSources } = collectHtmlResources({
    rootDir: discovered.rootDir,
    htmlFiles,
    diagnostics,
  });
  const linkedCssFiles = await readCssFiles(
    collectLinkedCssFiles({
      rootDir: discovered.rootDir,
      cssFiles: discovered.cssFiles,
      htmlStylesheetLinks,
    }),
    diagnostics,
    "html-linked",
  );
  const packageCssImports = await loadPackageCssImports({
    rootDir: discovered.rootDir,
    sourceFiles,
    cssSources: toCssSources([...cssFiles, ...linkedCssFiles]),
    diagnostics,
  });
  const packageStylesheets = toStylesheetFiles(packageCssImports.cssSources, "package");
  const remoteCssSources = config.externalCss.fetchRemote
    ? await fetchRemoteCssSources({
        htmlStylesheetLinks,
        remoteTimeoutMs: config.externalCss.remoteTimeoutMs,
        diagnostics,
      })
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
      bundlerConfigFiles,
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

async function collectRootBundlerConfigFiles(input: {
  rootDir: string;
  diagnostics: ScanDiagnostic[];
}): Promise<ProjectBundlerConfigFile[]> {
  let entries: string[];
  try {
    entries = await readdir(input.rootDir);
  } catch (error) {
    input.diagnostics.push({
      code: "discovery.bundler-config-read-failed",
      severity: "warning",
      phase: "discovery",
      filePath: ".",
      message: `failed to inspect root bundler config files: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    return [];
  }

  const configFilePaths = entries
    .filter(isRootBundlerConfigFileName)
    .map((fileName) => normalizeProjectPath(fileName))
    .sort((left, right) => left.localeCompare(right));
  const loadedConfigFiles = await Promise.all(
    configFilePaths.map(async (filePath) => {
      const absolutePath = path.join(input.rootDir, filePath);
      try {
        return {
          kind: "bundler-config" as const,
          bundler: "vite" as const,
          filePath,
          absolutePath,
          sourceText: await readFile(absolutePath, "utf8"),
        };
      } catch (error) {
        input.diagnostics.push({
          code: "loading.bundler-config-read-failed",
          severity: "warning",
          phase: "loading",
          filePath,
          message: `failed to read bundler config ${filePath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
        return undefined;
      }
    }),
  );

  return loadedConfigFiles.filter((file): file is ProjectBundlerConfigFile => Boolean(file));
}

function isRootBundlerConfigFileName(fileName: string): boolean {
  return /^vite\.config\.[cm]?[jt]s$/.test(fileName);
}

function hasRootDiscoveryError(diagnostics: ScanDiagnostic[]): boolean {
  return diagnostics.some(
    (diagnostic) =>
      diagnostic.severity === "error" && diagnostic.code.startsWith("discovery.root-"),
  );
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
