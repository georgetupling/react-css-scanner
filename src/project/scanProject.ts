import path from "node:path";
import { readFile } from "node:fs/promises";
import { loadScannerConfig } from "../config/index.js";
import { runRules } from "../rules/index.js";
import { severityMeetsThreshold } from "../rules/severity.js";
import {
  analyzeProjectSourceTexts,
  type HtmlStylesheetLinkInput,
} from "../static-analysis-engine/index.js";
import { discoverProjectFiles } from "./discovery.js";
import { extractHtmlScriptSources } from "./htmlScriptSources.js";
import { extractHtmlStylesheetLinks } from "./htmlStylesheetLinks.js";
import { applyIgnoreFilter, mergeIgnoreConfig } from "./ignoreFilter.js";
import { loadPackageCssImports } from "./packageCssImports.js";
import { normalizeProjectPath, resolveRootDir } from "./pathUtils.js";
import { fetchRemoteCssSources } from "./remoteCss.js";
import { countFindingsByRule, countFindingsBySeverity } from "./summaryCounts.js";
import type {
  ProjectFileRecord,
  ScanDiagnostic,
  ScanPerformance,
  ScanPerformanceStage,
  ScanProjectInput,
  ScanProjectResult,
  ScanProgressCallback,
  ScanSummary,
} from "./types.js";

export async function scanProject(input: ScanProjectInput = {}): Promise<ScanProjectResult> {
  const totalStartedAt = performance.now();
  const performanceStages: ScanPerformanceStage[] = [];
  const rootDir = resolveRootDir(input.rootDir);
  const diagnostics: ScanDiagnostic[] = [];
  const progress = createScanProgressReporter({
    onProgress: input.onProgress,
    performanceStages: input.collectPerformance ? performanceStages : undefined,
  });
  const config = await runScanStage(progress, "load-config", "Loading config", () =>
    loadScannerConfig({
      rootDir,
      configBaseDir: input.configBaseDir,
      configPath: input.configPath,
      diagnostics,
    }),
  );
  const discovered = await runScanStage(
    progress,
    "discover-files",
    "Discovering project files",
    () =>
      discoverProjectFiles({
        ...input,
        rootDir,
        discovery: config.discovery,
      }),
  );
  diagnostics.push(...discovered.diagnostics);
  const [sourceFiles, cssFiles, htmlFiles] = await runScanStage(
    progress,
    "load-files",
    "Loading project files",
    () =>
      Promise.all([
        readSourceFiles(discovered.sourceFiles, diagnostics),
        readCssFiles(discovered.cssFiles, diagnostics),
        readHtmlFiles(discovered.htmlFiles, diagnostics),
      ]),
  );
  const htmlStylesheetLinks = htmlFiles.flatMap((htmlFile) =>
    extractHtmlStylesheetLinks({
      filePath: htmlFile.filePath,
      htmlText: htmlFile.htmlText,
    }),
  );
  const htmlScriptSources = htmlFiles.flatMap((htmlFile) =>
    extractHtmlScriptSources({
      filePath: htmlFile.filePath,
      htmlText: htmlFile.htmlText,
    }),
  );
  const resolvedHtmlStylesheetLinks = resolveLocalHtmlStylesheetLinks({
    rootDir: discovered.rootDir,
    htmlStylesheetLinks,
    diagnostics,
  });
  const resolvedHtmlScriptSources = resolveLocalHtmlScriptSources({
    rootDir: discovered.rootDir,
    htmlScriptSources,
    diagnostics,
  });
  const linkedCssFiles = await runScanStage(
    progress,
    "load-html-css",
    "Loading HTML-linked CSS",
    () =>
      readCssFiles(
        collectLinkedCssFiles({
          rootDir: discovered.rootDir,
          cssFiles: discovered.cssFiles,
          htmlStylesheetLinks: resolvedHtmlStylesheetLinks,
        }),
        diagnostics,
      ),
  );
  const packageCssImports = await runScanStage(
    progress,
    "load-package-css",
    "Loading package CSS imports",
    () =>
      loadPackageCssImports({
        rootDir: discovered.rootDir,
        sourceFiles,
        cssSources: [...cssFiles, ...linkedCssFiles],
        diagnostics,
      }),
  );
  const remoteCssSources = config.externalCss.fetchRemote
    ? await runScanStage(progress, "fetch-remote-css", "Fetching remote CSS", () =>
        fetchRemoteCssSources({
          htmlStylesheetLinks: resolvedHtmlStylesheetLinks,
          remoteTimeoutMs: config.externalCss.remoteTimeoutMs,
          diagnostics,
        }),
      )
    : [];
  const selectorCssSources = mergeCssSources([
    ...cssFiles,
    ...linkedCssFiles,
    ...packageCssImports.cssSources,
    ...remoteCssSources,
  ]);

  const engineResult = analyzeProjectSourceTexts({
    sourceFiles,
    projectRoot: discovered.rootDir,
    selectorCssSources,
    cssModules: config.cssModules,
    externalCss: {
      fetchRemote: config.externalCss.fetchRemote,
      globalProviders: config.externalCss.globals,
      htmlStylesheetLinks: resolvedHtmlStylesheetLinks,
      htmlScriptSources: resolvedHtmlScriptSources,
      packageCssImports: packageCssImports.imports,
    },
    includeTraces: input.includeTraces ?? true,
    onProgress: (event) => progress(event.stage, event.status, event.message, event.durationMs),
  });
  const ruleResult = await runScanStage(progress, "run-rules", "Running rules", () =>
    runRules({
      analysis: engineResult.projectAnalysis,
      config,
      includeTraces: input.includeTraces ?? true,
    }),
  );
  const failed =
    diagnostics.some((diagnostic) => diagnostic.severity === "error") ||
    ruleResult.findings.some((finding) =>
      severityMeetsThreshold(finding.severity, config.failOnSeverity),
    );
  const summary = buildScanSummary({
    sourceFileCount: discovered.sourceFiles.length,
    cssFileCount: discovered.cssFiles.length,
    findings: ruleResult.findings,
    diagnostics,
    classReferenceCount: engineResult.projectAnalysis.entities.classReferences.length,
    classDefinitionCount: engineResult.projectAnalysis.entities.classDefinitions.length,
    selectorQueryCount: engineResult.projectAnalysis.entities.selectorQueries.length,
    failed,
  });

  const unignoredResult: ScanProjectResult = {
    rootDir: discovered.rootDir,
    config,
    findings: ruleResult.findings,
    diagnostics,
    summary,
    ...(input.collectPerformance
      ? {
          performance: buildScanPerformance({
            totalMs: performance.now() - totalStartedAt,
            stages: performanceStages,
          }),
        }
      : {}),
    failed,
    files: {
      sourceFiles: discovered.sourceFiles,
      cssFiles: discovered.cssFiles,
      htmlFiles: discovered.htmlFiles,
    },
  };

  return applyIgnoreFilter(
    unignoredResult,
    mergeIgnoreConfig({
      config: config.ignore,
      overrides: input.ignore,
    }),
  );
}

function createScanProgressReporter(input: {
  onProgress?: ScanProgressCallback;
  performanceStages?: ScanPerformanceStage[];
}) {
  return (
    stage: string,
    status: "started" | "completed",
    message: string,
    durationMs?: number,
  ): void => {
    if (status === "completed" && durationMs !== undefined) {
      input.performanceStages?.push({
        stage,
        message,
        durationMs: roundDuration(durationMs),
      });
    }

    input.onProgress?.({
      stage,
      status,
      message,
      ...(durationMs === undefined ? {} : { durationMs: roundDuration(durationMs) }),
    });
  };
}

async function runScanStage<T>(
  progress: ReturnType<typeof createScanProgressReporter>,
  stage: string,
  message: string,
  run: () => T | Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  progress(stage, "started", message);
  const result = await run();
  progress(stage, "completed", message, performance.now() - startedAt);
  return result;
}

function buildScanPerformance(input: {
  totalMs: number;
  stages: ScanPerformanceStage[];
}): ScanPerformance {
  return {
    totalMs: roundDuration(input.totalMs),
    stages: input.stages,
  };
}

function roundDuration(durationMs: number): number {
  return Math.round(durationMs * 10) / 10;
}

async function readSourceFiles(
  sourceFiles: ProjectFileRecord[],
  diagnostics: ScanDiagnostic[],
): Promise<Array<{ filePath: string; sourceText: string }>> {
  const loadedFiles = await Promise.all(
    sourceFiles.map(async (sourceFile) => {
      const content = await readProjectFile(sourceFile, diagnostics);
      return content
        ? {
            filePath: sourceFile.filePath,
            sourceText: content,
          }
        : undefined;
    }),
  );

  return loadedFiles.filter((file): file is { filePath: string; sourceText: string } =>
    Boolean(file),
  );
}

function buildScanSummary(input: {
  sourceFileCount: number;
  cssFileCount: number;
  findings: ScanProjectResult["findings"];
  diagnostics: ScanDiagnostic[];
  classReferenceCount: number;
  classDefinitionCount: number;
  selectorQueryCount: number;
  failed: boolean;
}): ScanSummary {
  return {
    sourceFileCount: input.sourceFileCount,
    cssFileCount: input.cssFileCount,
    findingCount: input.findings.length,
    ignoredFindingCount: 0,
    findingsByRule: countFindingsByRule(input.findings),
    findingsBySeverity: countFindingsBySeverity(input.findings),
    diagnosticCount: input.diagnostics.length,
    diagnosticsBySeverity: {
      debug: countDiagnosticsBySeverity(input.diagnostics, "debug"),
      info: countDiagnosticsBySeverity(input.diagnostics, "info"),
      warning: countDiagnosticsBySeverity(input.diagnostics, "warning"),
      error: countDiagnosticsBySeverity(input.diagnostics, "error"),
    },
    classReferenceCount: input.classReferenceCount,
    classDefinitionCount: input.classDefinitionCount,
    selectorQueryCount: input.selectorQueryCount,
    failed: input.failed,
  };
}

function countDiagnosticsBySeverity(
  diagnostics: ScanDiagnostic[],
  severity: keyof ScanSummary["diagnosticsBySeverity"],
): number {
  return diagnostics.filter((diagnostic) => diagnostic.severity === severity).length;
}

async function readCssFiles(
  cssFiles: ProjectFileRecord[],
  diagnostics: ScanDiagnostic[],
): Promise<Array<{ filePath: string; cssText: string }>> {
  const loadedFiles = await Promise.all(
    cssFiles.map(async (cssFile) => {
      const content = await readProjectFile(cssFile, diagnostics);
      return content
        ? {
            filePath: cssFile.filePath,
            cssText: content,
          }
        : undefined;
    }),
  );

  return loadedFiles.filter((file): file is { filePath: string; cssText: string } => Boolean(file));
}

async function readHtmlFiles(
  htmlFiles: ProjectFileRecord[],
  diagnostics: ScanDiagnostic[],
): Promise<Array<{ filePath: string; htmlText: string }>> {
  const loadedFiles = await Promise.all(
    htmlFiles.map(async (htmlFile) => {
      const content = await readProjectFile(htmlFile, diagnostics);
      return content
        ? {
            filePath: htmlFile.filePath,
            htmlText: content,
          }
        : undefined;
    }),
  );

  return loadedFiles.filter((file): file is { filePath: string; htmlText: string } =>
    Boolean(file),
  );
}

async function readProjectFile(
  file: ProjectFileRecord,
  diagnostics: ScanDiagnostic[],
): Promise<string | undefined> {
  try {
    return await readFile(file.absolutePath, "utf8");
  } catch (error) {
    diagnostics.push({
      code: "loading.file-read-failed",
      severity: "error",
      phase: "loading",
      filePath: file.filePath,
      message: `failed to read ${file.filePath}: ${error instanceof Error ? error.message : String(error)}`,
    });
    return undefined;
  }
}

function resolveLocalHtmlScriptSources(input: {
  rootDir: string;
  htmlScriptSources: import("./htmlScriptSources.js").HtmlScriptSourceInput[];
  diagnostics: ScanDiagnostic[];
}): import("./htmlScriptSources.js").HtmlScriptSourceInput[] {
  return input.htmlScriptSources.map((scriptSource) => {
    if (!isLocalSourceHref(scriptSource.src)) {
      return scriptSource;
    }

    const resolvedFilePath = resolveLocalHrefProjectPath({
      htmlFilePath: scriptSource.filePath,
      href: scriptSource.src,
    });
    if (!resolvedFilePath) {
      return scriptSource;
    }

    const absolutePath = path.resolve(input.rootDir, resolvedFilePath);
    if (!isPathInsideRoot(input.rootDir, absolutePath)) {
      input.diagnostics.push({
        code: "loading.html-script-outside-root",
        severity: "warning",
        phase: "loading",
        filePath: scriptSource.filePath,
        message: `HTML script source points outside the scan root and was ignored: ${scriptSource.src}`,
      });
      return scriptSource;
    }

    return {
      ...scriptSource,
      resolvedFilePath,
      appRootPath: inferHtmlScriptAppRootPath({
        htmlFilePath: scriptSource.filePath,
        scriptFilePath: resolvedFilePath,
      }),
    };
  });
}

function resolveLocalHtmlStylesheetLinks(input: {
  rootDir: string;
  htmlStylesheetLinks: HtmlStylesheetLinkInput[];
  diagnostics: ScanDiagnostic[];
}): HtmlStylesheetLinkInput[] {
  return input.htmlStylesheetLinks.map((stylesheetLink) => {
    if (stylesheetLink.isRemote || !isLocalCssHref(stylesheetLink.href)) {
      return stylesheetLink;
    }

    const resolvedFilePath = resolveLocalHrefProjectPath({
      htmlFilePath: stylesheetLink.filePath,
      href: stylesheetLink.href,
    });
    if (!resolvedFilePath) {
      return stylesheetLink;
    }

    const absolutePath = path.resolve(input.rootDir, resolvedFilePath);
    if (!isPathInsideRoot(input.rootDir, absolutePath)) {
      input.diagnostics.push({
        code: "loading.html-stylesheet-outside-root",
        severity: "warning",
        phase: "loading",
        filePath: stylesheetLink.filePath,
        message: `HTML stylesheet link points outside the scan root and was ignored: ${stylesheetLink.href}`,
      });
      return stylesheetLink;
    }

    return {
      ...stylesheetLink,
      resolvedFilePath,
    };
  });
}

function collectLinkedCssFiles(input: {
  rootDir: string;
  cssFiles: ProjectFileRecord[];
  htmlStylesheetLinks: HtmlStylesheetLinkInput[];
}): ProjectFileRecord[] {
  const knownCssFilePaths = new Set(input.cssFiles.map((cssFile) => cssFile.filePath));
  const linkedCssFilePaths = [
    ...new Set(
      input.htmlStylesheetLinks
        .map((stylesheetLink) => stylesheetLink.resolvedFilePath)
        .filter((filePath): filePath is string => Boolean(filePath)),
    ),
  ].sort((left, right) => left.localeCompare(right));

  return linkedCssFilePaths
    .filter((filePath) => !knownCssFilePaths.has(filePath))
    .map((filePath) => ({
      filePath,
      absolutePath: path.resolve(input.rootDir, filePath),
    }));
}

function mergeCssSources(
  cssSources: Array<{ filePath: string; cssText: string }>,
): Array<{ filePath: string; cssText: string }> {
  const cssSourceByPath = new Map<string, { filePath: string; cssText: string }>();
  for (const cssSource of cssSources) {
    cssSourceByPath.set(cssSource.filePath, cssSource);
  }

  return [...cssSourceByPath.values()].sort((left, right) =>
    left.filePath.localeCompare(right.filePath),
  );
}

function isLocalCssHref(href: string): boolean {
  const hrefPath = stripUrlSuffix(href);
  if (!hrefPath.endsWith(".css")) {
    return false;
  }

  if (hrefPath.startsWith("//")) {
    return false;
  }

  return !/^[a-z][a-z0-9+.-]*:/i.test(hrefPath);
}

function isLocalSourceHref(href: string): boolean {
  const hrefPath = stripUrlSuffix(href);
  if (!/\.[cm]?[jt]sx?$/.test(hrefPath)) {
    return false;
  }

  if (hrefPath.startsWith("//")) {
    return false;
  }

  return !/^[a-z][a-z0-9+.-]*:/i.test(hrefPath);
}

function resolveLocalHrefProjectPath(input: {
  htmlFilePath: string;
  href: string;
}): string | undefined {
  const hrefPath = stripUrlSuffix(input.href).replace(/\\/g, "/");
  if (hrefPath.startsWith("/")) {
    return normalizeProjectPath(hrefPath.replace(/^\/+/, ""));
  }

  const htmlDirectory = path.posix.dirname(input.htmlFilePath.replace(/\\/g, "/"));
  const relativePath = htmlDirectory === "." ? hrefPath : path.posix.join(htmlDirectory, hrefPath);
  return normalizeProjectPath(relativePath);
}

function inferHtmlScriptAppRootPath(input: {
  htmlFilePath: string;
  scriptFilePath: string;
}): string {
  const htmlDirectory = path.posix.dirname(input.htmlFilePath.replace(/\\/g, "/"));
  const scriptDirectory = path.posix.dirname(input.scriptFilePath.replace(/\\/g, "/"));
  const htmlSegments = htmlDirectory === "." ? [] : htmlDirectory.split("/");
  const scriptSegments = scriptDirectory === "." ? [] : scriptDirectory.split("/");
  const commonSegments: string[] = [];

  for (
    let index = 0;
    index < Math.min(htmlSegments.length, scriptSegments.length) &&
    htmlSegments[index] === scriptSegments[index];
    index += 1
  ) {
    commonSegments.push(htmlSegments[index]);
  }

  return commonSegments.join("/") || ".";
}

function stripUrlSuffix(href: string): string {
  return href.split(/[?#]/, 1)[0] ?? href;
}

function isPathInsideRoot(rootDir: string, absolutePath: string): boolean {
  const relativePath = path.relative(rootDir, absolutePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}
