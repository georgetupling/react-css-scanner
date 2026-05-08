import { getStringCandidates, mergeClassSets } from "../../../values/classValueOperations.js";
import type { AbstractValue } from "../../../values/types.js";
import { getExpressionSyntax } from "../expressionSyntaxLookup.js";
import type { ExpressionSyntaxNode } from "../../../../fact-graph/index.js";
import type { JsonStaticValue } from "../../../../workspace-discovery/index.js";
import type { SymbolicExpressionEvaluatorInput } from "../../../model/types.js";
import { getJoinSeparator } from "../expressions/arrayEvaluation.js";

type EvaluationContext = {
  input: SymbolicExpressionEvaluatorInput;
  depth: number;
  seenExpressionIds: Set<string>;
  helperBindings?: Map<string, AbstractValue>;
};

type JsonStaticValueCallbacks = {
  getExpressionValue(input: EvaluationContext, expressionId: string): AbstractValue;
};

export function resolveJsonStaticValueForExpression(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: ExpressionSyntaxNode;
  seenExpressionIds: Set<string>;
  callbacks: JsonStaticValueCallbacks;
}): JsonStaticValue | undefined {
  const seenExpressionIds = new Set(input.seenExpressionIds);
  seenExpressionIds.add(input.expression.expressionId);
  const expression = unwrapExpressionSyntax({
    input: input.input,
    expression: input.expression,
  });

  if (expression.expressionKind === "identifier") {
    return resolveImportedJsonDefaultValue({
      input: input.input,
      expression,
    });
  }

  if (expression.expressionKind === "element-access") {
    return resolveJsonElementAccessValue({
      input: input.input,
      expression,
      seenExpressionIds,
      callbacks: input.callbacks,
    });
  }

  if (expression.expressionKind === "call") {
    return resolveJsonArrayJoinCallValue({
      input: input.input,
      expression,
      seenExpressionIds,
      callbacks: input.callbacks,
    });
  }

  if (expression.expressionKind !== "member-access") {
    return undefined;
  }

  const objectExpression = getExpressionSyntax(input.input, expression.objectExpressionId);
  if (!objectExpression) {
    return undefined;
  }

  const objectValue = resolveJsonStaticValueForExpression({
    input: input.input,
    expression: objectExpression,
    seenExpressionIds,
    callbacks: input.callbacks,
  });
  if (!objectValue || objectValue.kind !== "object") {
    return undefined;
  }

  return (
    objectValue.properties[expression.propertyName] ??
    (objectValue.truncated ? { kind: "unknown", reason: "json-object-truncated" } : undefined)
  );
}

export function summarizeJsonArrayJoin(
  input: EvaluationContext & {
    expression: Extract<ExpressionSyntaxNode, { expressionKind: "call" }>;
    callbacks: JsonStaticValueCallbacks;
  },
  callee: ExpressionSyntaxNode,
): AbstractValue | undefined {
  const jsonValue =
    callee.expressionKind === "member-access" && callee.propertyName === "join"
      ? resolveJsonArrayJoinCallValue({
          input: input.input,
          expression: input.expression,
          seenExpressionIds: input.seenExpressionIds,
          callbacks: input.callbacks,
        })
      : undefined;
  return jsonValue ? jsonStaticValueToAbstractValue(jsonValue) : undefined;
}

export function jsonStaticValueToAbstractValue(value: JsonStaticValue): AbstractValue {
  switch (value.kind) {
    case "string":
      return { kind: "string-exact", value: value.value };
    case "array":
      return value.truncated
        ? { kind: "unknown", reason: "json-array-truncated" }
        : mergeClassSets(value.elements.map(jsonStaticValueToAbstractValue), "json array values");
    case "object":
      return value.truncated
        ? { kind: "unknown", reason: "json-object-truncated" }
        : mergeClassSets(
            Object.values(value.properties).map(jsonStaticValueToAbstractValue),
            "json object values",
          );
    case "unknown":
      return { kind: "unknown", reason: value.reason };
    default:
      return { kind: "unknown", reason: `unsupported-json-${value.kind}-class-token` };
  }
}

function resolveJsonElementAccessValue(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "element-access" }>;
  seenExpressionIds: Set<string>;
  callbacks: JsonStaticValueCallbacks;
}): JsonStaticValue | undefined {
  if (!input.expression.argumentExpressionId) {
    return undefined;
  }

  const objectExpression = getExpressionSyntax(input.input, input.expression.objectExpressionId);
  if (!objectExpression) {
    return undefined;
  }

  const objectValue = resolveJsonStaticValueForExpression({
    input: input.input,
    expression: objectExpression,
    seenExpressionIds: input.seenExpressionIds,
    callbacks: input.callbacks,
  });
  if (!objectValue) {
    return undefined;
  }

  const argumentValue = input.callbacks.getExpressionValue(
    {
      input: input.input,
      depth: 0,
      seenExpressionIds: input.seenExpressionIds,
    },
    input.expression.argumentExpressionId,
  );
  const propertyNames = getStringCandidates(argumentValue);
  if (!propertyNames || propertyNames.length === 0) {
    return objectValue.kind === "object" && objectValue.truncated
      ? { kind: "unknown", reason: "json-object-truncated" }
      : undefined;
  }

  if (objectValue.kind !== "object") {
    return undefined;
  }

  const values = propertyNames.map(
    (propertyName) =>
      objectValue.properties[propertyName] ??
      (objectValue.truncated
        ? ({ kind: "unknown", reason: "json-object-truncated" } satisfies JsonStaticValue)
        : ({ kind: "unknown", reason: "unresolved-json-property" } satisfies JsonStaticValue)),
  );
  if (values.length === 1) {
    return values[0];
  }

  return {
    kind: "array",
    elements: values,
  };
}

function resolveJsonArrayJoinCallValue(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "call" }>;
  seenExpressionIds: Set<string>;
  callbacks: JsonStaticValueCallbacks;
}): JsonStaticValue | undefined {
  const callee = getExpressionSyntax(input.input, input.expression.calleeExpressionId);
  if (!callee || callee.expressionKind !== "member-access" || callee.propertyName !== "join") {
    return undefined;
  }

  const targetExpression = getExpressionSyntax(input.input, callee.objectExpressionId);
  if (!targetExpression) {
    return undefined;
  }

  const targetValue = resolveJsonStaticValueForExpression({
    input: input.input,
    expression: targetExpression,
    seenExpressionIds: input.seenExpressionIds,
    callbacks: input.callbacks,
  });
  if (!targetValue || targetValue.kind !== "array") {
    return undefined;
  }

  const separator = getJoinSeparator(input.input, input.expression.argumentExpressionIds);
  if (separator === undefined) {
    return { kind: "unknown", reason: "unsupported-join-separator" };
  }

  if (targetValue.truncated) {
    return { kind: "unknown", reason: "json-array-truncated" };
  }

  if (/^\s*$/.test(separator)) {
    return targetValue;
  }

  const parts: string[] = [];
  for (const element of targetValue.elements) {
    if (element.kind !== "string") {
      return { kind: "unknown", reason: "non-whitespace-json-join-element" };
    }
    parts.push(element.value);
  }

  return {
    kind: "string",
    value: parts.join(separator),
  };
}

function resolveImportedJsonDefaultValue(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "identifier" }>;
}): JsonStaticValue | undefined {
  const importEdge = input.input.graph.edges.imports.find(
    (edge) =>
      edge.importerKind === "source" &&
      edge.importerFilePath === input.expression.filePath &&
      edge.importKind === "json" &&
      edge.resolutionStatus === "resolved" &&
      edge.resolvedFilePath &&
      edge.importNames?.some(
        (importName) =>
          importName.localName === input.expression.name &&
          importName.bindingKind === "default" &&
          importName.importedName === "default",
      ),
  );
  if (!importEdge?.resolvedFilePath) {
    return undefined;
  }

  const jsonModule = input.input.graph.nodes.modules.find(
    (moduleNode) =>
      moduleNode.moduleKind === "json" && moduleNode.filePath === importEdge.resolvedFilePath,
  );
  return jsonModule?.jsonExports?.find((exportFact) => exportFact.exportedName === "default")
    ?.value;
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
