import { mergeClassSets, uniqueSorted } from "../../../values/classValueOperations.js";
import type { AbstractValue } from "../../../values/types.js";
import { getExpressionSyntax } from "../expressionSyntaxLookup.js";
import { isDefinitelyFalsy, isDefinitelyTruthy } from "../predicates/staticExpressionPredicates.js";
import type { ExpressionSyntaxNode } from "../../../../fact-graph/index.js";
import type { SymbolicExpressionEvaluatorInput } from "../../../model/types.js";
import {
  getArrayJoinTarget,
  summarizeClassArrayJoin,
  type ArrayEvaluationCallbacks,
} from "./arrayEvaluation.js";
import { summarizeJsonArrayJoin } from "../bindings/jsonStaticValues.js";
import { summarizeLocalHelperCall } from "../bindings/localHelperEvaluation.js";

type EvaluationContext = {
  input: SymbolicExpressionEvaluatorInput;
  depth: number;
  seenExpressionIds: Set<string>;
  helperBindings?: Map<string, AbstractValue>;
};

export type CallEvaluationCallbacks = {
  arrayCallbacks: ArrayEvaluationCallbacks;
  getExpressionValue(input: EvaluationContext, expressionId: string): AbstractValue;
  summarizeExpression(
    input: EvaluationContext & {
      expression: ExpressionSyntaxNode;
      allowObjectClassMap?: boolean;
    },
  ): AbstractValue;
  summarizeIdentifier(
    input: EvaluationContext & {
      expression: Extract<ExpressionSyntaxNode, { expressionKind: "identifier" }>;
    },
  ): AbstractValue | undefined;
};

export function summarizeCallExpressionSyntax(
  input: EvaluationContext & {
    expression: Extract<ExpressionSyntaxNode, { expressionKind: "call" }>;
    maxStringCombinations: number;
    callbacks: CallEvaluationCallbacks;
  },
): AbstractValue {
  const callee = getExpressionSyntax(input.input, input.expression.calleeExpressionId);
  const localHelperCallbacks = {
    getExpressionValue: input.callbacks.getExpressionValue,
    summarizeClassNamesHelperArgs: (
      helperInput: EvaluationContext,
      argumentExpressionIds: string[],
    ) =>
      summarizeClassNamesHelperArgs(
        { ...helperInput, callbacks: input.callbacks },
        argumentExpressionIds,
      ),
    summarizeExpression: input.callbacks.summarizeExpression,
    summarizeIdentifier: input.callbacks.summarizeIdentifier,
  };
  const helperCall = callee
    ? summarizeLocalHelperCall(
        { ...input, callbacks: localHelperCallbacks },
        callee,
        input.expression,
      )
    : undefined;
  if (helperCall) {
    return helperCall;
  }

  const inlineFunctionCall = callee
    ? summarizeInlineFunctionCall(input, callee, input.expression)
    : undefined;
  if (inlineFunctionCall) {
    return inlineFunctionCall;
  }
  if (callee && isClassNamesHelper(callee)) {
    return summarizeClassNamesHelperArgs(input, input.expression.argumentExpressionIds);
  }

  if (input.expression.hasSpreadArgument) {
    return { kind: "unknown", reason: "unsupported-call:spread-argument" };
  }

  const jsonArrayJoin = callee
    ? summarizeJsonArrayJoin(
        { ...input, callbacks: { getExpressionValue: input.callbacks.getExpressionValue } },
        callee,
      )
    : undefined;
  if (jsonArrayJoin) {
    return jsonArrayJoin;
  }

  const arrayJoinTarget = callee
    ? getArrayJoinTarget({ ...input, callbacks: input.callbacks.arrayCallbacks }, callee)
    : undefined;
  if (arrayJoinTarget) {
    return summarizeClassArrayJoin({
      ...input,
      elementExpressionIds: arrayJoinTarget.elementExpressionIds,
      hasSpreadElement: arrayJoinTarget.hasSpreadElement,
      hasOmittedElement: arrayJoinTarget.hasOmittedElement,
      argumentExpressionIds: input.expression.argumentExpressionIds,
      maxStringCombinations: input.maxStringCombinations,
      callbacks: input.callbacks.arrayCallbacks,
    });
  }

  return {
    kind: "unknown",
    reason: `unsupported-call:${callee?.rawText ?? input.expression.rawText}`,
  };
}

export function summarizeClassNamesHelperArgs(
  input: EvaluationContext & { callbacks: CallEvaluationCallbacks },
  argumentExpressionIds: string[],
): AbstractValue {
  const parts = argumentExpressionIds.map((argumentExpressionId) =>
    summarizeClassNamesHelperArg(input, argumentExpressionId),
  );
  return mergeClassSets(parts, "class name helper call");
}

export function summarizeClassNamesHelperArg(
  input: EvaluationContext & { callbacks: CallEvaluationCallbacks },
  expressionId: string,
): AbstractValue {
  const expression = getExpressionSyntax(input.input, expressionId);
  if (!expression) {
    return { kind: "class-set", definite: [], possible: [], unknownDynamic: true };
  }

  const unwrapped = unwrapExpressionSyntax({ input: input.input, expression });
  if (isDefinitelyFalsy(unwrapped)) {
    return { kind: "string-exact", value: "" };
  }

  if (isDefinitelyTruthy(unwrapped) && unwrapped.expressionKind === "boolean-literal") {
    return { kind: "class-set", definite: [], possible: [], unknownDynamic: false };
  }

  const value = input.callbacks.summarizeExpression({
    input: input.input,
    expression: unwrapped,
    depth: input.depth + 1,
    seenExpressionIds: input.seenExpressionIds,
    helperBindings: input.helperBindings,
    allowObjectClassMap: true,
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

function summarizeInlineFunctionCall(
  input: EvaluationContext & { callbacks: CallEvaluationCallbacks },
  callee: ExpressionSyntaxNode,
  callExpression: Extract<ExpressionSyntaxNode, { expressionKind: "call" }>,
): AbstractValue | undefined {
  const unwrappedCallee =
    callee.expressionKind === "wrapper"
      ? (getExpressionSyntax(input.input, callee.innerExpressionId) ?? callee)
      : callee;
  if (
    unwrappedCallee.expressionKind !== "function" ||
    unwrappedCallee.parameterCount > 0 ||
    callExpression.argumentExpressionIds.length > 0 ||
    callExpression.hasSpreadArgument ||
    unwrappedCallee.returnExpressionIds.length === 0
  ) {
    return undefined;
  }

  const returnValues = uniqueSorted(unwrappedCallee.returnExpressionIds)
    .map((returnExpressionId) => getExpressionSyntax(input.input, returnExpressionId))
    .filter((expression): expression is ExpressionSyntaxNode => Boolean(expression))
    .map((returnExpression) =>
      input.callbacks.summarizeExpression({
        input: input.input,
        expression: returnExpression,
        depth: input.depth + 1,
        seenExpressionIds: input.seenExpressionIds,
        helperBindings: input.helperBindings,
      }),
    );
  if (returnValues.length === 0) {
    return undefined;
  }
  if (returnValues.length === 1) {
    return returnValues[0];
  }
  return mergeClassSets(returnValues, "inline function multi-return aggregation");
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
