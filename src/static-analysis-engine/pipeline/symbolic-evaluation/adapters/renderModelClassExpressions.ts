import ts from "typescript";

import type { SourceAnchor } from "../../../types/core.js";
import type { BuildContext } from "../../render-model/render-ir/shared/internalTypes.js";
import type { ClassExpressionSummary } from "../class-values/types.js";
import { buildClassExpressionTraces } from "../class-values/classExpressionTraces.js";
import { mergeClassNameValues, toAbstractClassSet } from "../class-values/classValueOperations.js";
import { summarizeClassNameExpressionInLegacyRenderModel } from "./legacyRenderModelAdapter.js";

export type RenderModelClassExpressionSummaryRecord = {
  location: SourceAnchor;
  rawExpressionText: string;
  summary: ClassExpressionSummary;
};

export function summarizeClassNameExpressionForRenderModel(input: {
  expression: ts.Expression;
  context: BuildContext;
}): ClassExpressionSummary {
  const sourceFile = input.expression.getSourceFile() ?? input.context.parsedSourceFile;
  const sourceAnchor = toSourceAnchor(input.expression, sourceFile, sourceFile.fileName);
  const cachedSummary = input.context.classExpressionSummariesByAnchor?.get(
    createClassExpressionSummaryAnchorKey(sourceAnchor),
  );
  if (cachedSummary) {
    return cachedSummary;
  }

  return summarizeClassNameExpressionInLegacyRenderModel(input);
}

export function mergeClassExpressionSummariesForRenderModel(input: {
  original: ClassExpressionSummary;
  override: ClassExpressionSummary;
  reason: string;
  includeTraces: boolean;
}): ClassExpressionSummary {
  const value = mergeClassNameValues([input.original.value, input.override.value], input.reason);
  const classNameSourceAnchors = mergeClassNameSourceAnchors([
    input.original.classNameSourceAnchors,
    input.override.classNameSourceAnchors,
  ]);

  return {
    sourceAnchor: input.override.sourceAnchor,
    value,
    classes: toAbstractClassSet(value, input.override.sourceAnchor),
    classNameSourceAnchors,
    sourceText: input.override.sourceText,
    traces: buildClassExpressionTraces({
      sourceAnchor: input.override.sourceAnchor,
      sourceText: input.override.sourceText,
      value,
      includeTraces: input.includeTraces,
    }),
  };
}

export function createClassExpressionSummaryAnchorKey(anchor: SourceAnchor): string {
  return [
    normalizeProjectPath(anchor.filePath),
    anchor.startLine,
    anchor.startColumn,
    anchor.endLine ?? "",
    anchor.endColumn ?? "",
  ].join(":");
}

function mergeClassNameSourceAnchors(
  entries: Array<Record<string, SourceAnchor> | undefined>,
): Record<string, SourceAnchor> | undefined {
  const merged: Record<string, SourceAnchor> = {};
  for (const entry of entries) {
    if (!entry) {
      continue;
    }

    for (const [className, sourceAnchor] of Object.entries(entry)) {
      merged[className] ??= sourceAnchor;
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function toSourceAnchor(node: ts.Node, sourceFile: ts.SourceFile, filePath: string): SourceAnchor {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    filePath,
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}

function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}
