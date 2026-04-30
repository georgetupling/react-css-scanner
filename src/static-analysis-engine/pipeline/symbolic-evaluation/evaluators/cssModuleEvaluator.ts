import {
  cssModuleContributionId,
  canonicalClassExpressionId,
  conditionId,
  tokenAlternativeId,
  unsupportedReasonId,
} from "../ids.js";
import { symbolicEvaluationProvenance } from "../diagnostics.js";
import {
  getCssModuleBindingsForFile,
  resolveCssModuleMember,
  resolveCssModuleMemberAccess,
} from "../../symbol-resolution/index.js";
import type {
  CssModuleClassContribution,
  CanonicalClassExpression,
  SymbolicExpressionEvaluator,
  SymbolicExpressionEvaluatorInput,
  TokenAlternative,
  UnsupportedReason,
  UnsupportedReasonCode,
} from "../types.js";
import type { ExpressionSyntaxNode } from "../../fact-graph/index.js";
import type {
  ResolvedCssModuleBindingDiagnostic,
  ResolvedCssModuleMemberReference,
} from "../../symbol-resolution/index.js";

export const cssModuleClassExpressionEvaluator: SymbolicExpressionEvaluator = {
  name: "css-module-class-expression",
  canEvaluate(input) {
    if (!input.symbolResolution || !input.expressionSyntax) {
      return false;
    }

    return Boolean(
      resolveCssModuleReferenceFromExpressionSyntax({
        input,
        expression: input.expressionSyntax,
      }) ?? findCssModuleDiagnosticForSite(input),
    );
  },
  evaluate(input) {
    if (!input.expressionSyntax || !input.symbolResolution) {
      return {};
    }

    const resolvedReference = resolveCssModuleReferenceFromExpressionSyntax({
      input,
      expression: input.expressionSyntax,
    });
    if (resolvedReference) {
      const expression = buildCssModuleExpression({
        input,
        reference: resolvedReference,
      });
      return {
        expression,
        conditions: buildCssModuleConditions(expression.id),
      };
    }

    const diagnostic = findCssModuleDiagnosticForSite(input);
    if (diagnostic) {
      const expression = buildUnsupportedCssModuleExpression({
        input,
        diagnostic,
      });
      return {
        expression,
        conditions: buildCssModuleConditions(expression.id),
      };
    }

    return {};
  },
};

function resolveCssModuleReferenceFromExpressionSyntax(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: ExpressionSyntaxNode;
}): ResolvedCssModuleMemberReference | undefined {
  const expression = unwrapExpression(input.input, input.expression);

  if (expression.expressionKind === "member-access") {
    const objectExpression = getExpressionSyntax(input.input, expression.objectExpressionId);
    if (objectExpression?.expressionKind !== "identifier") {
      return undefined;
    }

    const result = resolveCssModuleMemberAccess({
      symbolResolution: input.input.symbolResolution!,
      filePath: input.input.classExpressionSite.filePath,
      localName: objectExpression.name,
      memberName: expression.propertyName,
    });
    return result?.kind === "resolved" ? result.reference : undefined;
  }

  if (expression.expressionKind === "element-access" && expression.argumentExpressionId) {
    const objectExpression = getExpressionSyntax(input.input, expression.objectExpressionId);
    const argumentExpression = getExpressionSyntax(input.input, expression.argumentExpressionId);
    if (
      objectExpression?.expressionKind !== "identifier" ||
      argumentExpression?.expressionKind !== "string-literal"
    ) {
      return undefined;
    }

    const result = resolveCssModuleMemberAccess({
      symbolResolution: input.input.symbolResolution!,
      filePath: input.input.classExpressionSite.filePath,
      localName: objectExpression.name,
      memberName: argumentExpression.value,
    });
    return result?.kind === "resolved" ? result.reference : undefined;
  }

  if (expression.expressionKind === "identifier") {
    const binding = resolveCssModuleMember({
      symbolResolution: input.input.symbolResolution!,
      filePath: input.input.classExpressionSite.filePath,
      localName: expression.name,
    });
    if (!binding) {
      return undefined;
    }

    return {
      sourceFilePath: binding.sourceFilePath,
      stylesheetFilePath: binding.stylesheetFilePath,
      specifier: binding.specifier,
      localName: binding.localName,
      originLocalName: binding.originLocalName,
      memberName: binding.memberName,
      accessKind: "destructured-binding",
      location: binding.location,
      rawExpressionText: binding.rawExpressionText,
      traces: binding.traces,
    };
  }

  return undefined;
}

function buildCssModuleExpression(input: {
  input: SymbolicExpressionEvaluatorInput;
  reference: ResolvedCssModuleMemberReference;
}): CanonicalClassExpression {
  const expressionId = canonicalClassExpressionId(input.input.classExpressionSite.id);
  const alwaysConditionId = conditionId({ expressionId, conditionKey: "always" });
  const contributionId = cssModuleContributionId({
    expressionId,
    exportName: input.reference.memberName,
    index: 0,
  });
  const contribution: CssModuleClassContribution = {
    id: contributionId,
    ...(input.input.graph.indexes.stylesheetNodeIdByFilePath.get(input.reference.stylesheetFilePath)
      ? {
          stylesheetNodeId: input.input.graph.indexes.stylesheetNodeIdByFilePath.get(
            input.reference.stylesheetFilePath,
          ),
        }
      : {}),
    stylesheetFilePath: input.reference.stylesheetFilePath,
    localName: input.reference.localName,
    originLocalName: input.reference.originLocalName,
    exportName: input.reference.memberName,
    accessKind: input.reference.accessKind,
    conditionId: alwaysConditionId,
    sourceAnchor: input.reference.location,
    confidence: "high",
    traces: input.input.options.includeTraces === false ? [] : input.reference.traces,
  };
  const token: TokenAlternative = {
    id: tokenAlternativeId({
      expressionId,
      token: input.reference.memberName,
      index: 0,
    }),
    token: input.reference.memberName,
    tokenKind: "css-module-export",
    presence: "always",
    conditionId: alwaysConditionId,
    sourceAnchor: input.reference.location,
    confidence: "high",
    contributionId,
  };

  return {
    id: expressionId,
    classExpressionSiteNodeId: input.input.classExpressionSite.id,
    classExpressionSiteKind: input.input.classExpressionSite.classExpressionSiteKind,
    expressionNodeId: input.input.classExpressionSite.expressionNodeId,
    sourceExpressionKind: input.input.expressionSyntax?.expressionKind,
    filePath: input.input.classExpressionSite.filePath,
    location: input.input.classExpressionSite.location,
    rawExpressionText: input.input.classExpressionSite.rawExpressionText,
    expressionKind: "css-module-class",
    certainty: { kind: "exact", summary: "one complete token set" },
    confidence: "high",
    tokens: [token],
    emissionVariants: [],
    externalContributions: [],
    cssModuleContributions: [contribution],
    unsupported: [],
    tokenAnchors: {},
    ...(input.input.classExpressionSite.emittingComponentNodeId
      ? { emittingComponentNodeId: input.input.classExpressionSite.emittingComponentNodeId }
      : {}),
    ...(input.input.classExpressionSite.placementComponentNodeId
      ? { placementComponentNodeId: input.input.classExpressionSite.placementComponentNodeId }
      : {}),
    ...(input.input.classExpressionSite.renderSiteNodeId
      ? { renderSiteNodeId: input.input.classExpressionSite.renderSiteNodeId }
      : {}),
    ...(input.input.classExpressionSite.elementTemplateNodeId
      ? { elementTemplateNodeId: input.input.classExpressionSite.elementTemplateNodeId }
      : {}),
    provenance: symbolicEvaluationProvenance({
      summary: "Evaluated CSS Module class expression",
      filePath: input.input.classExpressionSite.filePath,
      anchor: input.input.classExpressionSite.location,
      upstreamId: input.input.classExpressionSite.id,
    }),
    traces: input.input.options.includeTraces === false ? [] : input.reference.traces,
  };
}

function buildUnsupportedCssModuleExpression(input: {
  input: SymbolicExpressionEvaluatorInput;
  diagnostic: ResolvedCssModuleBindingDiagnostic;
}): CanonicalClassExpression {
  const expressionId = canonicalClassExpressionId(input.input.classExpressionSite.id);
  const code = toCssModuleUnsupportedReasonCode(input.diagnostic.reason);
  const reason: UnsupportedReason = {
    id: unsupportedReasonId({ expressionId, code, index: 0 }),
    kind: "unsupported-css-module-access",
    code,
    message: input.diagnostic.reason,
    sourceAnchor: input.diagnostic.location,
    recoverability: "none",
    confidence: "high",
  };

  return {
    id: expressionId,
    classExpressionSiteNodeId: input.input.classExpressionSite.id,
    classExpressionSiteKind: input.input.classExpressionSite.classExpressionSiteKind,
    expressionNodeId: input.input.classExpressionSite.expressionNodeId,
    sourceExpressionKind: input.input.expressionSyntax?.expressionKind,
    filePath: input.input.classExpressionSite.filePath,
    location: input.input.classExpressionSite.location,
    rawExpressionText: input.input.classExpressionSite.rawExpressionText,
    expressionKind: "unknown",
    certainty: { kind: "unknown", summary: "no reliable token information" },
    confidence: "low",
    tokens: [],
    emissionVariants: [],
    externalContributions: [],
    cssModuleContributions: [],
    unsupported: [reason],
    tokenAnchors: {},
    provenance: symbolicEvaluationProvenance({
      summary: "Preserved unsupported CSS Module class expression",
      filePath: input.input.classExpressionSite.filePath,
      anchor: input.input.classExpressionSite.location,
      upstreamId: input.input.classExpressionSite.id,
    }),
    traces: input.input.options.includeTraces === false ? [] : input.diagnostic.traces,
  };
}

function findCssModuleDiagnosticForSite(
  input: SymbolicExpressionEvaluatorInput,
): ResolvedCssModuleBindingDiagnostic | undefined {
  if (!input.symbolResolution) {
    return undefined;
  }

  return getCssModuleBindingsForFile({
    symbolResolution: input.symbolResolution,
    filePath: input.classExpressionSite.filePath,
  }).diagnostics.find(
    (diagnostic) =>
      diagnostic.rawExpressionText === input.classExpressionSite.rawExpressionText ||
      anchorsOverlap(diagnostic.location, input.classExpressionSite.location),
  );
}

function buildCssModuleConditions(expressionId: string) {
  return [
    {
      id: conditionId({ expressionId, conditionKey: "always" }),
      kind: "always" as const,
      confidence: "high" as const,
    },
  ];
}

function toCssModuleUnsupportedReasonCode(reason: string): UnsupportedReasonCode {
  if (
    reason === "computed-css-module-member" ||
    reason === "computed-css-module-destructuring" ||
    reason === "nested-css-module-destructuring" ||
    reason === "rest-css-module-destructuring"
  ) {
    return reason;
  }

  return "computed-css-module-member";
}

function anchorsOverlap(
  left: SymbolicExpressionEvaluatorInput["classExpressionSite"]["location"],
  right: SymbolicExpressionEvaluatorInput["classExpressionSite"]["location"],
): boolean {
  return (
    left.filePath === right.filePath &&
    left.startLine === right.startLine &&
    left.startColumn <= (right.endColumn ?? right.startColumn) &&
    right.startColumn <= (left.endColumn ?? left.startColumn)
  );
}

function unwrapExpression(
  input: SymbolicExpressionEvaluatorInput,
  expression: ExpressionSyntaxNode,
): ExpressionSyntaxNode {
  while (expression.expressionKind === "wrapper") {
    const inner = getExpressionSyntax(input, expression.innerExpressionId);
    if (!inner) {
      return expression;
    }

    expression = inner;
  }

  return expression;
}

function getExpressionSyntax(
  input: SymbolicExpressionEvaluatorInput,
  expressionId: string,
): ExpressionSyntaxNode | undefined {
  const nodeId = input.graph.indexes.expressionSyntaxNodeIdByExpressionId.get(expressionId);
  const indexedNode = nodeId ? input.graph.indexes.nodesById.get(nodeId) : undefined;
  if (indexedNode?.kind === "expression-syntax") {
    return indexedNode;
  }

  return input.graph.nodes.expressionSyntax.find((node) => node.expressionId === expressionId);
}
