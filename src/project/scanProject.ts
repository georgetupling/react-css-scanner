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
import { extractHtmlStylesheetLinks } from "./htmlStylesheetLinks.js";
import { loadPackageCssImports } from "./packageCssImports.js";
import { normalizeProjectPath } from "./pathUtils.js";
import type {
  ProjectFileRecord,
  ScanDiagnostic,
  ScanProjectInput,
  ScanProjectResult,
  ScanSummary,
} from "./types.js";

export async function scanProject(input: ScanProjectInput = {}): Promise<ScanProjectResult> {
  const discovered = await discoverProjectFiles(input);
  const diagnostics: ScanDiagnostic[] = [...discovered.diagnostics];
  const config = await loadScannerConfig({
    rootDir: discovered.rootDir,
    configBaseDir: input.configBaseDir,
    configPath: input.configPath,
    diagnostics,
  });
  const [sourceFiles, cssFiles, htmlFiles] = await Promise.all([
    readSourceFiles(discovered.sourceFiles, diagnostics),
    readCssFiles(discovered.cssFiles, diagnostics),
    readHtmlFiles(discovered.htmlFiles, diagnostics),
  ]);
  const htmlStylesheetLinks = htmlFiles.flatMap((htmlFile) =>
    extractHtmlStylesheetLinks({
      filePath: htmlFile.filePath,
      htmlText: htmlFile.htmlText,
    }),
  );
  const htmlLinksEnabled =
    config.externalCss.enabled && config.externalCss.modes.includes("html-links");
  const resolvedHtmlStylesheetLinks = htmlLinksEnabled
    ? resolveLocalHtmlStylesheetLinks({
        rootDir: discovered.rootDir,
        htmlStylesheetLinks,
        diagnostics,
      })
    : htmlStylesheetLinks;
  const linkedCssFiles = htmlLinksEnabled
    ? await readCssFiles(
        collectLinkedCssFiles({
          rootDir: discovered.rootDir,
          cssFiles: discovered.cssFiles,
          htmlStylesheetLinks: resolvedHtmlStylesheetLinks,
        }),
        diagnostics,
      )
    : [];
  const packageCssImportsEnabled =
    config.externalCss.enabled && config.externalCss.modes.includes("imported-packages");
  const packageCssImports = packageCssImportsEnabled
    ? await loadPackageCssImports({
        rootDir: discovered.rootDir,
        sourceFiles,
        cssSources: [...cssFiles, ...linkedCssFiles],
        diagnostics,
      })
    : { cssSources: [], imports: [] };
  const selectorCssSources = mergeCssSources([
    ...cssFiles,
    ...linkedCssFiles,
    ...packageCssImports.cssSources,
  ]);

  const engineResult = analyzeProjectSourceTexts({
    sourceFiles,
    selectorCssSources,
    cssModules: config.cssModules,
    externalCss: {
      enabled: config.externalCss.enabled,
      modes: config.externalCss.modes,
      globalProviders: config.externalCss.globals,
      htmlStylesheetLinks: resolvedHtmlStylesheetLinks,
      packageCssImports: packageCssImports.imports,
    },
  });
  const ruleResult = runRules({
    analysis: engineResult.projectAnalysis,
    config,
  });
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

  return {
    rootDir: discovered.rootDir,
    config,
    findings: ruleResult.findings,
    diagnostics,
    summary,
    failed,
    files: {
      sourceFiles: discovered.sourceFiles,
      cssFiles: discovered.cssFiles,
      htmlFiles: discovered.htmlFiles,
    },
  };
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
    findingsBySeverity: {
      debug: countFindingsBySeverity(input.findings, "debug"),
      info: countFindingsBySeverity(input.findings, "info"),
      warn: countFindingsBySeverity(input.findings, "warn"),
      error: countFindingsBySeverity(input.findings, "error"),
    },
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

function countFindingsBySeverity(
  findings: ScanProjectResult["findings"],
  severity: keyof ScanSummary["findingsBySeverity"],
): number {
  return findings.filter((finding) => finding.severity === severity).length;
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
  if (!href.endsWith(".css")) {
    return false;
  }

  if (href.startsWith("//")) {
    return false;
  }

  return !/^[a-z][a-z0-9+.-]*:/i.test(href);
}

function resolveLocalHrefProjectPath(input: {
  htmlFilePath: string;
  href: string;
}): string | undefined {
  const hrefPath = input.href.replace(/\\/g, "/");
  if (hrefPath.startsWith("/")) {
    return normalizeProjectPath(hrefPath.replace(/^\/+/, ""));
  }

  const htmlDirectory = path.posix.dirname(input.htmlFilePath.replace(/\\/g, "/"));
  const relativePath = htmlDirectory === "." ? hrefPath : path.posix.join(htmlDirectory, hrefPath);
  return normalizeProjectPath(relativePath);
}

function isPathInsideRoot(rootDir: string, absolutePath: string): boolean {
  const relativePath = path.relative(rootDir, absolutePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}
