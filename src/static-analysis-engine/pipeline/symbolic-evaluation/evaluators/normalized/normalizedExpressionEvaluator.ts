import {
  collectStringCandidates,
  combineStrings,
  getStringCandidates,
  mergeClassSets,
  toClassSet,
  toStringValue,
  tokenizeClassNames,
  uniqueSorted,
} from "../../values/classValueOperations.js";
import type { AbstractValue } from "../../values/types.js";
import {
  buildCanonicalClassExpressionFromValue,
  buildConditions,
} from "../../canonical/canonicalClassExpressionBuilder.js";
import { getExpressionSyntax } from "./expressionSyntaxLookup.js";
import type { ExpressionSyntaxNode } from "../../../fact-graph/index.js";
import { evaluateStaticTruthiness } from "../../../static-truthiness.js";
import {
  buildPartialTemplateClassSet,
  collectKnownClassNames,
  collectSafeStaticTemplateClassTokens,
  expandTemplateAgainstKnownClasses,
  shouldExpandTemplateAgainstKnownClasses,
} from "./expressions/templateEvaluation.js";
import { tokenAlternativeId } from "../../model/ids.js";
import type {
  SymbolicExpressionEvaluator,
  SymbolicExpressionEvaluatorInput,
} from "../../model/types.js";
import {
  buildCssModuleContributionFromDestructuredIdentifier,
  buildExternalContributions,
} from "./contributions/classContributions.js";
import {
  resolveObjectLiteralExpressionSyntax,
  summarizeElementAccessExpressionSyntax,
  summarizeMemberAccessExpressionSyntax,
  summarizeObjectExpressionSyntax,
} from "./expressions/objectAndMemberEvaluation.js";
import { summarizeArrayExpressionSyntax } from "./expressions/arrayEvaluation.js";
import {
  jsonStaticValueToAbstractValue,
  resolveJsonStaticValueForExpression,
} from "./bindings/jsonStaticValues.js";
import {
  buildImportedIdentifierTokenAnchors,
  resolveImportedIdentifierExpressionSyntax,
  summarizeIdentifierExpressionSyntax,
  summarizeImportedIdentifierExpressionSyntax,
} from "./bindings/identifierResolution.js";
import {
  summarizeCallExpressionSyntax,
  summarizeClassNamesHelperArg,
} from "./expressions/callEvaluation.js";

const MAX_STRING_COMBINATIONS = 32;

const objectMemberEvaluationCallbacks = {
  evaluateExpression: summarizeNormalizedClassExpression,
  getExpressionValue,
  jsonStaticValueToAbstractValue,
  resolveImportedIdentifierExpressionSyntax,
  resolveJsonStaticValueForExpression: resolveJsonStaticValueForExpressionWithCallbacks,
};

const arrayEvaluationCallbacks = {
  objectMemberCallbacks: objectMemberEvaluationCallbacks,
  resolveImportedIdentifierExpressionSyntax,
  summarizeClassNamesHelperArg: summarizeClassNamesHelperArgWithCallbacks,
};

const jsonStaticValueCallbacks = {
  getExpressionValue,
};

const identifierResolutionCallbacks = {
  getExpressionValue,
  summarizeExpression: summarizeNormalizedClassExpression,
};

const callEvaluationCallbacks = {
  arrayCallbacks: arrayEvaluationCallbacks,
  getExpressionValue,
  summarizeExpression: summarizeNormalizedClassExpression,
  summarizeIdentifier: summarizeIdentifierExpressionSyntaxWithCallbacks,
};

function resolveJsonStaticValueForExpressionWithCallbacks(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: ExpressionSyntaxNode;
  seenExpressionIds: Set<string>;
}) {
  return resolveJsonStaticValueForExpression({
    ...input,
    callbacks: jsonStaticValueCallbacks,
  });
}

function summarizeIdentifierExpressionSyntaxWithCallbacks(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "identifier" }>;
  depth: number;
  seenExpressionIds: Set<string>;
  helperBindings?: Map<string, AbstractValue>;
}) {
  return summarizeIdentifierExpressionSyntax({
    ...input,
    callbacks: identifierResolutionCallbacks,
  });
}

function summarizeClassNamesHelperArgWithCallbacks(
  input: {
    input: SymbolicExpressionEvaluatorInput;
    depth: number;
    seenExpressionIds: Set<string>;
    helperBindings?: Map<string, AbstractValue>;
  },
  expressionId: string,
) {
  return summarizeClassNamesHelperArg(
    { ...input, callbacks: callEvaluationCallbacks },
    expressionId,
  );
}

export const normalizedClassExpressionEvaluator: SymbolicExpressionEvaluator = {
  name: "normalized-expression-class-expression",
  canEvaluate: (input) => Boolean(input.expressionSyntax),
  evaluate(input) {
    if (!input.expressionSyntax) {
      return {};
    }

    const value = input.classExpressionSite.valueProjection
      ? summarizeProjectedClassExpression({
          input,
          expression: input.expressionSyntax,
          depth: 0,
          seenExpressionIds: new Set(),
        })
      : summarizeNormalizedClassExpression({
          input,
          expression: input.expressionSyntax,
          depth: 0,
          seenExpressionIds: new Set(),
        });
    const tokenAnchors = buildImportedIdentifierTokenAnchors({
      input,
      syntax: input.expressionSyntax,
      callbacks: identifierResolutionCallbacks,
    });
    const expression = buildCanonicalClassExpressionFromValue({
      input,
      value,
      rawExpressionText: input.expressionSyntax.rawText,
      provenanceSummary: "Evaluated class expression from normalized graph expression syntax",
      ...(tokenAnchors ? { tokenAnchors } : {}),
    });
    expression.externalContributions = buildExternalContributions({
      input,
      expression,
      syntax: input.expressionSyntax,
    });
    const cssModuleContribution = buildCssModuleContributionFromDestructuredIdentifier({
      input,
      expressionId: expression.id,
      syntax: input.expressionSyntax,
    });
    if (cssModuleContribution) {
      expression.expressionKind = "css-module-class";
      expression.certainty = {
        kind: "exact",
        summary: "one complete token set",
      };
      expression.confidence = "high";
      expression.tokens = [
        {
          id: tokenAlternativeId({
            expressionId: expression.id,
            token: cssModuleContribution.exportName,
            index: 0,
          }),
          token: cssModuleContribution.exportName,
          tokenKind: "css-module-export",
          presence: "always",
          conditionId: cssModuleContribution.conditionId,
          sourceAnchor: cssModuleContribution.sourceAnchor,
          confidence: "high",
          contributionId: cssModuleContribution.id,
        },
      ];
      expression.emissionVariants = [];
      expression.externalContributions = [];
      expression.cssModuleContributions = [cssModuleContribution];
      expression.unsupported = [];
      expression.tokenAnchors = {
        [cssModuleContribution.exportName]: [cssModuleContribution.sourceAnchor],
      };
    }

    return {
      expression,
      conditions: buildConditions(expression.id, value),
    };
  },
};

function summarizeProjectedClassExpression(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: ExpressionSyntaxNode;
  depth: number;
  seenExpressionIds: Set<string>;
}): AbstractValue {
  const projection = input.input.classExpressionSite.valueProjection;
  if (!projection || projection.kind !== "object-property") {
    return summarizeNormalizedClassExpression(input);
  }

  const expression = unwrapExpressionSyntax(input);
  if (expression.expressionKind === "conditional") {
    const conditionExpression = getExpressionSyntax(input.input, expression.conditionExpressionId);
    const conditionTruthiness = conditionExpression
      ? evaluateExpressionStaticTruthiness({
          ...input,
          expression: conditionExpression,
        })
      : undefined;
    if (conditionTruthiness === true) {
      const whenTrueExpression = getExpressionSyntax(input.input, expression.whenTrueExpressionId);
      return whenTrueExpression
        ? summarizeProjectedClassExpression({
            ...input,
            expression: whenTrueExpression,
            depth: input.depth + 1,
          })
        : { kind: "unknown", reason: "missing-expression-syntax" };
    }
    if (conditionTruthiness === false || conditionTruthiness === "nullish") {
      const whenFalseExpression = getExpressionSyntax(
        input.input,
        expression.whenFalseExpressionId,
      );
      return whenFalseExpression
        ? summarizeProjectedClassExpression({
            ...input,
            expression: whenFalseExpression,
            depth: input.depth + 1,
          })
        : { kind: "unknown", reason: "missing-expression-syntax" };
    }

    const whenTrueExpression = getExpressionSyntax(input.input, expression.whenTrueExpressionId);
    const whenFalseExpression = getExpressionSyntax(input.input, expression.whenFalseExpressionId);
    if (!whenTrueExpression || !whenFalseExpression) {
      return { kind: "unknown", reason: "missing-expression-syntax" };
    }

    const whenTrue = summarizeProjectedClassExpression({
      ...input,
      expression: whenTrueExpression,
      depth: input.depth + 1,
    });
    const whenFalse = summarizeProjectedClassExpression({
      ...input,
      expression: whenFalseExpression,
      depth: input.depth + 1,
    });
    const stringCandidates = collectStringCandidates(whenTrue, whenFalse);
    if (stringCandidates) {
      return {
        kind: "string-set",
        values: stringCandidates,
        mutuallyExclusiveGroups: [
          uniqueSorted(stringCandidates.flatMap((candidate) => tokenizeClassNames(candidate))),
        ],
      };
    }

    return mergeClassSets([whenTrue, whenFalse], "conditional object property projection");
  }

  const objectLiteral = resolveObjectLiteralExpressionSyntax({
    ...input,
    expression,
    callbacks: objectMemberEvaluationCallbacks,
  });
  if (!objectLiteral) {
    return { kind: "unknown", reason: "unresolved-member-access" };
  }

  const projectedPropertyNames = new Set(projection.propertyNames);
  let unresolvedEntriesCanAffectResult = false;
  let selectedExpressionId: string | undefined;

  for (const property of objectLiteral.properties) {
    if (property.propertyKind === "spread" || property.propertyKind === "unsupported") {
      unresolvedEntriesCanAffectResult = true;
      continue;
    }

    if (property.propertyKind !== "property" && property.propertyKind !== "shorthand") {
      unresolvedEntriesCanAffectResult = true;
      continue;
    }

    const keyText = resolveProjectedObjectPropertyKey({
      ...input,
      property,
    });
    if (!keyText) {
      unresolvedEntriesCanAffectResult = true;
      continue;
    }

    if (projectedPropertyNames.has(keyText)) {
      selectedExpressionId = property.valueExpressionId;
      unresolvedEntriesCanAffectResult = false;
    }
  }

  if (!selectedExpressionId) {
    return unresolvedEntriesCanAffectResult && projection.unresolvedObjectEntriesAffectPresence
      ? {
          kind: "class-set",
          definite: [],
          possible: [],
          unknownDynamic: true,
          reason: "object property projection with unresolved entries",
        }
      : { kind: "string-exact", value: "" };
  }

  const projectedExpression = getExpressionSyntax(input.input, selectedExpressionId);
  if (!projectedExpression) {
    return { kind: "unknown", reason: "missing-expression-syntax" };
  }

  const projectedValue = summarizeNormalizedClassExpression({
    input: input.input,
    expression: projectedExpression,
    depth: input.depth + 1,
    seenExpressionIds: input.seenExpressionIds,
  });

  if (!unresolvedEntriesCanAffectResult) {
    return projectedValue;
  }

  const classSet = toClassSet(projectedValue);
  return {
    kind: "class-set",
    definite: [],
    possible: uniqueSorted([...classSet.definite, ...classSet.possible]),
    mutuallyExclusiveGroups: classSet.mutuallyExclusiveGroups,
    unknownDynamic: true,
    reason: "object property projection with unresolved entries",
  };
}

function resolveProjectedObjectPropertyKey(input: {
  input: SymbolicExpressionEvaluatorInput;
  property: Extract<
    ExpressionSyntaxNode,
    { expressionKind: "object-literal" }
  >["properties"][number];
  depth: number;
  seenExpressionIds: Set<string>;
  helperBindings?: Map<string, AbstractValue>;
}): string | undefined {
  if (input.property.keyKind === "computed") {
    if (!input.property.keyExpressionId) {
      return undefined;
    }
    const keyValue = getExpressionValue(input, input.property.keyExpressionId);
    const keyCandidates = getStringCandidates(keyValue);
    return keyCandidates?.length === 1 ? keyCandidates[0] : undefined;
  }

  return input.property.keyText;
}

function summarizeNormalizedClassExpression(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: ExpressionSyntaxNode;
  depth: number;
  seenExpressionIds: Set<string>;
  helperBindings?: Map<string, AbstractValue>;
  allowObjectClassMap?: boolean;
}): AbstractValue {
  const maxDepth = input.input.options.maxExpressionDepth ?? 100;
  if (input.depth > maxDepth) {
    return { kind: "unknown", reason: "class-name-resolution-budget-exceeded" };
  }

  if (input.seenExpressionIds.has(input.expression.expressionId)) {
    return { kind: "unknown", reason: "class-name-resolution-cycle" };
  }

  const seenExpressionIds = new Set(input.seenExpressionIds);
  seenExpressionIds.add(input.expression.expressionId);
  const expression = unwrapExpressionSyntax({
    ...input,
    seenExpressionIds,
  });

  switch (expression.expressionKind) {
    case "string-literal":
      return {
        kind: "string-exact",
        value: normalizeSelectorLikeComponentClassNameValue(input.input, expression.value),
      };

    case "template-literal":
      return summarizeTemplateExpressionSyntax({
        ...input,
        expression,
        seenExpressionIds,
      });

    case "binary":
      return summarizeBinaryExpressionSyntax({
        ...input,
        expression,
        seenExpressionIds,
      });

    case "conditional":
      return summarizeConditionalExpressionSyntax({
        ...input,
        expression,
        seenExpressionIds,
      });

    case "call":
      return summarizeCallExpressionSyntax({
        ...input,
        expression,
        seenExpressionIds,
        maxStringCombinations: MAX_STRING_COMBINATIONS,
        callbacks: callEvaluationCallbacks,
      });

    case "array-literal":
      return summarizeArrayExpressionSyntax({
        ...input,
        elementExpressionIds: expression.elementExpressionIds,
        hasSpreadElement: expression.hasSpreadElement,
        hasOmittedElement: expression.hasOmittedElement,
        seenExpressionIds,
        callbacks: arrayEvaluationCallbacks,
      });

    case "object-literal":
      if (!input.allowObjectClassMap) {
        return {
          kind: "unknown",
          reason: "unsupported-object-class-map-outside-class-helper",
        };
      }
      return summarizeObjectExpressionSyntax({
        ...input,
        expression,
        seenExpressionIds,
      });

    case "identifier": {
      const boundValue = input.helperBindings?.get(expression.name);
      if (boundValue) {
        return boundValue;
      }
      const resolved = summarizeIdentifierExpressionSyntax({
        ...input,
        expression,
        seenExpressionIds,
        callbacks: identifierResolutionCallbacks,
      });
      if (resolved) {
        return resolved;
      }
      const imported = summarizeImportedIdentifierExpressionSyntax({
        input: input.input,
        expression,
        callbacks: identifierResolutionCallbacks,
      });
      if (imported) {
        return imported.value;
      }
      if (expression.possibleStringValues && expression.possibleStringValues.length > 0) {
        return toStringValue(expression.possibleStringValues);
      }
      return {
        kind: "unknown",
        reason: `unsupported-expression:${expression.expressionKind}`,
      };
    }
    case "member-access":
      return summarizeMemberAccessExpressionSyntax({
        ...input,
        expression,
        seenExpressionIds,
        callbacks: objectMemberEvaluationCallbacks,
      });

    case "element-access":
      return summarizeElementAccessExpressionSyntax({
        ...input,
        expression,
        seenExpressionIds,
        callbacks: objectMemberEvaluationCallbacks,
      });

    default:
      return {
        kind: "unknown",
        reason: `unsupported-expression:${expression.expressionKind}`,
      };
  }
}

function summarizeTemplateExpressionSyntax(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "template-literal" }>;
  depth: number;
  seenExpressionIds: Set<string>;
  helperBindings?: Map<string, AbstractValue>;
}): AbstractValue {
  let candidates = [input.expression.headText];
  const staticTokens = collectSafeStaticTemplateClassTokens(input.expression);
  const knownClassNames = collectKnownClassNames(input.input);

  for (const span of input.expression.spans) {
    const spanExpression = getExpressionSyntax(input.input, span.expressionId);
    if (!spanExpression) {
      return buildPartialTemplateClassSet(staticTokens, "unsupported-template-interpolation");
    }

    const spanValue = summarizeNormalizedClassExpression({
      input: input.input,
      expression: spanExpression,
      depth: input.depth + 1,
      seenExpressionIds: input.seenExpressionIds,
      helperBindings: input.helperBindings,
    });
    const spanCandidates = getStringCandidates(spanValue);
    if (!spanCandidates) {
      const expandedTemplateClasses = shouldExpandTemplateAgainstKnownClasses(input.input)
        ? expandTemplateAgainstKnownClasses(input.expression, knownClassNames)
        : [];
      if (expandedTemplateClasses.length > 0) {
        return {
          kind: "class-set",
          definite: [],
          possible: expandedTemplateClasses,
          unknownDynamic: true,
          reason: "template-pattern-expanded-against-known-css-classes",
        };
      }
      return buildPartialTemplateClassSet(staticTokens, "unsupported-template-interpolation");
    }

    candidates = combineStrings(candidates, spanCandidates);
    if (candidates.length > MAX_STRING_COMBINATIONS) {
      return buildPartialTemplateClassSet(staticTokens, "template-interpolation-budget-exceeded");
    }

    candidates = candidates.map((candidate) => `${candidate}${span.literalText}`);
  }

  return toStringValue(candidates);
}

function summarizeBinaryExpressionSyntax(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "binary" }>;
  depth: number;
  seenExpressionIds: Set<string>;
  helperBindings?: Map<string, AbstractValue>;
}): AbstractValue {
  const left = getExpressionValue(input, input.expression.leftExpressionId);
  const right = getExpressionValue(input, input.expression.rightExpressionId);

  if (input.expression.operator === "+") {
    return combineStringLikeValues(left, right);
  }

  const leftExpression = getExpressionSyntax(input.input, input.expression.leftExpressionId);
  const leftTruthiness = leftExpression
    ? evaluateExpressionStaticTruthiness({
        ...input,
        expression: leftExpression,
      })
    : undefined;

  if (input.expression.operator === "&&") {
    if (leftTruthiness === false || leftTruthiness === "nullish") {
      return { kind: "string-exact", value: "" };
    }
    if (leftTruthiness === true) {
      return right;
    }

    const rightClassSet = toClassSet(right);
    return {
      kind: "class-set",
      definite: [],
      possible: uniqueSorted([...rightClassSet.definite, ...rightClassSet.possible]),
      mutuallyExclusiveGroups: rightClassSet.mutuallyExclusiveGroups,
      unknownDynamic: rightClassSet.unknownDynamic,
      reason: "logical-and expression",
    };
  }

  if (input.expression.operator === "??") {
    if (leftTruthiness === "nullish") {
      return right;
    }
    if (leftTruthiness !== undefined || left.kind !== "unknown") {
      return left;
    }

    const rightClassSet = toClassSet(right);
    return {
      kind: "class-set",
      definite: [],
      possible: uniqueSorted([...rightClassSet.definite, ...rightClassSet.possible]),
      mutuallyExclusiveGroups: rightClassSet.mutuallyExclusiveGroups,
      unknownDynamic: true,
      reason: "nullish coalescing expression",
    };
  }

  if (input.expression.operator === "||") {
    if (leftTruthiness === true) {
      return left;
    }
    if (leftTruthiness === false || leftTruthiness === "nullish") {
      return right;
    }
  }

  return mergeClassSets([left, right], "logical-or expression");
}

function summarizeConditionalExpressionSyntax(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "conditional" }>;
  depth: number;
  seenExpressionIds: Set<string>;
  helperBindings?: Map<string, AbstractValue>;
}): AbstractValue {
  const conditionExpression = getExpressionSyntax(
    input.input,
    input.expression.conditionExpressionId,
  );
  const conditionTruthiness = conditionExpression
    ? evaluateExpressionStaticTruthiness({
        ...input,
        expression: conditionExpression,
      })
    : undefined;
  if (conditionTruthiness === true) {
    return getExpressionValue(input, input.expression.whenTrueExpressionId);
  }
  if (conditionTruthiness === false || conditionTruthiness === "nullish") {
    return getExpressionValue(input, input.expression.whenFalseExpressionId);
  }

  const whenTrue = getExpressionValue(input, input.expression.whenTrueExpressionId);
  const whenFalse = getExpressionValue(input, input.expression.whenFalseExpressionId);
  const stringCandidates = collectStringCandidates(whenTrue, whenFalse);

  if (stringCandidates) {
    return {
      kind: "string-set",
      values: stringCandidates,
      mutuallyExclusiveGroups: [
        uniqueSorted(stringCandidates.flatMap((candidate) => tokenizeClassNames(candidate))),
      ],
    };
  }

  return mergeClassSets([whenTrue, whenFalse], "conditional expression");
}

function evaluateExpressionStaticTruthiness(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: ExpressionSyntaxNode;
  depth: number;
  seenExpressionIds: Set<string>;
  helperBindings?: Map<string, AbstractValue>;
}): ReturnType<typeof evaluateStaticTruthiness> {
  return evaluateStaticTruthiness({
    expression: input.expression,
    maxDepth: input.input.options.maxExpressionDepth ?? 100,
    depth: input.depth,
    seenExpressionIds: input.seenExpressionIds,
    resolveExpressionById: (expressionId) => getExpressionSyntax(input.input, expressionId),
  });
}

function normalizeSelectorLikeComponentClassNameValue(
  input: SymbolicExpressionEvaluatorInput,
  value: string,
): string {
  if (
    input.classExpressionSite.classExpressionSiteKind !== "component-prop-class" ||
    !input.classExpressionSite.componentPropName?.endsWith("ClassName")
  ) {
    return value;
  }

  const trimmed = value.trim();
  if (!/^\.[_a-zA-Z-][-_a-zA-Z0-9]*$/.test(trimmed)) {
    return value;
  }

  return trimmed.slice(1);
}

function combineStringLikeValues(left: AbstractValue, right: AbstractValue): AbstractValue {
  const leftCandidates = getStringCandidates(left);
  const rightCandidates = getStringCandidates(right);

  if (!leftCandidates || !rightCandidates) {
    return { kind: "unknown", reason: "unsupported-string-concatenation" };
  }

  const combined = combineStrings(leftCandidates, rightCandidates);
  if (combined.length > MAX_STRING_COMBINATIONS) {
    return { kind: "unknown", reason: "string-concatenation-budget-exceeded" };
  }

  return toStringValue(combined);
}

function getExpressionValue(
  input: {
    input: SymbolicExpressionEvaluatorInput;
    depth: number;
    seenExpressionIds: Set<string>;
    helperBindings?: Map<string, AbstractValue>;
  },
  expressionId: string,
): AbstractValue {
  const expression = getExpressionSyntax(input.input, expressionId);
  if (!expression) {
    return { kind: "unknown", reason: "missing-expression-syntax" };
  }

  return summarizeNormalizedClassExpression({
    input: input.input,
    expression,
    depth: input.depth + 1,
    seenExpressionIds: input.seenExpressionIds,
    helperBindings: input.helperBindings,
  });
}

function unwrapExpressionSyntax(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: ExpressionSyntaxNode;
  depth: number;
  seenExpressionIds: Set<string>;
  helperBindings?: Map<string, AbstractValue>;
}): ExpressionSyntaxNode {
  let expression = input.expression;
  while (expression.expressionKind === "wrapper") {
    const inner = getExpressionSyntax(input.input, expression.innerExpressionId);
    if (!inner) {
      return expression;
    }

    expression = inner;
  }

  return expression;
}
