import { duplicateEvaluatedExpressionIdDiagnostic } from "./diagnostics.js";
import type {
  CanonicalClassExpression,
  ConditionFact,
  EvaluatedExpressionIndexes,
  SymbolicEvaluationDiagnostic,
  UnsupportedReasonCode,
} from "./types.js";

export function buildEvaluatedExpressionIndexes(input: {
  classExpressions: CanonicalClassExpression[];
  conditions: ConditionFact[];
}): {
  indexes: EvaluatedExpressionIndexes;
  diagnostics: SymbolicEvaluationDiagnostic[];
} {
  const diagnostics: SymbolicEvaluationDiagnostic[] = [];
  const classExpressionById = new Map<string, CanonicalClassExpression>();
  const classExpressionIdBySiteNodeId = new Map<string, string>();
  const classExpressionIdsByFilePath = new Map<string, string[]>();
  const classExpressionIdsByComponentNodeId = new Map<string, string[]>();
  const tokenAlternativeIdsByToken = new Map<string, string[]>();
  const cssModuleContributionIdsByStylesheetNodeId = new Map<string, string[]>();
  const cssModuleContributionIdsByExportName = new Map<string, string[]>();
  const externalContributionIdsByClassExpressionId = new Map<string, string[]>();
  const conditionById = new Map<string, ConditionFact>();
  const unsupportedReasonIdsByCode = new Map<UnsupportedReasonCode, string[]>();

  for (const expression of input.classExpressions) {
    if (classExpressionById.has(expression.id)) {
      diagnostics.push(
        duplicateEvaluatedExpressionIdDiagnostic({
          expressionId: expression.id,
          classExpressionSiteNodeId: expression.classExpressionSiteNodeId,
        }),
      );
    }

    classExpressionById.set(expression.id, expression);
    classExpressionIdBySiteNodeId.set(expression.classExpressionSiteNodeId, expression.id);
    pushMapValue(classExpressionIdsByFilePath, expression.filePath, expression.id);

    if (expression.emittingComponentNodeId) {
      pushMapValue(
        classExpressionIdsByComponentNodeId,
        expression.emittingComponentNodeId,
        expression.id,
      );
    }

    for (const token of expression.tokens) {
      pushMapValue(tokenAlternativeIdsByToken, token.token, token.id);
    }

    for (const contribution of expression.cssModuleContributions) {
      if (contribution.stylesheetNodeId) {
        pushMapValue(
          cssModuleContributionIdsByStylesheetNodeId,
          contribution.stylesheetNodeId,
          contribution.id,
        );
      }

      pushMapValue(cssModuleContributionIdsByExportName, contribution.exportName, contribution.id);
    }

    for (const contribution of expression.externalContributions) {
      pushMapValue(externalContributionIdsByClassExpressionId, expression.id, contribution.id);
    }

    for (const reason of expression.unsupported) {
      pushMapValue(unsupportedReasonIdsByCode, reason.code, reason.id);
    }
  }

  for (const condition of input.conditions) {
    conditionById.set(condition.id, condition);
  }

  return {
    indexes: {
      classExpressionById,
      classExpressionIdBySiteNodeId,
      classExpressionIdsByFilePath: sortMapValues(classExpressionIdsByFilePath),
      classExpressionIdsByComponentNodeId: sortMapValues(classExpressionIdsByComponentNodeId),
      tokenAlternativeIdsByToken: sortMapValues(tokenAlternativeIdsByToken),
      cssModuleContributionIdsByStylesheetNodeId: sortMapValues(
        cssModuleContributionIdsByStylesheetNodeId,
      ),
      cssModuleContributionIdsByExportName: sortMapValues(cssModuleContributionIdsByExportName),
      externalContributionIdsByClassExpressionId: sortMapValues(
        externalContributionIdsByClassExpressionId,
      ),
      conditionById,
      unsupportedReasonIdsByCode: sortMapValues(unsupportedReasonIdsByCode),
    },
    diagnostics,
  };
}

function pushMapValue<Key extends string>(map: Map<Key, string[]>, key: Key, value: string): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function sortMapValues<Key extends string>(map: Map<Key, string[]>): Map<Key, string[]> {
  return new Map(
    [...map.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, values]) => [key, [...values].sort((left, right) => left.localeCompare(right))]),
  );
}
