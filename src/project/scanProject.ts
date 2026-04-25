import { readFile } from "node:fs/promises";
import { loadScannerConfig } from "../config/index.js";
import { runRules } from "../rules/index.js";
import { severityMeetsThreshold } from "../rules/severity.js";
import { analyzeProjectSourceTexts } from "../static-analysis-engine/index.js";
import { discoverProjectFiles } from "./discovery.js";
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
    configPath: input.configPath,
    diagnostics,
  });
  const [sourceFiles, cssFiles] = await Promise.all([
    readSourceFiles(discovered.sourceFiles, diagnostics),
    readCssFiles(discovered.cssFiles, diagnostics),
  ]);

  const engineResult = analyzeProjectSourceTexts({
    sourceFiles,
    selectorCssSources: cssFiles,
    cssModules: config.cssModules,
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
