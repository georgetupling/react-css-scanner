import {
  combineStrings,
  getStringCandidates,
  mergeClassSets,
  toStringValue,
  tokenizeClassNames,
  uniqueSorted,
} from "../../../values/classValueOperations.js";
import type { AbstractValue } from "../../../values/types.js";
import { getExpressionSyntax } from "../expressionSyntaxLookup.js";
import type { ExpressionSyntaxNode } from "../../../../fact-graph/index.js";
import type { SymbolicExpressionEvaluatorInput } from "../../../model/types.js";
import { isAnchorAtOrBefore, resolveLocalValueBindingsForIdentifier } from "./scopeResolution.js";

type EvaluationContext = {
  input: SymbolicExpressionEvaluatorInput;
  depth: number;
  seenExpressionIds: Set<string>;
  helperBindings?: Map<string, AbstractValue>;
};

type IdentifierResolutionCallbacks = {
  getExpressionValue(input: EvaluationContext, expressionId: string): AbstractValue;
  summarizeExpression(
    input: EvaluationContext & { expression: ExpressionSyntaxNode },
  ): AbstractValue;
};

export function summarizeIdentifierExpressionSyntax(
  input: EvaluationContext & {
    expression: Extract<ExpressionSyntaxNode, { expressionKind: "identifier" }>;
    callbacks: IdentifierResolutionCallbacks;
  },
): AbstractValue | undefined {
  const rootOwnerNodeId = input.input.classExpressionSite.emittingComponentNodeId;
  if (!rootOwnerNodeId) {
    return undefined;
  }

  const localBindingNodes = resolveLocalValueBindingsForIdentifier({
    input: input.input,
    rootOwnerNodeId,
    identifierName: input.expression.name,
    targetLocation: input.expression.location,
  });
  for (const binding of localBindingNodes) {
    const bindingValue = summarizeLocalBindingValue({
      input: input.input,
      binding,
      depth: input.depth,
      seenExpressionIds: input.seenExpressionIds,
      helperBindings: input.helperBindings,
      targetLocation: input.expression.location,
      callbacks: input.callbacks,
    });
    if (bindingValue) {
      return bindingValue;
    }

    const targetExpressionId =
      binding.expressionId ?? binding.initializerExpressionId ?? binding.objectExpressionId;
    if (!targetExpressionId) {
      continue;
    }
    const target = getExpressionSyntax(input.input, targetExpressionId);
    if (!target) {
      continue;
    }
    return input.callbacks.summarizeExpression({
      input: input.input,
      expression: target,
      depth: input.depth + 1,
      seenExpressionIds: input.seenExpressionIds,
      helperBindings: input.helperBindings,
    });
  }

  return undefined;
}

export function summarizeImportedIdentifierExpressionSyntax(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "identifier" }>;
  callbacks: IdentifierResolutionCallbacks;
}): { value: AbstractValue; sourceAnchor: ExpressionSyntaxNode["location"] } | undefined {
  const imported = resolveImportedIdentifierExpressionSyntax(input);
  if (!imported) {
    return undefined;
  }

  return {
    value: input.callbacks.summarizeExpression({
      input: input.input,
      expression: imported.expression,
      depth: 1,
      seenExpressionIds: new Set([input.expression.expressionId]),
    }),
    sourceAnchor: imported.binding.location,
  };
}

export function buildImportedIdentifierTokenAnchors(input: {
  input: SymbolicExpressionEvaluatorInput;
  syntax: ExpressionSyntaxNode;
  callbacks: IdentifierResolutionCallbacks;
}): Record<string, ExpressionSyntaxNode["location"][]> | undefined {
  if (input.syntax.expressionKind !== "identifier") {
    return undefined;
  }

  const imported = resolveImportedIdentifierExpressionSyntax({
    input: input.input,
    expression: input.syntax,
  });
  if (!imported) {
    return undefined;
  }

  const value = input.callbacks.summarizeExpression({
    input: input.input,
    expression: imported.expression,
    depth: 1,
    seenExpressionIds: new Set([input.syntax.expressionId]),
  });
  const classNames =
    getStringCandidates(value)?.flatMap((candidate) => tokenizeClassNames(candidate)) ?? [];
  if (classNames.length === 0) {
    return undefined;
  }

  return Object.fromEntries(
    uniqueSorted(classNames).map((className) => [className, [imported.binding.location]] as const),
  );
}

export function resolveImportedIdentifierExpressionSyntax(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "identifier" }>;
}):
  | {
      binding: SymbolicExpressionEvaluatorInput["graph"]["nodes"]["localValueBindings"][number];
      expression: ExpressionSyntaxNode;
    }
  | undefined {
  const binding = resolveImportedLocalValueBinding(input);
  const expressionId = binding?.expressionId ?? binding?.initializerExpressionId;
  const expression = expressionId ? getExpressionSyntax(input.input, expressionId) : undefined;
  return binding && expression ? { binding, expression } : undefined;
}

function resolveImportedLocalValueBinding(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "identifier" }>;
}): SymbolicExpressionEvaluatorInput["graph"]["nodes"]["localValueBindings"][number] | undefined {
  const importEdge = input.input.graph.edges.imports.find(
    (edge) =>
      edge.importerKind === "source" &&
      edge.importerFilePath === input.expression.filePath &&
      edge.importKind === "source" &&
      edge.resolutionStatus === "resolved" &&
      edge.resolvedFilePath &&
      edge.importNames?.some((importName) => importName.localName === input.expression.name),
  );
  const importName = importEdge?.importNames?.find(
    (candidate) => candidate.localName === input.expression.name,
  );
  if (!importEdge?.resolvedFilePath || !importName || importName.bindingKind === "namespace") {
    return undefined;
  }

  const targetLocalName =
    importName.bindingKind === "default" ? "default" : importName.importedName;
  const directBinding = findLocalValueBindingInFile({
    input: input.input,
    filePath: importEdge.resolvedFilePath,
    localName: targetLocalName,
  });
  if (directBinding) {
    return directBinding;
  }

  if (importName.bindingKind === "default") {
    return findSingleModuleValueBinding({
      input: input.input,
      filePath: importEdge.resolvedFilePath,
    });
  }

  return undefined;
}

function findLocalValueBindingInFile(input: {
  input: SymbolicExpressionEvaluatorInput;
  filePath: string;
  localName: string;
}): SymbolicExpressionEvaluatorInput["graph"]["nodes"]["localValueBindings"][number] | undefined {
  const candidates = input.input.graph.nodes.localValueBindings
    .filter(
      (binding) =>
        binding.filePath === input.filePath &&
        binding.localName === input.localName &&
        binding.ownerKind === "source-file",
    )
    .sort((left, right) => left.location.startLine - right.location.startLine);
  return candidates[0];
}

function findSingleModuleValueBinding(input: {
  input: SymbolicExpressionEvaluatorInput;
  filePath: string;
}): SymbolicExpressionEvaluatorInput["graph"]["nodes"]["localValueBindings"][number] | undefined {
  const candidates = input.input.graph.nodes.localValueBindings
    .filter((binding) => binding.filePath === input.filePath && binding.ownerKind === "source-file")
    .sort((left, right) => left.location.startLine - right.location.startLine);
  return candidates.length === 1 ? candidates[0] : undefined;
}

function summarizeLocalBindingValue(
  input: EvaluationContext & {
    binding: SymbolicExpressionEvaluatorInput["graph"]["nodes"]["localValueBindings"][number];
    targetLocation: ExpressionSyntaxNode["location"];
    callbacks: IdentifierResolutionCallbacks;
  },
): AbstractValue | undefined {
  if (input.binding.bindingKind === "let-identifier" && input.binding.expressionId) {
    return summarizeMutableLocalBindingValue(input);
  }

  if (input.binding.bindingKind !== "destructured-property" || !input.binding.objectExpressionId) {
    return undefined;
  }

  const objectExpression = getExpressionSyntax(input.input, input.binding.objectExpressionId);
  if (!objectExpression) {
    return undefined;
  }
  const objectValue = input.callbacks.summarizeExpression({
    input: input.input,
    expression: objectExpression,
    depth: input.depth + 1,
    seenExpressionIds: input.seenExpressionIds,
    helperBindings: input.helperBindings,
  });

  const fallbackValue = input.binding.initializerExpressionId
    ? input.callbacks.getExpressionValue(
        {
          input: input.input,
          depth: input.depth,
          seenExpressionIds: input.seenExpressionIds,
          helperBindings: input.helperBindings,
        },
        input.binding.initializerExpressionId,
      )
    : undefined;

  if (objectExpression.expressionKind === "object-literal" && input.binding.propertyName) {
    const property = objectExpression.properties.find(
      (candidate) =>
        candidate.propertyKind === "property" &&
        candidate.keyKind !== "computed" &&
        candidate.keyText === input.binding.propertyName &&
        Boolean(candidate.valueExpressionId),
    );
    if (property?.valueExpressionId) {
      const propertyExpression = getExpressionSyntax(input.input, property.valueExpressionId);
      if (propertyExpression) {
        const propertyValue = input.callbacks.summarizeExpression({
          input: input.input,
          expression: propertyExpression,
          depth: input.depth + 1,
          seenExpressionIds: input.seenExpressionIds,
          helperBindings: input.helperBindings,
        });
        if (!fallbackValue) {
          return propertyValue;
        }
        return mergeClassSets([propertyValue, fallbackValue], "destructured property with default");
      }
    }
  }

  if (!fallbackValue) {
    return objectValue;
  }
  return mergeClassSets([objectValue, fallbackValue], "destructured property fallback");
}

function summarizeMutableLocalBindingValue(
  input: EvaluationContext & {
    binding: SymbolicExpressionEvaluatorInput["graph"]["nodes"]["localValueBindings"][number];
    targetLocation: ExpressionSyntaxNode["location"];
    callbacks: IdentifierResolutionCallbacks;
  },
): AbstractValue | undefined {
  const values: string[] = [];
  let currentValues = getStringCandidates(
    input.callbacks.getExpressionValue(
      {
        input: input.input,
        depth: input.depth,
        seenExpressionIds: input.seenExpressionIds,
        helperBindings: input.helperBindings,
      },
      input.binding.expressionId!,
    ),
  );
  if (!currentValues) {
    return undefined;
  }
  values.push(...currentValues);

  for (const assignment of input.binding.assignments ?? []) {
    if (
      !isAnchorAtOrBefore({
        candidate: assignment.location,
        target: input.targetLocation,
      })
    ) {
      continue;
    }

    const assignedValues = getStringCandidates(
      input.callbacks.getExpressionValue(
        {
          input: input.input,
          depth: input.depth,
          seenExpressionIds: input.seenExpressionIds,
          helperBindings: input.helperBindings,
        },
        assignment.expressionId,
      ),
    );
    if (!assignedValues) {
      return undefined;
    }

    currentValues =
      assignment.assignmentKind === "append"
        ? combineStrings(currentValues, assignedValues)
        : assignedValues;
    values.push(...currentValues);
  }

  return toStringValue(uniqueSorted(values));
}
