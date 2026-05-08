import { mergeClassSets, uniqueSorted } from "../../../values/classValueOperations.js";
import type { AbstractValue } from "../../../values/types.js";
import { getExpressionSyntax } from "../expressionSyntaxLookup.js";
import type { ExpressionSyntaxNode } from "../../../../fact-graph/index.js";
import type { SymbolicExpressionEvaluatorInput } from "../../../model/types.js";
import { collectOwnerNodeIds } from "./scopeResolution.js";

type EvaluationContext = {
  input: SymbolicExpressionEvaluatorInput;
  depth: number;
  seenExpressionIds: Set<string>;
  helperBindings?: Map<string, AbstractValue>;
};

type LocalHelperEvaluationCallbacks = {
  getExpressionValue(input: EvaluationContext, expressionId: string): AbstractValue;
  summarizeClassNamesHelperArgs(
    input: EvaluationContext,
    argumentExpressionIds: string[],
  ): AbstractValue;
  summarizeExpression(
    input: EvaluationContext & { expression: ExpressionSyntaxNode },
  ): AbstractValue;
  summarizeIdentifier(
    input: EvaluationContext & {
      expression: Extract<ExpressionSyntaxNode, { expressionKind: "identifier" }>;
    },
  ): AbstractValue | undefined;
};

export function summarizeLocalHelperCall(
  input: EvaluationContext & {
    expression: Extract<ExpressionSyntaxNode, { expressionKind: "call" }>;
    callbacks: LocalHelperEvaluationCallbacks;
  },
  callee: ExpressionSyntaxNode,
  callExpression: Extract<ExpressionSyntaxNode, { expressionKind: "call" }>,
): AbstractValue | undefined {
  if (callee.expressionKind !== "identifier") {
    return undefined;
  }

  const helper = resolveHelperDefinitionForCallee(input.input, callee.name);
  if (
    !helper?.returnExpressionId &&
    (!helper?.returnExpressionNodeIds || helper.returnExpressionNodeIds.length === 0)
  ) {
    return undefined;
  }

  if (isClassArrayFilterJoinHelper({ input: input.input, helper })) {
    return input.callbacks.summarizeClassNamesHelperArgs(
      input,
      callExpression.argumentExpressionIds,
    );
  }

  const returnExpressionIds = uniqueSorted([
    ...(helper.returnExpressionId ? [helper.returnExpressionId] : []),
    ...(helper.returnExpressionNodeIds ?? []),
  ]);

  const scopedBindings = new Map(input.helperBindings ?? []);
  const parameterArguments = new Map<
    string,
    { argumentExpression?: ExpressionSyntaxNode; argumentValue: AbstractValue }
  >();
  const argumentExpressions = callExpression.argumentExpressionIds.map((argumentExpressionId) =>
    getExpressionSyntax(input.input, argumentExpressionId),
  );
  const argumentValues = callExpression.argumentExpressionIds.map((argumentExpressionId) =>
    input.callbacks.getExpressionValue(
      {
        input: input.input,
        depth: input.depth + 1,
        seenExpressionIds: input.seenExpressionIds,
        helperBindings: input.helperBindings,
      },
      argumentExpressionId,
    ),
  );
  if (helper.restParameterName) {
    const fixedParameterCount = helper.parameters.filter(
      (parameter) => parameter.parameterKind !== "rest",
    ).length;
    scopedBindings.set(
      helper.restParameterName,
      mergeClassSets(
        argumentValues.slice(fixedParameterCount),
        `helper rest parameter "${helper.restParameterName}"`,
      ),
    );
  }
  for (let index = 0; index < helper.parameters.length; index += 1) {
    const parameter = helper.parameters[index];
    const argumentValue =
      argumentValues[index] ??
      ({ kind: "unknown", reason: "missing-helper-argument" } as AbstractValue);
    if (parameter.parameterKind === "identifier") {
      scopedBindings.set(parameter.localName, argumentValue);
      parameterArguments.set(parameter.localName, {
        ...(argumentExpressions[index] ? { argumentExpression: argumentExpressions[index] } : {}),
        argumentValue,
      });
      continue;
    }

    if (parameter.parameterKind === "destructured-object") {
      const argumentExpression = argumentExpressions[index];
      for (const property of parameter.properties) {
        const fallback =
          property.initializerExpressionId !== undefined
            ? input.callbacks.getExpressionValue(
                {
                  input: input.input,
                  depth: input.depth + 1,
                  seenExpressionIds: input.seenExpressionIds,
                  helperBindings: input.helperBindings,
                },
                property.initializerExpressionId,
              )
            : ({
                kind: "unknown",
                reason: "missing-destructured-helper-property",
              } as AbstractValue);
        const value = resolveDestructuredPropertyValue({
          input: input.input,
          argumentExpression,
          argumentValue,
          propertyName: property.propertyName,
          fallback,
          mergeWithFallback: property.initializerExpressionId !== undefined,
          depth: input.depth + 1,
          seenExpressionIds: input.seenExpressionIds,
          helperBindings: input.helperBindings,
          callbacks: input.callbacks,
        });
        scopedBindings.set(property.localName, value);
      }
    }
  }
  bindHelperLocalDestructuredProperties({
    input: input.input,
    helper,
    scopedBindings,
    parameterArguments,
    depth: input.depth + 1,
    seenExpressionIds: input.seenExpressionIds,
    callbacks: input.callbacks,
  });

  const returnValues = returnExpressionIds
    .map((returnExpressionId) => getExpressionSyntax(input.input, returnExpressionId))
    .filter((expression): expression is ExpressionSyntaxNode => Boolean(expression))
    .map((returnExpression) =>
      input.callbacks.summarizeExpression({
        input: input.input,
        expression: returnExpression,
        depth: input.depth + 1,
        seenExpressionIds: input.seenExpressionIds,
        helperBindings: scopedBindings,
      }),
    );
  if (returnValues.length === 0) {
    return undefined;
  }
  if (returnValues.length === 1) {
    return returnValues[0];
  }
  return mergeClassSets(returnValues, "helper multi-return aggregation");
}

function resolveHelperDefinitionForCallee(
  input: SymbolicExpressionEvaluatorInput,
  helperName: string,
): SymbolicExpressionEvaluatorInput["graph"]["nodes"]["helperDefinitions"][number] | undefined {
  const rootOwnerNodeId = input.classExpressionSite.emittingComponentNodeId;
  if (!rootOwnerNodeId) {
    return undefined;
  }

  const moduleOwnerNodeId = input.graph.indexes.moduleNodeIdByFilePath.get(
    input.classExpressionSite.filePath,
  );
  const ownerNodeIds = uniqueSorted([
    ...collectOwnerNodeIds(input, rootOwnerNodeId),
    ...(moduleOwnerNodeId ? [moduleOwnerNodeId] : []),
  ]);
  const localHelper = findHelperByOwnerNodeIds(input, ownerNodeIds, helperName);
  if (localHelper) {
    return localHelper;
  }

  const importedModuleNodeIds = input.graph.edges.imports
    .filter(
      (edge) =>
        edge.importerKind === "source" &&
        edge.importKind === "source" &&
        edge.importerFilePath === input.classExpressionSite.filePath &&
        edge.resolutionStatus === "resolved" &&
        Boolean(edge.resolvedFilePath),
    )
    .map((edge) =>
      edge.resolvedFilePath
        ? input.graph.indexes.moduleNodeIdByFilePath.get(edge.resolvedFilePath)
        : undefined,
    )
    .filter((nodeId): nodeId is string => Boolean(nodeId));

  return findHelperByOwnerNodeIds(input, uniqueSorted(importedModuleNodeIds), helperName);
}

function findHelperByOwnerNodeIds(
  input: SymbolicExpressionEvaluatorInput,
  ownerNodeIds: string[],
  helperName: string,
): SymbolicExpressionEvaluatorInput["graph"]["nodes"]["helperDefinitions"][number] | undefined {
  const helperNodeIds = ownerNodeIds.flatMap(
    (ownerNodeId) =>
      input.graph.indexes.helperDefinitionNodeIdsByOwnerNodeId.get(ownerNodeId) ?? [],
  );
  return [...new Set(helperNodeIds)]
    .map((helperNodeId) => input.graph.indexes.nodesById.get(helperNodeId))
    .filter(isHelperDefinitionNode)
    .find((node) => node.helperName === helperName);
}

function isHelperDefinitionNode(
  node: ReturnType<SymbolicExpressionEvaluatorInput["graph"]["indexes"]["nodesById"]["get"]>,
): node is SymbolicExpressionEvaluatorInput["graph"]["nodes"]["helperDefinitions"][number] {
  return Boolean(node && node.kind === "helper-definition");
}

function bindHelperLocalDestructuredProperties(input: {
  input: SymbolicExpressionEvaluatorInput;
  helper: SymbolicExpressionEvaluatorInput["graph"]["nodes"]["helperDefinitions"][number];
  scopedBindings: Map<string, AbstractValue>;
  parameterArguments: Map<
    string,
    { argumentExpression?: ExpressionSyntaxNode; argumentValue: AbstractValue }
  >;
  depth: number;
  seenExpressionIds: Set<string>;
  callbacks: LocalHelperEvaluationCallbacks;
}): void {
  const bindingNodeIds =
    input.input.graph.indexes.localValueBindingNodeIdsByOwnerNodeId.get(input.helper.id) ?? [];
  for (const bindingNodeId of bindingNodeIds) {
    const binding = input.input.graph.indexes.nodesById.get(bindingNodeId);
    if (
      !binding ||
      binding.kind !== "local-value-binding" ||
      binding.bindingKind !== "destructured-property" ||
      !binding.objectExpressionId ||
      !binding.propertyName
    ) {
      continue;
    }

    const objectExpression = getExpressionSyntax(input.input, binding.objectExpressionId);
    if (!objectExpression || objectExpression.expressionKind !== "identifier") {
      continue;
    }

    const parameterArgument = input.parameterArguments.get(objectExpression.name);
    if (!parameterArgument) {
      continue;
    }

    const fallback =
      binding.initializerExpressionId !== undefined
        ? input.callbacks.getExpressionValue(
            {
              input: input.input,
              depth: input.depth + 1,
              seenExpressionIds: input.seenExpressionIds,
              helperBindings: input.scopedBindings,
            },
            binding.initializerExpressionId,
          )
        : ({
            kind: "unknown",
            reason: "missing-destructured-helper-local-property",
          } as AbstractValue);
    const value = resolveDestructuredPropertyValue({
      input: input.input,
      argumentExpression: parameterArgument.argumentExpression,
      argumentValue: parameterArgument.argumentValue,
      propertyName: binding.propertyName,
      fallback,
      mergeWithFallback: binding.initializerExpressionId !== undefined,
      depth: input.depth + 1,
      seenExpressionIds: input.seenExpressionIds,
      helperBindings: input.scopedBindings,
      callbacks: input.callbacks,
    });
    input.scopedBindings.set(binding.localName, value);
  }
}

function resolveDestructuredPropertyValue(
  input: EvaluationContext & {
    argumentExpression: ExpressionSyntaxNode | undefined;
    argumentValue: AbstractValue;
    propertyName: string;
    fallback: AbstractValue;
    mergeWithFallback: boolean;
    callbacks: LocalHelperEvaluationCallbacks;
  },
): AbstractValue {
  if (!input.argumentExpression || input.argumentExpression.expressionKind !== "object-literal") {
    return input.mergeWithFallback
      ? mergeClassSets(
          [input.argumentValue, input.fallback],
          "destructured helper argument with default",
        )
      : input.argumentValue;
  }

  const shorthand = input.argumentExpression.properties.find(
    (candidate) =>
      candidate.propertyKind === "shorthand" && candidate.keyText === input.propertyName,
  );
  if (shorthand?.keyText) {
    const shorthandIdentifier: Extract<ExpressionSyntaxNode, { expressionKind: "identifier" }> = {
      ...input.argumentExpression,
      expressionKind: "identifier",
      name: shorthand.keyText,
    };
    const shorthandValue = input.callbacks.summarizeIdentifier({
      input: input.input,
      expression: shorthandIdentifier,
      depth: input.depth + 1,
      seenExpressionIds: input.seenExpressionIds,
      helperBindings: input.helperBindings,
    });
    if (!shorthandValue) {
      return input.mergeWithFallback
        ? mergeClassSets(
            [
              { kind: "unknown", reason: "unresolved-destructured-helper-shorthand" },
              input.fallback,
            ],
            "destructured helper shorthand fallback",
          )
        : { kind: "unknown", reason: "unresolved-destructured-helper-shorthand" };
    }
    return input.mergeWithFallback
      ? mergeClassSets(
          [shorthandValue, input.fallback],
          "destructured helper shorthand with default",
        )
      : shorthandValue;
  }

  const property = input.argumentExpression.properties.find(
    (candidate) =>
      candidate.propertyKind === "property" && candidate.keyText === input.propertyName,
  );
  if (!property?.valueExpressionId) {
    return input.fallback;
  }

  const propertyExpression = getExpressionSyntax(input.input, property.valueExpressionId);
  if (!propertyExpression) {
    return input.mergeWithFallback
      ? mergeClassSets(
          [{ kind: "unknown", reason: "unresolved-destructured-helper-property" }, input.fallback],
          "destructured helper property fallback",
        )
      : { kind: "unknown", reason: "unresolved-destructured-helper-property" };
  }

  const propertyValue = input.callbacks.summarizeExpression({
    input: input.input,
    expression: propertyExpression,
    depth: input.depth + 1,
    seenExpressionIds: input.seenExpressionIds,
    helperBindings: input.helperBindings,
  });
  return input.mergeWithFallback
    ? mergeClassSets([propertyValue, input.fallback], "destructured helper property with default")
    : propertyValue;
}

function isClassArrayFilterJoinHelper(input: {
  input: SymbolicExpressionEvaluatorInput;
  helper: SymbolicExpressionEvaluatorInput["graph"]["nodes"]["helperDefinitions"][number];
}): boolean {
  const restParameterName = input.helper.restParameterName;
  if (!restParameterName || !input.helper.returnExpressionId) {
    return false;
  }

  const returnExpression = getExpressionSyntax(input.input, input.helper.returnExpressionId);
  if (!returnExpression || returnExpression.expressionKind !== "call") {
    return false;
  }

  const joinCallee = getExpressionSyntax(input.input, returnExpression.calleeExpressionId);
  if (
    !joinCallee ||
    joinCallee.expressionKind !== "member-access" ||
    joinCallee.propertyName !== "join"
  ) {
    return false;
  }

  const filterCall = getExpressionSyntax(input.input, joinCallee.objectExpressionId);
  if (!filterCall || filterCall.expressionKind !== "call") {
    return false;
  }

  const filterCallee = getExpressionSyntax(input.input, filterCall.calleeExpressionId);
  if (
    !filterCallee ||
    filterCallee.expressionKind !== "member-access" ||
    filterCallee.propertyName !== "filter"
  ) {
    return false;
  }

  const filterObject = getExpressionSyntax(input.input, filterCallee.objectExpressionId);
  if (
    !filterObject ||
    filterObject.expressionKind !== "identifier" ||
    filterObject.name !== restParameterName
  ) {
    return false;
  }

  if (filterCall.argumentExpressionIds.length === 0) {
    return true;
  }

  if (filterCall.argumentExpressionIds.length === 1) {
    const arg = getExpressionSyntax(input.input, filterCall.argumentExpressionIds[0]);
    if (arg?.expressionKind === "identifier" && arg.name === "Boolean") {
      return true;
    }
  }

  return false;
}
