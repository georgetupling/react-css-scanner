import type { ClassExpressionSummary } from "../../abstract-values/types.js";
import type { ExperimentalCssFileAnalysis } from "../../css-analysis/types.js";
import type { ExternalCssSummary } from "../../external-css/types.js";
import type { ModuleGraph } from "../../module-graph/types.js";
import type { ReachabilitySummary } from "../../reachability/types.js";
import type { ExperimentalRuleResult } from "../types.js";
import { isPlainClassDefinition } from "./cssDefinitionUtils.js";

export function runMissingExternalCssClassRule(input: {
  moduleGraph: ModuleGraph;
  classExpressions: ClassExpressionSummary[];
  cssFiles: ExperimentalCssFileAnalysis[];
  externalCssSummary: ExternalCssSummary;
  reachabilitySummary: ReachabilitySummary;
}): ExperimentalRuleResult[] {
  const classDefinitionsByStylesheetPath = collectClassDefinitionsByStylesheetPath(input.cssFiles);
  const reachableStylesheetPathsBySourceFile = collectReachableStylesheetPathsBySourceFile(
    input.reachabilitySummary,
  );
  const externalImportedStylesheetPathsBySourceFile =
    collectExternalImportedStylesheetPathsBySourceFile(input.moduleGraph);
  const projectWideExternalStylesheetPaths = new Set(
    input.externalCssSummary.projectWideStylesheetFilePaths
      .map(normalizeProjectPath)
      .filter((filePath): filePath is string => Boolean(filePath)),
  );
  const classExpressionsBySourceFilePath = new Map<string, ClassExpressionSummary[]>();

  for (const classExpression of input.classExpressions) {
    const sourceFilePath =
      normalizeProjectPath(classExpression.sourceAnchor.filePath) ??
      classExpression.sourceAnchor.filePath;
    const existingExpressions = classExpressionsBySourceFilePath.get(sourceFilePath) ?? [];
    existingExpressions.push(classExpression);
    classExpressionsBySourceFilePath.set(sourceFilePath, existingExpressions);
  }

  const results: ExperimentalRuleResult[] = [];

  for (const [sourceFilePath, classExpressions] of classExpressionsBySourceFilePath.entries()) {
    const sourceFileExternalStylesheetPaths = new Set([
      ...(externalImportedStylesheetPathsBySourceFile.get(sourceFilePath) ?? []),
      ...projectWideExternalStylesheetPaths,
    ]);
    if (sourceFileExternalStylesheetPaths.size === 0) {
      continue;
    }

    const reachableStylesheetPaths =
      reachableStylesheetPathsBySourceFile.get(sourceFilePath) ?? new Set<string>();

    for (const classExpression of classExpressions) {
      for (const candidateClass of collectCandidateClasses(classExpression)) {
        if (isSatisfiedByActiveProvider(candidateClass.className, input.externalCssSummary)) {
          continue;
        }

        if (
          isClassDefinedInReachableStylesheets(
            candidateClass.className,
            reachableStylesheetPaths,
            classDefinitionsByStylesheetPath,
          )
        ) {
          continue;
        }

        results.push(
          createMissingExternalCssClassResult({
            sourceFilePath,
            classExpression,
            candidateClass,
            reachableStylesheetPaths,
            externalStylesheetPaths: sourceFileExternalStylesheetPaths,
            activeProviders: input.externalCssSummary.activeProviders.map(
              (provider) => provider.provider,
            ),
          }),
        );
      }
    }
  }

  return results;
}

function collectClassDefinitionsByStylesheetPath(
  cssFiles: ExperimentalCssFileAnalysis[],
): Map<string, Set<string>> {
  const classDefinitionsByStylesheetPath = new Map<string, Set<string>>();

  for (const cssFile of cssFiles) {
    const filePath = normalizeProjectPath(cssFile.filePath);
    if (!filePath) {
      continue;
    }

    const classNames = classDefinitionsByStylesheetPath.get(filePath) ?? new Set<string>();
    for (const definition of cssFile.classDefinitions) {
      if (!isPlainClassDefinition(definition)) {
        continue;
      }

      classNames.add(definition.className);
    }
    classDefinitionsByStylesheetPath.set(filePath, classNames);
  }

  return classDefinitionsByStylesheetPath;
}

function collectReachableStylesheetPathsBySourceFile(
  reachabilitySummary: ReachabilitySummary,
): Map<string, Set<string>> {
  const reachableStylesheetPathsBySourceFile = new Map<string, Set<string>>();

  for (const stylesheet of reachabilitySummary.stylesheets) {
    const stylesheetPath = normalizeProjectPath(stylesheet.cssFilePath);
    if (!stylesheetPath) {
      continue;
    }

    for (const contextRecord of stylesheet.contexts) {
      if (contextRecord.context.kind !== "source-file") {
        continue;
      }

      if (contextRecord.availability === "unavailable") {
        continue;
      }

      const sourceFilePath =
        normalizeProjectPath(contextRecord.context.filePath) ?? contextRecord.context.filePath;
      const reachableStylesheetPaths =
        reachableStylesheetPathsBySourceFile.get(sourceFilePath) ?? new Set<string>();
      reachableStylesheetPaths.add(stylesheetPath);
      reachableStylesheetPathsBySourceFile.set(sourceFilePath, reachableStylesheetPaths);
    }
  }

  return reachableStylesheetPathsBySourceFile;
}

function collectExternalImportedStylesheetPathsBySourceFile(
  moduleGraph: ModuleGraph,
): Map<string, Set<string>> {
  const externalImportedStylesheetPathsBySourceFile = new Map<string, Set<string>>();

  for (const moduleNode of moduleGraph.modulesById.values()) {
    if (moduleNode.kind !== "source") {
      continue;
    }

    const sourceFilePath = normalizeProjectPath(moduleNode.filePath) ?? moduleNode.filePath;
    const externalStylesheetPaths =
      externalImportedStylesheetPathsBySourceFile.get(sourceFilePath) ?? new Set<string>();

    for (const importRecord of moduleNode.imports) {
      if (importRecord.importKind !== "external-css") {
        continue;
      }

      externalStylesheetPaths.add(
        normalizeProjectPath(importRecord.specifier) ?? importRecord.specifier,
      );
    }

    if (externalStylesheetPaths.size > 0) {
      externalImportedStylesheetPathsBySourceFile.set(sourceFilePath, externalStylesheetPaths);
    }
  }

  return externalImportedStylesheetPathsBySourceFile;
}

function collectCandidateClasses(classExpression: ClassExpressionSummary): Array<{
  className: string;
  confidence: ExperimentalRuleResult["confidence"];
}> {
  const candidates = new Map<string, ExperimentalRuleResult["confidence"]>();

  for (const className of classExpression.classes.possible) {
    candidates.set(className, "medium");
  }

  for (const className of classExpression.classes.definite) {
    candidates.set(className, "high");
  }

  return [...candidates.entries()]
    .map(([className, confidence]) => ({
      className,
      confidence,
    }))
    .sort((left, right) => left.className.localeCompare(right.className));
}

function isSatisfiedByActiveProvider(
  className: string,
  externalCssSummary: ExternalCssSummary,
): boolean {
  return externalCssSummary.activeProviders.some(
    (provider) =>
      provider.classNames.includes(className) ||
      provider.classPrefixes.some((classPrefix) => className.startsWith(classPrefix)),
  );
}

function isClassDefinedInReachableStylesheets(
  className: string,
  reachableStylesheetPaths: Set<string>,
  classDefinitionsByStylesheetPath: Map<string, Set<string>>,
): boolean {
  for (const stylesheetPath of reachableStylesheetPaths) {
    if (classDefinitionsByStylesheetPath.get(stylesheetPath)?.has(className)) {
      return true;
    }
  }

  return false;
}

function createMissingExternalCssClassResult(input: {
  sourceFilePath: string;
  classExpression: ClassExpressionSummary;
  candidateClass: {
    className: string;
    confidence: ExperimentalRuleResult["confidence"];
  };
  reachableStylesheetPaths: Set<string>;
  externalStylesheetPaths: Set<string>;
  activeProviders: string[];
}): ExperimentalRuleResult {
  const summary = `Class "${input.candidateClass.className}" appears intended to come from imported external CSS, but no matching imported external stylesheet definition was found.`;

  return {
    ruleId: "missing-external-css-class",
    severity: "error",
    confidence: input.candidateClass.confidence,
    summary,
    reasons: [
      "experimental parity rule derived from bounded className abstract-value summaries",
      "source file has external CSS in play, but this class token was not found in any reachable stylesheet definition or active declared provider",
    ],
    traces: [
      {
        traceId: `rule-evaluation:missing-external-css-class:${input.sourceFilePath}:${input.classExpression.sourceAnchor.startLine}:${input.candidateClass.className}`,
        category: "rule-evaluation",
        summary,
        anchor: input.classExpression.sourceAnchor,
        children: [],
        metadata: {
          ruleId: "missing-external-css-class",
          className: input.candidateClass.className,
          sourceText: input.classExpression.sourceText,
        },
      },
    ],
    primaryLocation: {
      filePath: input.classExpression.sourceAnchor.filePath,
      line: input.classExpression.sourceAnchor.startLine,
    },
    metadata: {
      className: input.candidateClass.className,
      sourceFilePath: input.sourceFilePath,
      sourceText: input.classExpression.sourceText,
      reachableStylesheetPaths: [...input.reachableStylesheetPaths].sort((left, right) =>
        left.localeCompare(right),
      ),
      externalStylesheetPaths: [...input.externalStylesheetPaths].sort((left, right) =>
        left.localeCompare(right),
      ),
      activeProviders: [...input.activeProviders].sort((left, right) => left.localeCompare(right)),
    },
  };
}

function normalizeProjectPath(filePath: string | undefined): string | undefined {
  return filePath?.replace(/\\/g, "/");
}
