import { toAbstractClassSet, uniqueSorted } from "../class-values/classValueOperations.js";
import type { AbstractValue, ClassExpressionSummary } from "../class-values/types.js";
import type { CanonicalClassExpression } from "../types.js";

export function toClassExpressionSummary(
  expression: CanonicalClassExpression,
): ClassExpressionSummary {
  const definite = uniqueSorted(
    expression.tokens
      .filter((token) => token.tokenKind === "global-class" && token.presence === "always")
      .map((token) => token.token),
  );
  const possible = uniqueSorted(
    expression.tokens
      .filter((token) => token.tokenKind === "global-class" && token.presence !== "always")
      .map((token) => token.token)
      .filter((token) => !definite.includes(token)),
  );
  const hasUnknownDynamic =
    expression.externalContributions.length > 0 ||
    expression.unsupported.length > 0 ||
    expression.certainty.kind === "partial" ||
    expression.certainty.kind === "unknown";
  const value = toCompatibilityValue({
    definite,
    possible,
    unknownDynamic: hasUnknownDynamic,
    reason: getCompatibilityReason(expression),
  });

  return {
    sourceAnchor: expression.location,
    value,
    classes: toAbstractClassSet(value, expression.location),
    classNameSourceAnchors: toClassNameSourceAnchors(expression),
    sourceText: expression.rawExpressionText,
    traces: expression.traces,
  };
}

function toCompatibilityValue(input: {
  definite: string[];
  possible: string[];
  unknownDynamic: boolean;
  reason?: string;
}): AbstractValue {
  if (
    input.definite.length === 0 &&
    input.possible.length === 0 &&
    input.unknownDynamic &&
    input.reason
  ) {
    return {
      kind: "unknown",
      reason: input.reason,
    };
  }

  return {
    kind: "class-set",
    definite: input.definite,
    possible: input.possible,
    unknownDynamic: input.unknownDynamic,
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

function getCompatibilityReason(expression: CanonicalClassExpression): string | undefined {
  if (expression.unsupported.length > 0) {
    return expression.unsupported.map((reason) => reason.code).join(",");
  }

  if (expression.externalContributions.length > 0) {
    return "external-class-contribution";
  }

  if (expression.cssModuleContributions.length > 0) {
    return "css-module-class-contribution";
  }

  if (expression.certainty.kind === "unknown") {
    return "unknown-symbolic-expression";
  }

  return undefined;
}

function toClassNameSourceAnchors(
  expression: CanonicalClassExpression,
): Record<string, CanonicalClassExpression["location"]> | undefined {
  const anchors: Record<string, CanonicalClassExpression["location"]> = {};

  for (const [className, sourceAnchors] of Object.entries(expression.tokenAnchors)) {
    const firstAnchor = sourceAnchors[0];
    if (firstAnchor) {
      anchors[className] = firstAnchor;
    }
  }

  for (const token of expression.tokens) {
    if (token.tokenKind !== "global-class" || anchors[token.token]) {
      continue;
    }

    if (token.sourceAnchor) {
      anchors[token.token] = token.sourceAnchor;
    }
  }

  return Object.keys(anchors).length > 0 ? anchors : undefined;
}
