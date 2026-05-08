import {
  getStringCandidates,
  mergeClassSets,
  tokenizeClassNames,
  uniqueSorted,
} from "../../../values/classValueOperations.js";
import type { AbstractValue } from "../../../values/types.js";
import { getExpressionSyntax } from "../expressionSyntaxLookup.js";
import { isDefinitelyFalsy, isDefinitelyTruthy } from "../predicates/staticExpressionPredicates.js";
import type { ExpressionSyntaxNode } from "../../../../fact-graph/index.js";
import type { JsonStaticValue } from "../../../../workspace-discovery/index.js";
import type { SymbolicExpressionEvaluatorInput } from "../../../model/types.js";
import { resolveLocalValueBindingsForIdentifier } from "../bindings/scopeResolution.js";

type EvaluationContext = {
  input: SymbolicExpressionEvaluatorInput;
  depth: number;
  seenExpressionIds: Set<string>;
  helperBindings?: Map<string, AbstractValue>;
};

type ImportedIdentifierResolution = {
  expression: ExpressionSyntaxNode;
};

export type ObjectMemberEvaluationCallbacks = {
  evaluateExpression(
    input: EvaluationContext & { expression: ExpressionSyntaxNode },
  ): AbstractValue;
  getExpressionValue(input: EvaluationContext, expressionId: string): AbstractValue;
  jsonStaticValueToAbstractValue(value: JsonStaticValue): AbstractValue;
  resolveImportedIdentifierExpressionSyntax(input: {
    input: SymbolicExpressionEvaluatorInput;
    expression: Extract<ExpressionSyntaxNode, { expressionKind: "identifier" }>;
  }): ImportedIdentifierResolution | undefined;
  resolveJsonStaticValueForExpression(input: {
    input: SymbolicExpressionEvaluatorInput;
    expression: ExpressionSyntaxNode;
    seenExpressionIds: Set<string>;
  }): JsonStaticValue | undefined;
};

export function summarizeObjectExpressionSyntax(
  input: EvaluationContext & {
    expression: Extract<ExpressionSyntaxNode, { expressionKind: "object-literal" }>;
  },
): AbstractValue {
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

export function summarizeMemberAccessExpressionSyntax(
  input: EvaluationContext & {
    expression: Extract<ExpressionSyntaxNode, { expressionKind: "member-access" }>;
    callbacks: ObjectMemberEvaluationCallbacks;
  },
): AbstractValue {
  const jsonValue = input.callbacks.resolveJsonStaticValueForExpression({
    input: input.input,
    expression: input.expression,
    seenExpressionIds: input.seenExpressionIds,
  });
  if (jsonValue) {
    return input.callbacks.jsonStaticValueToAbstractValue(jsonValue);
  }

  const objectExpression = getExpressionSyntax(input.input, input.expression.objectExpressionId);
  const objectLiteral = objectExpression
    ? resolveObjectLiteralExpressionSyntax({
        ...input,
        expression: objectExpression,
        callbacks: input.callbacks,
      })
    : undefined;
  if (!objectLiteral) {
    return { kind: "unknown", reason: "unresolved-member-access" };
  }

  const property = objectLiteral.properties.find(
    (candidate) =>
      candidate.propertyKind === "property" &&
      candidate.keyKind !== "computed" &&
      candidate.keyText === input.expression.propertyName,
  );
  if (!property?.valueExpressionId) {
    return { kind: "unknown", reason: "unresolved-member-access" };
  }

  const propertyExpression = getExpressionSyntax(input.input, property.valueExpressionId);
  if (!propertyExpression) {
    return { kind: "unknown", reason: "missing-expression-syntax" };
  }

  return input.callbacks.evaluateExpression({
    input: input.input,
    expression: propertyExpression,
    depth: input.depth + 1,
    seenExpressionIds: input.seenExpressionIds,
    helperBindings: input.helperBindings,
  });
}

export function summarizeElementAccessExpressionSyntax(
  input: EvaluationContext & {
    expression: Extract<ExpressionSyntaxNode, { expressionKind: "element-access" }>;
    callbacks: ObjectMemberEvaluationCallbacks;
  },
): AbstractValue {
  if (!input.expression.argumentExpressionId) {
    return { kind: "unknown", reason: "unresolved-element-access-key" };
  }

  const jsonValue = input.callbacks.resolveJsonStaticValueForExpression({
    input: input.input,
    expression: input.expression,
    seenExpressionIds: input.seenExpressionIds,
  });
  if (jsonValue) {
    return input.callbacks.jsonStaticValueToAbstractValue(jsonValue);
  }

  const objectExpression = getExpressionSyntax(input.input, input.expression.objectExpressionId);
  const objectLiteral = objectExpression
    ? resolveObjectLiteralExpressionSyntax({
        ...input,
        expression: objectExpression,
        callbacks: input.callbacks,
      })
    : undefined;
  if (!objectLiteral) {
    return { kind: "unknown", reason: "unresolved-element-access-object" };
  }

  const argumentValue = input.callbacks.getExpressionValue(
    {
      input: input.input,
      depth: input.depth + 1,
      seenExpressionIds: input.seenExpressionIds,
      helperBindings: input.helperBindings,
    },
    input.expression.argumentExpressionId,
  );
  const propertyNames = getStringCandidates(argumentValue);
  if (!propertyNames || propertyNames.length === 0) {
    return summarizeAllStaticObjectLiteralPropertyValues({
      input,
      objectLiteral,
      reason: "element access object map with unresolved key",
      keyResolutionIsUnknownDynamic: isDynamicElementAccessKeyUncertainty(argumentValue),
    });
  }

  const propertyValues: AbstractValue[] = [];
  for (const propertyName of propertyNames) {
    const property = objectLiteral.properties.find(
      (candidate) =>
        candidate.propertyKind === "property" &&
        candidate.keyKind !== "computed" &&
        candidate.keyText === propertyName &&
        Boolean(candidate.valueExpressionId),
    );
    if (!property?.valueExpressionId) {
      propertyValues.push({ kind: "unknown", reason: "unresolved-element-access-property" });
      continue;
    }

    propertyValues.push(
      input.callbacks.getExpressionValue(
        {
          input: input.input,
          depth: input.depth + 1,
          seenExpressionIds: input.seenExpressionIds,
          helperBindings: input.helperBindings,
        },
        property.valueExpressionId,
      ),
    );
  }

  return mergeClassSets(propertyValues, "element access object map");
}

function summarizeAllStaticObjectLiteralPropertyValues(input: {
  input: EvaluationContext & {
    expression: Extract<ExpressionSyntaxNode, { expressionKind: "element-access" }>;
    callbacks: ObjectMemberEvaluationCallbacks;
  };
  objectLiteral: Extract<ExpressionSyntaxNode, { expressionKind: "object-literal" }>;
  reason: string;
  keyResolutionIsUnknownDynamic?: boolean;
}): AbstractValue {
  const propertyValues: AbstractValue[] = [];
  let unknownDynamic =
    Boolean(input.keyResolutionIsUnknownDynamic) ||
    input.objectLiteral.hasSpreadProperty ||
    input.objectLiteral.hasUnsupportedProperty;

  for (const property of input.objectLiteral.properties) {
    if (
      property.propertyKind !== "property" ||
      property.keyKind === "computed" ||
      !property.valueExpressionId
    ) {
      unknownDynamic = true;
      continue;
    }

    propertyValues.push(
      input.input.callbacks.getExpressionValue(
        {
          input: input.input.input,
          depth: input.input.depth + 1,
          seenExpressionIds: input.input.seenExpressionIds,
          helperBindings: input.input.helperBindings,
        },
        property.valueExpressionId,
      ),
    );
  }

  if (propertyValues.length === 0) {
    return { kind: "unknown", reason: "unresolved-element-access-key" };
  }

  const merged = mergeClassSets(propertyValues, input.reason);
  if (merged.kind !== "class-set") {
    return merged;
  }

  return {
    ...merged,
    definite: [],
    possible: uniqueSorted([...merged.definite, ...merged.possible]),
    unknownDynamic: merged.unknownDynamic || unknownDynamic,
  };
}

function isDynamicElementAccessKeyUncertainty(argumentValue: AbstractValue): boolean {
  return (
    argumentValue.kind === "unknown" &&
    (argumentValue.reason === "class-name-resolution-cycle" ||
      argumentValue.reason === "class-name-resolution-budget-exceeded")
  );
}

export function resolveObjectLiteralExpressionSyntax(
  input: EvaluationContext & {
    expression: ExpressionSyntaxNode;
    callbacks: ObjectMemberEvaluationCallbacks;
  },
): Extract<ExpressionSyntaxNode, { expressionKind: "object-literal" }> | undefined {
  if (input.depth > (input.input.options.maxExpressionDepth ?? 100)) {
    return undefined;
  }

  if (input.seenExpressionIds.has(input.expression.expressionId)) {
    return undefined;
  }

  const seenExpressionIds = new Set(input.seenExpressionIds);
  seenExpressionIds.add(input.expression.expressionId);
  const unwrapped = unwrapExpressionSyntax(input);
  if (unwrapped.expressionKind === "object-literal") {
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
    const resolved = resolveObjectLiteralExpressionSyntax({
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
    return resolveObjectLiteralExpressionSyntax({
      ...input,
      expression: imported.expression,
      depth: input.depth + 1,
      seenExpressionIds,
    });
  }

  return undefined;
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
