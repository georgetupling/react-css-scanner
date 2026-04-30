import {
  collectStringCandidates,
  combineStrings,
  getStringCandidates,
  mergeClassSets,
  toClassSet,
  toStringValue,
  tokenizeClassNames,
  uniqueSorted,
} from "../class-values/classValueOperations.js";
import type { AbstractValue } from "../class-values/types.js";
import {
  buildCanonicalClassExpressionFromValue,
  buildConditions,
} from "./canonicalClassExpressionBuilder.js";
import type { ExpressionSyntaxNode } from "../../fact-graph/index.js";
import type { SymbolicExpressionEvaluator, SymbolicExpressionEvaluatorInput } from "../types.js";

const MAX_STRING_COMBINATIONS = 32;

export const normalizedClassExpressionEvaluator: SymbolicExpressionEvaluator = {
  name: "normalized-expression-class-expression",
  canEvaluate: (input) => Boolean(input.expressionSyntax),
  evaluate(input) {
    if (!input.expressionSyntax) {
      return {};
    }

    const value = summarizeNormalizedClassExpression({
      input,
      expression: input.expressionSyntax,
      depth: 0,
      seenExpressionIds: new Set(),
    });
    const expression = buildCanonicalClassExpressionFromValue({
      input,
      value,
      rawExpressionText: input.expressionSyntax.rawText,
      provenanceSummary: "Evaluated class expression from normalized graph expression syntax",
    });

    return {
      expression,
      conditions: buildConditions(expression.id, value),
    };
  },
};

function summarizeNormalizedClassExpression(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: ExpressionSyntaxNode;
  depth: number;
  seenExpressionIds: Set<string>;
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
        value: expression.value,
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
      });

    case "array-literal":
      return summarizeArrayExpressionSyntax({
        ...input,
        elementExpressionIds: expression.elementExpressionIds,
        hasSpreadElement: expression.hasSpreadElement,
        hasOmittedElement: expression.hasOmittedElement,
        seenExpressionIds,
      });

    case "object-literal":
      return summarizeObjectExpressionSyntax({
        ...input,
        expression,
        seenExpressionIds,
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
}): AbstractValue {
  let candidates = [input.expression.headText];
  const staticTokens = collectSafeStaticTemplateClassTokens(input.expression);

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
    });
    const spanCandidates = getStringCandidates(spanValue);
    if (!spanCandidates) {
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
}): AbstractValue {
  const left = getExpressionValue(input, input.expression.leftExpressionId);
  const right = getExpressionValue(input, input.expression.rightExpressionId);

  if (input.expression.operator === "+") {
    return combineStringLikeValues(left, right);
  }

  if (input.expression.operator === "&&") {
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
    if (left.kind !== "unknown") {
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

  return mergeClassSets([left, right], "logical-or expression");
}

function summarizeConditionalExpressionSyntax(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "conditional" }>;
  depth: number;
  seenExpressionIds: Set<string>;
}): AbstractValue {
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

function summarizeCallExpressionSyntax(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "call" }>;
  depth: number;
  seenExpressionIds: Set<string>;
}): AbstractValue {
  if (input.expression.hasSpreadArgument) {
    return { kind: "unknown", reason: "unsupported-call:spread-argument" };
  }

  const callee = getExpressionSyntax(input.input, input.expression.calleeExpressionId);
  if (callee && isClassNamesHelper(callee)) {
    return summarizeClassNamesHelperArgs(input, input.expression.argumentExpressionIds);
  }

  const arrayJoinTarget = callee ? getArrayJoinTarget(input.input, callee) : undefined;
  if (arrayJoinTarget) {
    return summarizeClassArrayJoin({
      ...input,
      elementExpressionIds: arrayJoinTarget.elementExpressionIds,
      argumentExpressionIds: input.expression.argumentExpressionIds,
    });
  }

  return {
    kind: "unknown",
    reason: `unsupported-call:${callee?.rawText ?? input.expression.rawText}`,
  };
}

function summarizeClassNamesHelperArgs(
  input: {
    input: SymbolicExpressionEvaluatorInput;
    depth: number;
    seenExpressionIds: Set<string>;
  },
  argumentExpressionIds: string[],
): AbstractValue {
  const parts = argumentExpressionIds.map((argumentExpressionId) =>
    summarizeClassNamesHelperArg(input, argumentExpressionId),
  );
  return mergeClassSets(parts, "class name helper call");
}

function summarizeClassNamesHelperArg(
  input: {
    input: SymbolicExpressionEvaluatorInput;
    depth: number;
    seenExpressionIds: Set<string>;
  },
  expressionId: string,
): AbstractValue {
  const expression = getExpressionSyntax(input.input, expressionId);
  if (!expression) {
    return { kind: "class-set", definite: [], possible: [], unknownDynamic: true };
  }

  const unwrapped = unwrapExpressionSyntax({ ...input, expression });
  if (isDefinitelyFalsy(unwrapped)) {
    return { kind: "string-exact", value: "" };
  }

  if (isDefinitelyTruthy(unwrapped) && unwrapped.expressionKind === "boolean-literal") {
    return { kind: "class-set", definite: [], possible: [], unknownDynamic: false };
  }

  const value = summarizeNormalizedClassExpression({
    input: input.input,
    expression: unwrapped,
    depth: input.depth + 1,
    seenExpressionIds: input.seenExpressionIds,
  });
  if (value.kind === "unknown") {
    return {
      kind: "class-set",
      definite: [],
      possible: [],
      unknownDynamic: true,
      reason: value.reason,
    };
  }

  return value;
}

function summarizeObjectExpressionSyntax(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "object-literal" }>;
  depth: number;
  seenExpressionIds: Set<string>;
}): AbstractValue {
  const definite: string[] = [];
  const possible: string[] = [];
  let unknownDynamic =
    input.expression.hasSpreadProperty || input.expression.hasUnsupportedProperty;

  for (const property of input.expression.properties) {
    if (property.propertyKind === "shorthand" && property.keyText) {
      possible.push(...tokenizeClassNames(property.keyText));
      continue;
    }

    if (property.propertyKind !== "property" || !property.keyText) {
      unknownDynamic = true;
      continue;
    }

    if (property.keyKind === "computed") {
      unknownDynamic = true;
      continue;
    }

    const valueExpression = property.valueExpressionId
      ? getExpressionSyntax(input.input, property.valueExpressionId)
      : undefined;

    if (valueExpression && isDefinitelyFalsy(valueExpression)) {
      continue;
    }

    if (valueExpression && isDefinitelyTruthy(valueExpression)) {
      definite.push(...tokenizeClassNames(property.keyText));
      continue;
    }

    possible.push(...tokenizeClassNames(property.keyText));
  }

  return {
    kind: "class-set",
    definite: uniqueSorted(definite),
    possible: uniqueSorted(possible),
    unknownDynamic,
    reason: "object class map",
  };
}

function summarizeArrayExpressionSyntax(input: {
  input: SymbolicExpressionEvaluatorInput;
  elementExpressionIds: string[];
  hasSpreadElement: boolean;
  hasOmittedElement: boolean;
  depth: number;
  seenExpressionIds: Set<string>;
}): AbstractValue {
  const parts = input.elementExpressionIds.map((elementExpressionId) =>
    summarizeClassNamesHelperArg(input, elementExpressionId),
  );
  if (input.hasSpreadElement || input.hasOmittedElement) {
    parts.push({ kind: "class-set", definite: [], possible: [], unknownDynamic: true });
  }

  return mergeClassSets(parts, "class array");
}

function summarizeClassArrayJoin(input: {
  input: SymbolicExpressionEvaluatorInput;
  elementExpressionIds: string[];
  argumentExpressionIds: string[];
  depth: number;
  seenExpressionIds: Set<string>;
}): AbstractValue {
  const separator = getJoinSeparator(input.input, input.argumentExpressionIds);
  if (separator === undefined) {
    return { kind: "unknown", reason: "unsupported-join-separator" };
  }

  if (/^\s*$/.test(separator)) {
    return summarizeArrayExpressionSyntax({
      ...input,
      hasSpreadElement: false,
      hasOmittedElement: false,
    });
  }

  let candidates = [""];
  for (const elementExpressionId of input.elementExpressionIds) {
    const elementCandidates = getStringCandidates(
      summarizeClassNamesHelperArg(input, elementExpressionId),
    );
    if (!elementCandidates) {
      return { kind: "unknown", reason: "non-whitespace-join-separator" };
    }

    candidates = candidates.flatMap((prefix) =>
      elementCandidates.map((candidate) =>
        prefix.length === 0 ? candidate : `${prefix}${separator}${candidate}`,
      ),
    );
    if (candidates.length > MAX_STRING_COMBINATIONS) {
      return { kind: "unknown", reason: "string-concatenation-budget-exceeded" };
    }
  }

  return toStringValue(candidates);
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
  });
}

function unwrapExpressionSyntax(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: ExpressionSyntaxNode;
  depth: number;
  seenExpressionIds: Set<string>;
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

function isClassNamesHelper(expression: ExpressionSyntaxNode): boolean {
  const unwrapped = expression.expressionKind === "wrapper" ? expression : expression;
  return (
    unwrapped.expressionKind === "identifier" &&
    (unwrapped.name === "clsx" ||
      unwrapped.name === "classnames" ||
      unwrapped.name === "classNames")
  );
}

function getArrayJoinTarget(
  input: SymbolicExpressionEvaluatorInput,
  callee: ExpressionSyntaxNode,
): Extract<ExpressionSyntaxNode, { expressionKind: "array-literal" }> | undefined {
  const unwrappedCallee = callee.expressionKind === "wrapper" ? callee : callee;
  if (
    unwrappedCallee.expressionKind !== "member-access" ||
    unwrappedCallee.propertyName !== "join"
  ) {
    return undefined;
  }

  const target = getExpressionSyntax(input, unwrappedCallee.objectExpressionId);
  return target?.expressionKind === "array-literal" ? target : undefined;
}

function getJoinSeparator(
  input: SymbolicExpressionEvaluatorInput,
  argumentExpressionIds: string[],
): string | undefined {
  if (argumentExpressionIds.length === 0) {
    return ",";
  }

  if (argumentExpressionIds.length !== 1) {
    return undefined;
  }

  const separator = getExpressionSyntax(input, argumentExpressionIds[0]);
  const unwrappedSeparator =
    separator && separator.expressionKind === "wrapper"
      ? getExpressionSyntax(input, separator.innerExpressionId)
      : separator;
  return unwrappedSeparator?.expressionKind === "string-literal"
    ? unwrappedSeparator.value
    : undefined;
}

function collectSafeStaticTemplateClassTokens(
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "template-literal" }>,
): string[] {
  const templateParts = [expression.headText, ...expression.spans.map((span) => span.literalText)];
  const tokens: string[] = [];

  for (let index = 0; index < templateParts.length; index += 1) {
    tokens.push(
      ...collectSafeStaticClassTokensFromTemplatePart(templateParts[index], {
        isTemplateStart: index === 0,
        isTemplateEnd: index === templateParts.length - 1,
      }),
    );
  }

  return uniqueSorted(tokens);
}

function collectSafeStaticClassTokensFromTemplatePart(
  text: string,
  boundaries: {
    isTemplateStart: boolean;
    isTemplateEnd: boolean;
  },
): string[] {
  const tokens: string[] = [];
  const tokenPattern = /\S+/g;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(text)) !== null) {
    const token = match[0];
    const startIndex = match.index;
    const endIndex = startIndex + token.length;
    const hasSafeStart =
      startIndex > 0 ? /\s/.test(text[startIndex - 1]) : boundaries.isTemplateStart;
    const hasSafeEnd =
      endIndex < text.length ? /\s/.test(text[endIndex]) : boundaries.isTemplateEnd;

    if (hasSafeStart && hasSafeEnd) {
      tokens.push(token);
    }
  }

  return tokens;
}

function buildPartialTemplateClassSet(staticTokens: string[], reason: string): AbstractValue {
  if (staticTokens.length === 0) {
    return { kind: "unknown", reason };
  }

  return {
    kind: "class-set",
    definite: uniqueSorted(staticTokens),
    possible: [],
    unknownDynamic: true,
    reason: `partial-template:${reason}`,
  };
}

function isDefinitelyFalsy(expression: ExpressionSyntaxNode): boolean {
  const unwrapped = expression;
  return (
    (unwrapped.expressionKind === "boolean-literal" && !unwrapped.value) ||
    unwrapped.expressionKind === "nullish-literal" ||
    (unwrapped.expressionKind === "numeric-literal" && Number(unwrapped.value) === 0) ||
    (unwrapped.expressionKind === "string-literal" && unwrapped.value.length === 0)
  );
}

function isDefinitelyTruthy(expression: ExpressionSyntaxNode): boolean {
  const unwrapped = expression;
  return (
    (unwrapped.expressionKind === "boolean-literal" && unwrapped.value) ||
    (unwrapped.expressionKind === "numeric-literal" && Number(unwrapped.value) !== 0) ||
    (unwrapped.expressionKind === "string-literal" && unwrapped.value.length > 0)
  );
}
