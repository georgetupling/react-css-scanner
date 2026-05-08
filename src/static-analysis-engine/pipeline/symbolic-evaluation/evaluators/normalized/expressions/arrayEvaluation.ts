import {
  getStringCandidates,
  mergeClassSets,
  toStringValue,
} from "../../../values/classValueOperations.js";
import type { AbstractValue } from "../../../values/types.js";
import { getExpressionSyntax } from "../expressionSyntaxLookup.js";
import type { ExpressionSyntaxNode } from "../../../../fact-graph/index.js";
import type { SymbolicExpressionEvaluatorInput } from "../../../model/types.js";
import { resolveLocalValueBindingsForIdentifier } from "../bindings/scopeResolution.js";
import { resolveObjectLiteralExpressionSyntax } from "./objectAndMemberEvaluation.js";

type EvaluationContext = {
  input: SymbolicExpressionEvaluatorInput;
  depth: number;
  seenExpressionIds: Set<string>;
  helperBindings?: Map<string, AbstractValue>;
};

type ImportedIdentifierResolution = {
  expression: ExpressionSyntaxNode;
};

type ObjectMemberCallbacks = Parameters<
  typeof resolveObjectLiteralExpressionSyntax
>[0]["callbacks"];

export type ArrayEvaluationCallbacks = {
  objectMemberCallbacks: ObjectMemberCallbacks;
  resolveImportedIdentifierExpressionSyntax(input: {
    input: SymbolicExpressionEvaluatorInput;
    expression: Extract<ExpressionSyntaxNode, { expressionKind: "identifier" }>;
  }): ImportedIdentifierResolution | undefined;
  summarizeClassNamesHelperArg(input: EvaluationContext, expressionId: string): AbstractValue;
};

type ClassArrayJoinTarget = {
  elementExpressionIds: string[];
  hasSpreadElement: boolean;
  hasOmittedElement: boolean;
};

export function resolveArrayLiteralExpressionSyntax(
  input: EvaluationContext & {
    expression: ExpressionSyntaxNode;
    callbacks: ArrayEvaluationCallbacks;
  },
): Extract<ExpressionSyntaxNode, { expressionKind: "array-literal" }> | undefined {
  if (input.depth > (input.input.options.maxExpressionDepth ?? 100)) {
    return undefined;
  }

  if (input.seenExpressionIds.has(input.expression.expressionId)) {
    return undefined;
  }

  const seenExpressionIds = new Set(input.seenExpressionIds);
  seenExpressionIds.add(input.expression.expressionId);
  const unwrapped = unwrapExpressionSyntax(input);
  if (unwrapped.expressionKind === "array-literal") {
    return unwrapped;
  }

  if (unwrapped.expressionKind !== "identifier") {
    return undefined;
  }

  const rootOwnerNodeId = input.input.classExpressionSite.emittingComponentNodeId;
  if (!rootOwnerNodeId) {
    return undefined;
  }

  const bindings = resolveLocalValueBindingsForIdentifier({
    input: input.input,
    rootOwnerNodeId,
    identifierName: unwrapped.name,
    targetLocation: unwrapped.location,
  });
  for (const binding of bindings) {
    const expressionId = binding.expressionId ?? binding.initializerExpressionId;
    const expression = expressionId ? getExpressionSyntax(input.input, expressionId) : undefined;
    if (!expression) {
      continue;
    }
    const resolved = resolveArrayLiteralExpressionSyntax({
      ...input,
      expression,
      depth: input.depth + 1,
      seenExpressionIds,
    });
    if (resolved) {
      return resolved;
    }
  }

  const imported = input.callbacks.resolveImportedIdentifierExpressionSyntax({
    input: input.input,
    expression: unwrapped,
  });
  if (imported) {
    return resolveArrayLiteralExpressionSyntax({
      ...input,
      expression: imported.expression,
      depth: input.depth + 1,
      seenExpressionIds,
    });
  }

  return undefined;
}

export function summarizeArrayExpressionSyntax(
  input: EvaluationContext &
    ClassArrayJoinTarget & {
      callbacks: ArrayEvaluationCallbacks;
    },
): AbstractValue {
  const parts = input.elementExpressionIds.map((elementExpressionId) =>
    input.callbacks.summarizeClassNamesHelperArg(input, elementExpressionId),
  );
  if (input.hasSpreadElement || input.hasOmittedElement) {
    parts.push({ kind: "class-set", definite: [], possible: [], unknownDynamic: true });
  }

  return mergeClassSets(parts, "class array");
}

export function summarizeClassArrayJoin(
  input: EvaluationContext &
    ClassArrayJoinTarget & {
      argumentExpressionIds: string[];
      maxStringCombinations: number;
      callbacks: ArrayEvaluationCallbacks;
    },
): AbstractValue {
  const separator = getJoinSeparator(input.input, input.argumentExpressionIds);
  if (separator === undefined) {
    return { kind: "unknown", reason: "unsupported-join-separator" };
  }

  if (/^\s*$/.test(separator)) {
    return summarizeArrayExpressionSyntax(input);
  }

  if (input.hasSpreadElement || input.hasOmittedElement) {
    return { kind: "unknown", reason: "non-whitespace-join-with-unsupported-array-element" };
  }

  let candidates = [""];
  for (const elementExpressionId of input.elementExpressionIds) {
    const elementCandidates = getStringCandidates(
      input.callbacks.summarizeClassNamesHelperArg(input, elementExpressionId),
    );
    if (!elementCandidates) {
      return { kind: "unknown", reason: "non-whitespace-join-separator" };
    }

    candidates = candidates.flatMap((prefix) =>
      elementCandidates.map((candidate) =>
        prefix.length === 0 ? candidate : `${prefix}${separator}${candidate}`,
      ),
    );
    if (candidates.length > input.maxStringCombinations) {
      return { kind: "unknown", reason: "string-concatenation-budget-exceeded" };
    }
  }

  return toStringValue(candidates);
}

export function getArrayJoinTarget(
  input: EvaluationContext & { callbacks: ArrayEvaluationCallbacks },
  callee: ExpressionSyntaxNode,
): ClassArrayJoinTarget | undefined {
  const unwrappedCallee =
    callee.expressionKind === "wrapper"
      ? (getExpressionSyntax(input.input, callee.innerExpressionId) ?? callee)
      : callee;
  if (
    unwrappedCallee.expressionKind !== "member-access" ||
    unwrappedCallee.propertyName !== "join"
  ) {
    return undefined;
  }

  const target = getExpressionSyntax(input.input, unwrappedCallee.objectExpressionId);
  return target ? getClassArrayJoinTarget(input, target) : undefined;
}

export function getJoinSeparator(
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

function getClassArrayJoinTarget(
  input: EvaluationContext & { callbacks: ArrayEvaluationCallbacks },
  expression: ExpressionSyntaxNode,
): ClassArrayJoinTarget | undefined {
  const unwrapped =
    expression.expressionKind === "wrapper"
      ? (getExpressionSyntax(input.input, expression.innerExpressionId) ?? expression)
      : expression;
  if (unwrapped.expressionKind === "array-literal") {
    return {
      elementExpressionIds: unwrapped.elementExpressionIds,
      hasSpreadElement: unwrapped.hasSpreadElement,
      hasOmittedElement: unwrapped.hasOmittedElement,
    };
  }

  if (unwrapped.expressionKind === "identifier") {
    const arrayLiteral = resolveArrayLiteralExpressionSyntax({
      input: input.input,
      expression: unwrapped,
      depth: input.depth + 1,
      seenExpressionIds: input.seenExpressionIds,
      helperBindings: input.helperBindings,
      callbacks: input.callbacks,
    });
    if (arrayLiteral) {
      return {
        elementExpressionIds: arrayLiteral.elementExpressionIds,
        hasSpreadElement: arrayLiteral.hasSpreadElement,
        hasOmittedElement: arrayLiteral.hasOmittedElement,
      };
    }
  }

  if (unwrapped.expressionKind === "call") {
    const objectValuesTarget = getObjectValuesTarget(input, unwrapped);
    if (objectValuesTarget) {
      return objectValuesTarget;
    }

    const concatTarget = getArrayConcatTarget(input, unwrapped);
    if (concatTarget) {
      return concatTarget;
    }

    const mapTarget = getArrayMapTarget(input, unwrapped);
    if (mapTarget) {
      return mapTarget;
    }
  }

  if (unwrapped.expressionKind !== "call" || !isBooleanFilterCall(input, unwrapped)) {
    return undefined;
  }

  const filterCallee = getExpressionSyntax(input.input, unwrapped.calleeExpressionId);
  if (!filterCallee || filterCallee.expressionKind !== "member-access") {
    return undefined;
  }

  const filterTarget = getExpressionSyntax(input.input, filterCallee.objectExpressionId);
  return filterTarget ? getClassArrayJoinTarget(input, filterTarget) : undefined;
}

function getArrayConcatTarget(
  input: EvaluationContext & { callbacks: ArrayEvaluationCallbacks },
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "call" }>,
): ClassArrayJoinTarget | undefined {
  if (expression.hasSpreadArgument) {
    return undefined;
  }

  const callee = getExpressionSyntax(input.input, expression.calleeExpressionId);
  if (!callee || callee.expressionKind !== "member-access" || callee.propertyName !== "concat") {
    return undefined;
  }

  const target = getExpressionSyntax(input.input, callee.objectExpressionId);
  const baseTarget = target ? getClassArrayJoinTarget(input, target) : undefined;
  if (!baseTarget) {
    return undefined;
  }

  let hasSpreadElement = baseTarget.hasSpreadElement;
  let hasOmittedElement = baseTarget.hasOmittedElement;
  const elementExpressionIds = [...baseTarget.elementExpressionIds];

  for (const argumentExpressionId of expression.argumentExpressionIds) {
    const argument = getExpressionSyntax(input.input, argumentExpressionId);
    const argumentArray =
      argument?.expressionKind === "array-literal"
        ? getClassArrayJoinTarget(input, argument)
        : undefined;
    if (argumentArray) {
      elementExpressionIds.push(...argumentArray.elementExpressionIds);
      hasSpreadElement ||= argumentArray.hasSpreadElement;
      hasOmittedElement ||= argumentArray.hasOmittedElement;
      continue;
    }

    elementExpressionIds.push(argumentExpressionId);
  }

  return {
    elementExpressionIds,
    hasSpreadElement,
    hasOmittedElement,
  };
}

function getArrayMapTarget(
  input: EvaluationContext & { callbacks: ArrayEvaluationCallbacks },
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "call" }>,
): ClassArrayJoinTarget | undefined {
  if (expression.hasSpreadArgument || expression.argumentExpressionIds.length !== 1) {
    return undefined;
  }

  const callee = getExpressionSyntax(input.input, expression.calleeExpressionId);
  if (!callee || callee.expressionKind !== "member-access" || callee.propertyName !== "map") {
    return undefined;
  }

  const callback = getExpressionSyntax(input.input, expression.argumentExpressionIds[0]);
  if (!callback || callback.expressionKind !== "function" || !isIdentityMapCallback(callback)) {
    return undefined;
  }

  const target = getExpressionSyntax(input.input, callee.objectExpressionId);
  return target ? getClassArrayJoinTarget(input, target) : undefined;
}

function isIdentityMapCallback(
  callback: Extract<ExpressionSyntaxNode, { expressionKind: "function" }>,
): boolean {
  if (callback.parameterCount !== 1 || callback.returnExpressionIds.length !== 1) {
    return false;
  }

  const match =
    /^\(?\s*([_$a-zA-Z][_$\w]*)\s*\)?\s*=>\s*\1$/u.exec(callback.rawText) ??
    /^function\s*\(\s*([_$a-zA-Z][_$\w]*)\s*\{\s*return\s+\1\s*;?\s*\}$/u.exec(callback.rawText);
  return Boolean(match);
}

function isBooleanFilterCall(
  input: { input: SymbolicExpressionEvaluatorInput },
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "call" }>,
): boolean {
  const callee = getExpressionSyntax(input.input, expression.calleeExpressionId);
  if (!callee || callee.expressionKind !== "member-access" || callee.propertyName !== "filter") {
    return false;
  }

  if (expression.argumentExpressionIds.length === 0) {
    return true;
  }

  if (expression.argumentExpressionIds.length !== 1) {
    return false;
  }

  const argument = getExpressionSyntax(input.input, expression.argumentExpressionIds[0]);
  return argument?.expressionKind === "identifier" && argument.name === "Boolean";
}

function getObjectValuesTarget(
  input: EvaluationContext & { callbacks: ArrayEvaluationCallbacks },
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "call" }>,
): ClassArrayJoinTarget | undefined {
  if (expression.argumentExpressionIds.length !== 1 || expression.hasSpreadArgument) {
    return undefined;
  }

  const callee = getExpressionSyntax(input.input, expression.calleeExpressionId);
  if (!callee || callee.expressionKind !== "member-access" || callee.propertyName !== "values") {
    return undefined;
  }

  const objectCallee = getExpressionSyntax(input.input, callee.objectExpressionId);
  if (objectCallee?.expressionKind !== "identifier" || objectCallee.name !== "Object") {
    return undefined;
  }

  const targetExpression = getExpressionSyntax(input.input, expression.argumentExpressionIds[0]);
  const objectLiteral = targetExpression
    ? resolveObjectLiteralExpressionSyntax({
        input: input.input,
        expression: targetExpression,
        depth: input.depth + 1,
        seenExpressionIds: input.seenExpressionIds,
        helperBindings: input.helperBindings,
        callbacks: input.callbacks.objectMemberCallbacks,
      })
    : undefined;
  if (!objectLiteral || objectLiteral.hasSpreadProperty || objectLiteral.hasUnsupportedProperty) {
    return undefined;
  }

  const elementExpressionIds: string[] = [];
  for (const property of objectLiteral.properties) {
    if (
      property.propertyKind !== "property" ||
      property.keyKind === "computed" ||
      !property.valueExpressionId
    ) {
      return undefined;
    }
    elementExpressionIds.push(property.valueExpressionId);
  }

  return {
    elementExpressionIds,
    hasSpreadElement: false,
    hasOmittedElement: false,
  };
}

function unwrapExpressionSyntax(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: ExpressionSyntaxNode;
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
