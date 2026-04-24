import { readFile } from "node:fs/promises";
import path from "node:path";
import { scanReactCss } from "../../index.js";
import { extractProjectFacts } from "../../facts/extractProjectFacts.js";
import { analyzeProjectSourceTexts, analyzeSourceText } from "../entry/scan.js";
import type { ExternalCssAnalysisInput } from "../pipeline/external-css/types.js";
import type { SelectorSourceInput } from "../pipeline/selector-analysis/types.js";
import type { CompatibilityScanInput as ScanInput, Finding } from "../runtime/compatTypes.js";
import { discoverProjectFilesForComparison } from "../adapters/current-scanner/fileDiscovery.js";
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
  externalCss?: ExternalCssAnalysisInput;
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
  externalCss?: ExternalCssAnalysisInput;
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
  const [discoveredFiles, facts] = await Promise.all([
    discoverProjectFilesForComparison(baselineScanResult.config, scanCwd),
    extractProjectFacts(baselineScanResult.config, scanCwd),
  ]);
  const [sourceFiles, projectCssSources] = await Promise.all([
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
  const selectorCssSources = [
    ...projectCssSources,
    ...facts.externalCssFacts.map((externalCssFact) => ({
      filePath: externalCssFact.specifier,
      cssText: externalCssFact.content,
    })),
  ].sort((left, right) => left.filePath.localeCompare(right.filePath));

  const artifact = runExperimentalSelectorPilotForProject({
    sourceFiles,
    selectorQueries: input.selectorQueries,
    selectorCssSources,
    externalCss: buildComparisonExternalCssInput({
      config: baselineScanResult.config,
      htmlFacts: facts.htmlFacts,
    }),
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

function buildComparisonExternalCssInput(input: {
  config: Awaited<ReturnType<typeof scanReactCss>>["config"];
  htmlFacts: Awaited<ReturnType<typeof extractProjectFacts>>["htmlFacts"];
}): ExternalCssAnalysisInput {
  return {
    enabled: input.config.externalCss.enabled,
    mode: input.config.externalCss.mode,
    globalProviders: input.config.externalCss.globals.map((provider) => ({
      provider: provider.provider,
      match: [...provider.match],
      classPrefixes: [...provider.classPrefixes],
      classNames: [...provider.classNames],
    })),
    htmlStylesheetLinks: input.htmlFacts.flatMap((htmlFact) =>
      htmlFact.stylesheetLinks.map((stylesheetLink) => ({
        filePath: htmlFact.filePath,
        href: stylesheetLink.href,
        isRemote: stylesheetLink.isRemote,
      })),
    ),
  };
}
