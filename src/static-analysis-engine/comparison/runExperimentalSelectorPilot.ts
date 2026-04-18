import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ScanInput } from "../../runtime/types.js";
import type { Finding } from "../../runtime/types.js";
import { scanReactCss } from "../../index.js";
import { discoverProjectFiles } from "../../files/discoverFiles.js";
import { analyzeProjectSourceTexts, analyzeSourceText } from "../entry/scan.js";
import type { SelectorSourceInput } from "../pipeline/selector-analysis/types.js";
import { compareExperimentalRuleResults } from "./compareExperimentalRuleResults.js";
import { formatExperimentalComparisonReport } from "./formatExperimentalComparisonReport.js";
import type {
  ExperimentalSelectorPilotArtifact,
  ExperimentalSelectorPilotShadowArtifact,
} from "./types.js";

export function runExperimentalSelectorPilotForSource(input: {
  filePath: string;
  sourceText: string;
  selectorQueries?: string[];
  selectorCssSources?: SelectorSourceInput[];
  baselineFindings: Finding[];
}): ExperimentalSelectorPilotArtifact {
  const engineResult = analyzeSourceText(input);
  const comparisonResult = compareExperimentalRuleResults({
    experimentalRuleResults: engineResult.experimentalRuleResults,
    baselineFindings: input.baselineFindings,
  });

  return {
    engineResult,
    experimentalRuleResults: engineResult.experimentalRuleResults,
    comparisonResult,
    report: formatExperimentalComparisonReport(comparisonResult),
  };
}

export function runExperimentalSelectorPilotForProject(input: {
  sourceFiles: Array<{
    filePath: string;
    sourceText: string;
  }>;
  selectorQueries?: string[];
  selectorCssSources?: SelectorSourceInput[];
  baselineFindings: Finding[];
}): ExperimentalSelectorPilotArtifact {
  const engineResult = analyzeProjectSourceTexts(input);
  const comparisonResult = compareExperimentalRuleResults({
    experimentalRuleResults: engineResult.experimentalRuleResults,
    baselineFindings: input.baselineFindings,
  });

  return {
    engineResult,
    experimentalRuleResults: engineResult.experimentalRuleResults,
    comparisonResult,
    report: formatExperimentalComparisonReport(comparisonResult),
  };
}

export async function runExperimentalSelectorPilotAgainstCurrentScanner(
  input: ScanInput & {
    selectorQueries?: string[];
  } = {},
): Promise<ExperimentalSelectorPilotShadowArtifact> {
  const baselineScanResult = await scanReactCss(input);
  const scanCwd = resolveScanCwd(input);
  const discoveredFiles = await discoverProjectFiles(baselineScanResult.config, scanCwd);
  const [sourceFiles, selectorCssSources] = await Promise.all([
    Promise.all(
      discoveredFiles.sourceFiles.map(async (sourceFile) => ({
        filePath: sourceFile.relativePath,
        sourceText: await readFile(sourceFile.absolutePath, "utf8"),
      })),
    ),
    Promise.all(
      discoveredFiles.cssFiles.map(async (cssFile) => ({
        filePath: cssFile.relativePath,
        cssText: await readFile(cssFile.absolutePath, "utf8"),
      })),
    ),
  ]);

  const artifact = runExperimentalSelectorPilotForProject({
    sourceFiles,
    selectorQueries: input.selectorQueries,
    selectorCssSources,
    baselineFindings: baselineScanResult.findings,
  });

  return {
    ...artifact,
    baselineScanResult,
  };
}

function resolveScanCwd(input: ScanInput): string {
  const callerCwd = input.cwd ?? process.cwd();
  return input.targetPath ? path.resolve(callerCwd, input.targetPath) : callerCwd;
}
