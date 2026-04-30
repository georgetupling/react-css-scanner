import {
  classEmissionVariantId,
  conditionId,
  tokenAlternativeId,
  unsupportedReasonId,
} from "../ids.js";
import { canonicalClassExpressionId } from "../ids.js";
import {
  rawExpressionTextMismatchDiagnostic,
  symbolicEvaluationProvenance,
} from "../diagnostics.js";
import {
  buildClassExpressionTraces,
  summarizeClassNameExpression,
} from "../class-values/classExpressions.js";
import { toAbstractClassSet, tokenizeClassNames } from "../class-values/classValueOperations.js";
import type { AbstractValue } from "../class-values/types.js";
import type {
  CanonicalClassExpression,
  CanonicalExpressionKind,
  Certainty,
  ClassEmissionVariant,
  ConditionFact,
  SymbolicEvaluationDiagnostic,
  SymbolicExpressionEvaluator,
  SymbolicExpressionEvaluatorInput,
  TokenAlternative,
  UnsupportedReason,
  UnsupportedReasonCode,
} from "../types.js";

export const legacyAstClassExpressionEvaluator: SymbolicExpressionEvaluator = {
  name: "legacy-ast-class-expression",
  canEvaluate: (input) =>
    Boolean(input.legacyExpressionStore?.getExpressionForSite(input.classExpressionSite)),
  evaluate(input) {
    const match = input.legacyExpressionStore?.getExpressionForSite(input.classExpressionSite);
    if (!match) {
      return {};
    }

    const value = summarizeClassNameExpression(match.expression);
    const expression = buildCanonicalClassExpressionFromValue({
      input,
      value,
      rawExpressionText: match.rawExpressionText,
      provenanceSummary: "Evaluated class expression with legacy AST adapter",
    });
    const diagnostics: SymbolicEvaluationDiagnostic[] = [];

    if (match.rawExpressionText !== input.classExpressionSite.rawExpressionText) {
      diagnostics.push(
        rawExpressionTextMismatchDiagnostic({
          site: input.classExpressionSite,
          graphRawExpressionText: input.classExpressionSite.rawExpressionText,
          astRawExpressionText: match.rawExpressionText,
        }),
      );
    }

    return {
      expression,
      conditions: buildConditions(expression.id),
      diagnostics,
    };
  },
};

export function buildCanonicalClassExpressionFromValue(input: {
  input: SymbolicExpressionEvaluatorInput;
  value: AbstractValue;
  rawExpressionText: string;
  provenanceSummary: string;
  tokenAnchors?: CanonicalClassExpression["tokenAnchors"];
  traces?: CanonicalClassExpression["traces"];
}): CanonicalClassExpression {
  const expressionId = canonicalClassExpressionId(input.input.classExpressionSite.id);
  const abstractClassSet = toAbstractClassSet(
    input.value,
    input.input.classExpressionSite.location,
  );
  const alwaysConditionId = conditionId({
    expressionId,
    conditionKey: "always",
  });
  const possibleConditionId = conditionId({
    expressionId,
    conditionKey: "possible",
  });
  const tokenAnchors = input.tokenAnchors ?? {};
  const tokens = [
    ...abstractClassSet.definite.map((token, index) =>
      buildTokenAlternative({
        expressionId,
        token,
        index,
        presence: "always",
        conditionId: alwaysConditionId,
        confidence: input.value.kind === "unknown" ? "low" : "high",
        sourceAnchor: tokenAnchors[token]?.[0] ?? input.input.classExpressionSite.location,
      }),
    ),
    ...abstractClassSet.possible.map((token, index) =>
      buildTokenAlternative({
        expressionId,
        token,
        index: index + abstractClassSet.definite.length,
        presence: "possible",
        conditionId: possibleConditionId,
        confidence: "medium",
        sourceAnchor: tokenAnchors[token]?.[0] ?? input.input.classExpressionSite.location,
      }),
    ),
  ];

  return {
    id: expressionId,
    classExpressionSiteNodeId: input.input.classExpressionSite.id,
    classExpressionSiteKind: input.input.classExpressionSite.classExpressionSiteKind,
    expressionNodeId: input.input.classExpressionSite.expressionNodeId,
    sourceExpressionKind: input.input.expressionSyntax.expressionKind,
    filePath: input.input.classExpressionSite.filePath,
    location: input.input.classExpressionSite.location,
    rawExpressionText: input.input.classExpressionSite.rawExpressionText,
    expressionKind: getCanonicalExpressionKind(input.value),
    certainty: getCertainty(input.value),
    confidence: getConfidence(input.value, abstractClassSet.unknownDynamic),
    tokens,
    emissionVariants: buildEmissionVariants({
      expressionId,
      value: input.value,
      alwaysConditionId,
    }),
    externalContributions: [],
    cssModuleContributions: [],
    unsupported: buildUnsupportedReasons({
      expressionId,
      value: input.value,
      sourceAnchor: input.input.classExpressionSite.location,
    }),
    tokenAnchors: Object.fromEntries(
      tokens.map((token) => [
        token.token,
        tokenAnchors[token.token] ?? [input.input.classExpressionSite.location],
      ]),
    ),
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
      summary: input.provenanceSummary,
      filePath: input.input.classExpressionSite.filePath,
      anchor: input.input.classExpressionSite.location,
      upstreamId: input.input.classExpressionSite.id,
    }),
    traces:
      input.traces ??
      buildClassExpressionTraces({
        sourceAnchor: input.input.classExpressionSite.location,
        sourceText: input.rawExpressionText,
        value: input.value,
        includeTraces: input.input.options.includeTraces,
      }),
  };
}

function buildTokenAlternative(input: {
  expressionId: string;
  token: string;
  index: number;
  presence: TokenAlternative["presence"];
  conditionId: string;
  confidence: TokenAlternative["confidence"];
  sourceAnchor: TokenAlternative["sourceAnchor"];
}): TokenAlternative {
  return {
    id: tokenAlternativeId({
      expressionId: input.expressionId,
      token: input.token,
      index: input.index,
    }),
    token: input.token,
    tokenKind: "global-class",
    presence: input.presence,
    conditionId: input.conditionId,
    ...(input.sourceAnchor ? { sourceAnchor: input.sourceAnchor } : {}),
    confidence: input.confidence,
  };
}

export function buildConditions(expressionId: string): ConditionFact[] {
  return [
    {
      id: conditionId({
        expressionId,
        conditionKey: "always",
      }),
      kind: "always",
      confidence: "high",
    },
    {
      id: conditionId({
        expressionId,
        conditionKey: "possible",
      }),
      kind: "unknown",
      confidence: "medium",
    },
  ];
}

function buildEmissionVariants(input: {
  expressionId: string;
  value: AbstractValue;
  alwaysConditionId: string;
}): ClassEmissionVariant[] {
  if (input.value.kind === "string-exact") {
    return [
      {
        id: classEmissionVariantId({
          expressionId: input.expressionId,
          index: 0,
        }),
        conditionId: input.alwaysConditionId,
        tokens: tokenizeClassNames(input.value.value),
        completeness: "complete",
        unknownDynamic: false,
      },
    ];
  }

  if (input.value.kind === "string-set") {
    return input.value.values.map((value, index) => ({
      id: classEmissionVariantId({
        expressionId: input.expressionId,
        index,
      }),
      conditionId: input.alwaysConditionId,
      tokens: tokenizeClassNames(value),
      completeness: "complete",
      unknownDynamic: false,
    }));
  }

  return [];
}

function getCanonicalExpressionKind(value: AbstractValue): CanonicalExpressionKind {
  if (value.kind === "string-exact") {
    return "exact-string";
  }

  if (value.kind === "string-set") {
    return "bounded-string-set";
  }

  if (value.kind === "class-set") {
    return value.unknownDynamic ? "partial" : "class-token-set";
  }

  return "unknown";
}

function getCertainty(value: AbstractValue): Certainty {
  if (value.kind === "string-exact") {
    return {
      kind: "exact",
      summary: "one complete token set",
    };
  }

  if (value.kind === "string-set") {
    return {
      kind: "bounded",
      summary: "finite complete alternatives",
      alternativeCount: value.values.length,
    };
  }

  if (value.kind === "class-set") {
    return value.unknownDynamic
      ? {
          kind: "partial",
          summary: "some known tokens plus unknown or external input",
        }
      : {
          kind: "bounded",
          summary: "finite complete alternatives",
          alternativeCount: 1,
        };
  }

  return {
    kind: "unknown",
    summary: "no reliable token information",
  };
}

function getConfidence(value: AbstractValue, unknownDynamic: boolean): "high" | "medium" | "low" {
  if (value.kind === "unknown") {
    return "low";
  }

  if (unknownDynamic) {
    return "medium";
  }

  return "high";
}

function buildUnsupportedReasons(input: {
  expressionId: string;
  value: AbstractValue;
  sourceAnchor: TokenAlternative["sourceAnchor"];
}): UnsupportedReason[] {
  if (input.value.kind !== "unknown" && input.value.kind !== "class-set") {
    return [];
  }

  const reason = input.value.kind === "unknown" ? input.value.reason : input.value.reason;
  if (!reason || (input.value.kind === "class-set" && !input.value.unknownDynamic)) {
    return [];
  }

  const code = toUnsupportedReasonCode(reason);

  return [
    {
      id: unsupportedReasonId({
        expressionId: input.expressionId,
        code,
        index: 0,
      }),
      kind: code.includes("budget") ? "budget-exceeded" : "unsupported-syntax",
      code,
      message: reason,
      ...(input.sourceAnchor ? { sourceAnchor: input.sourceAnchor } : {}),
      recoverability: input.value.kind === "class-set" ? "partial" : "none",
      confidence: "low",
    },
  ];
}

function toUnsupportedReasonCode(reason: string): UnsupportedReasonCode {
  if (reason.includes("template-interpolation-budget-exceeded")) {
    return "template-interpolation-budget-exceeded";
  }

  if (reason.includes("string-concatenation-budget-exceeded")) {
    return "string-concatenation-budget-exceeded";
  }

  if (reason.includes("unsupported-template-interpolation")) {
    return "unsupported-template-interpolation";
  }

  if (reason.includes("unsupported-string-concatenation")) {
    return "unsupported-string-concatenation";
  }

  if (reason.startsWith("unsupported-call")) {
    return "unsupported-call";
  }

  return "unsupported-expression-kind";
}
