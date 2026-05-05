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
import { conditionId, externalContributionId } from "../ids.js";
import type { ExternalClassContribution } from "../types.js";
import type { SymbolicExpressionEvaluator, SymbolicExpressionEvaluatorInput } from "../types.js";

const MAX_STRING_COMBINATIONS = 32;

type ClassArrayJoinTarget = {
  elementExpressionIds: string[];
  hasSpreadElement: boolean;
  hasOmittedElement: boolean;
};

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
    const tokenAnchors = buildImportedIdentifierTokenAnchors({
      input,
      syntax: input.expressionSyntax,
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
      });
      if (resolved) {
        return resolved;
      }
      const imported = summarizeImportedIdentifierExpressionSyntax({
        input: input.input,
        expression,
      });
      if (imported) {
        return imported.value;
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
      });

    case "element-access":
      return summarizeElementAccessExpressionSyntax({
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

function summarizeIdentifierExpressionSyntax(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "identifier" }>;
  depth: number;
  seenExpressionIds: Set<string>;
  helperBindings?: Map<string, AbstractValue>;
}): AbstractValue | undefined {
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
    return summarizeNormalizedClassExpression({
      input: input.input,
      expression: target,
      depth: input.depth + 1,
      seenExpressionIds: input.seenExpressionIds,
      helperBindings: input.helperBindings,
    });
  }

  return undefined;
}

function summarizeImportedIdentifierExpressionSyntax(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "identifier" }>;
}): { value: AbstractValue; sourceAnchor: ExpressionSyntaxNode["location"] } | undefined {
  const imported = resolveImportedIdentifierLiteral(input);
  if (!imported) {
    return undefined;
  }

  return {
    value: { kind: "string-exact", value: imported.value },
    sourceAnchor: imported.sourceAnchor,
  };
}

function buildImportedIdentifierTokenAnchors(input: {
  input: SymbolicExpressionEvaluatorInput;
  syntax: ExpressionSyntaxNode;
}): Record<string, ExpressionSyntaxNode["location"][]> | undefined {
  if (input.syntax.expressionKind !== "identifier") {
    return undefined;
  }

  const imported = resolveImportedIdentifierLiteral({
    input: input.input,
    expression: input.syntax,
  });
  if (!imported) {
    return undefined;
  }

  const classNames = tokenizeClassNames(imported.value);
  if (classNames.length === 0) {
    return undefined;
  }

  return Object.fromEntries(
    classNames.map((className) => [className, [imported.sourceAnchor]] as const),
  );
}

function resolveImportedIdentifierLiteral(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "identifier" }>;
}): { value: string; sourceAnchor: ExpressionSyntaxNode["location"] } | undefined {
  void input;
  return undefined;
}

function summarizeLocalBindingValue(input: {
  input: SymbolicExpressionEvaluatorInput;
  binding: SymbolicExpressionEvaluatorInput["graph"]["nodes"]["localValueBindings"][number];
  depth: number;
  seenExpressionIds: Set<string>;
  helperBindings?: Map<string, AbstractValue>;
}): AbstractValue | undefined {
  if (input.binding.bindingKind !== "destructured-property" || !input.binding.objectExpressionId) {
    return undefined;
  }

  const objectExpression = getExpressionSyntax(input.input, input.binding.objectExpressionId);
  if (!objectExpression) {
    return undefined;
  }
  const objectValue = summarizeNormalizedClassExpression({
    input: input.input,
    expression: objectExpression,
    depth: input.depth + 1,
    seenExpressionIds: input.seenExpressionIds,
    helperBindings: input.helperBindings,
  });

  const fallbackValue = input.binding.initializerExpressionId
    ? getExpressionValue(
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
        const propertyValue = summarizeNormalizedClassExpression({
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

function collectOwnerNodeIds(
  input: SymbolicExpressionEvaluatorInput,
  rootOwnerNodeId: string,
): string[] {
  const queue = [rootOwnerNodeId];
  const seen = new Set<string>();
  const owners: string[] = [];

  while (queue.length > 0) {
    const ownerNodeId = queue.shift();
    if (!ownerNodeId || seen.has(ownerNodeId)) {
      continue;
    }
    seen.add(ownerNodeId);
    owners.push(ownerNodeId);

    const helperNodeIds =
      input.graph.indexes.helperDefinitionNodeIdsByOwnerNodeId.get(ownerNodeId) ?? [];
    for (const helperNodeId of helperNodeIds) {
      if (!seen.has(helperNodeId)) {
        queue.push(helperNodeId);
      }
    }
  }

  return owners;
}

function isAnchorAtOrBefore(input: {
  candidate: ExpressionSyntaxNode["location"];
  target: ExpressionSyntaxNode["location"];
}): boolean {
  if (input.candidate.filePath !== input.target.filePath) {
    return false;
  }

  if (input.candidate.startLine < input.target.startLine) {
    return true;
  }
  if (input.candidate.startLine > input.target.startLine) {
    return false;
  }

  return input.candidate.startColumn <= input.target.startColumn;
}

function compareScopeSpecificityForTarget(input: {
  leftScope: ExpressionSyntaxNode["location"];
  rightScope: ExpressionSyntaxNode["location"];
  target: ExpressionSyntaxNode["location"];
}): number {
  const leftContains = doesScopeContainTarget({
    scope: input.leftScope,
    target: input.target,
  });
  const rightContains = doesScopeContainTarget({
    scope: input.rightScope,
    target: input.target,
  });
  if (leftContains && !rightContains) {
    return -1;
  }
  if (!leftContains && rightContains) {
    return 1;
  }

  if (leftContains && rightContains) {
    const leftSpan = estimateAnchorSpan(input.leftScope);
    const rightSpan = estimateAnchorSpan(input.rightScope);
    if (leftSpan !== rightSpan) {
      return leftSpan - rightSpan;
    }
  }

  return 0;
}

function doesScopeContainTarget(input: {
  scope: ExpressionSyntaxNode["location"];
  target: ExpressionSyntaxNode["location"];
}): boolean {
  if (input.scope.filePath !== input.target.filePath) {
    return false;
  }

  const scopeStart = toAnchorPositionValue(input.scope.startLine, input.scope.startColumn);
  const scopeEnd = toAnchorPositionValue(
    input.scope.endLine ?? input.scope.startLine,
    input.scope.endColumn ?? input.scope.startColumn,
  );
  const targetPosition = toAnchorPositionValue(input.target.startLine, input.target.startColumn);
  return scopeStart <= targetPosition && targetPosition <= scopeEnd;
}

function sourceAnchorContains(
  containing: ExpressionSyntaxNode["location"],
  contained: ExpressionSyntaxNode["location"],
): boolean {
  if (containing.filePath !== contained.filePath) {
    return false;
  }

  const containingStart = toAnchorPositionValue(containing.startLine, containing.startColumn);
  const containingEnd = toAnchorPositionValue(
    containing.endLine ?? containing.startLine,
    containing.endColumn ?? containing.startColumn,
  );
  const containedStart = toAnchorPositionValue(contained.startLine, contained.startColumn);
  const containedEnd = toAnchorPositionValue(
    contained.endLine ?? contained.startLine,
    contained.endColumn ?? contained.startColumn,
  );

  return containingStart <= containedStart && containedEnd <= containingEnd;
}

function estimateAnchorSpan(anchor: ExpressionSyntaxNode["location"]): number {
  const start = toAnchorPositionValue(anchor.startLine, anchor.startColumn);
  const end = toAnchorPositionValue(
    anchor.endLine ?? anchor.startLine,
    anchor.endColumn ?? anchor.startColumn,
  );
  return Math.max(0, end - start);
}

function toAnchorPositionValue(line: number, column: number): number {
  return line * 1_000_000 + column;
}

function buildExternalContributions(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: { id: string };
  syntax: ExpressionSyntaxNode;
}): ExternalClassContribution[] {
  const syntax = input.syntax;
  const componentNodeId = input.input.classExpressionSite.emittingComponentNodeId;
  if (!componentNodeId) {
    return [];
  }
  const bindingNodeId =
    input.input.graph.indexes.componentPropBindingNodeIdByComponentNodeId.get(componentNodeId);
  const bindingNode = bindingNodeId
    ? input.input.graph.indexes.nodesById.get(bindingNodeId)
    : undefined;
  if (!bindingNode || bindingNode.kind !== "component-prop-binding") {
    return [];
  }

  const contributionsByKey = new Map<string, ExternalClassContribution>();
  const seenExpressionIds = new Set<string>();
  const queue: ExpressionSyntaxNode[] = [syntax];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seenExpressionIds.has(current.expressionId)) {
      continue;
    }
    seenExpressionIds.add(current.expressionId);

    if (
      bindingNode.bindingKind === "destructured-props" &&
      current.expressionKind === "identifier"
    ) {
      const property = bindingNode.properties.find(
        (candidate) => candidate.localName === current.name,
      );
      if (property) {
        const contributionKey = `${property.propertyName}:${current.location.startLine}:${current.location.startColumn}`;
        contributionsByKey.set(contributionKey, {
          id: externalContributionId({
            expressionId: input.expression.id,
            contributionKey,
            index: 0,
          }),
          contributionKind: "component-prop",
          localName: property.localName,
          propertyName: property.propertyName,
          sourceAnchor: current.location,
          conditionId: conditionId({ expressionId: input.expression.id, conditionKey: "always" }),
          confidence: "high",
          reason: `component prop "${property.propertyName}" via destructured binding`,
        });
      }
    }

    if (
      bindingNode.bindingKind === "props-identifier" &&
      current.expressionKind === "member-access"
    ) {
      const objectExpression = getExpressionSyntax(input.input, current.objectExpressionId);
      if (
        objectExpression?.expressionKind === "identifier" &&
        objectExpression.name === bindingNode.identifierName &&
        !isComponentPropIdentifierShadowedByRepeatedRenderCallback(input.input, objectExpression)
      ) {
        const contributionKey = `${current.propertyName}:${current.location.startLine}:${current.location.startColumn}`;
        contributionsByKey.set(contributionKey, {
          id: externalContributionId({
            expressionId: input.expression.id,
            contributionKey,
            index: 0,
          }),
          contributionKind: "component-prop",
          localName: bindingNode.identifierName,
          propertyName: current.propertyName,
          sourceAnchor: current.location,
          conditionId: conditionId({ expressionId: input.expression.id, conditionKey: "always" }),
          confidence: "high",
          reason: `component prop "${current.propertyName}" via props member access`,
        });
      }
    }

    if (current.expressionKind === "identifier") {
      const localBindings = resolveLocalValueBindingsForIdentifier({
        input: input.input,
        rootOwnerNodeId: componentNodeId,
        identifierName: current.name,
        targetLocation: current.location,
      });
      for (const localBinding of localBindings) {
        const contribution = buildExternalContributionFromLocalBinding({
          input: input.input,
          expressionId: input.expression.id,
          bindingNode,
          localBinding,
          sourceExpression: current,
        });
        if (contribution) {
          contributionsByKey.set(contribution.key, contribution.contribution);
        }

        const boundExpressions = getLocalBindingExpressionSyntax(input.input, localBinding);
        queue.push(...boundExpressions);
      }
    }

    queue.push(...collectChildExpressionSyntax(input.input, current));
  }

  return [...contributionsByKey.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function isComponentPropIdentifierShadowedByRepeatedRenderCallback(
  input: SymbolicExpressionEvaluatorInput,
  identifier: Extract<ExpressionSyntaxNode, { expressionKind: "identifier" }>,
): boolean {
  const renderSiteNodeId = input.classExpressionSite.renderSiteNodeId;
  const renderSite = renderSiteNodeId
    ? input.graph.indexes.nodesById.get(renderSiteNodeId)
    : undefined;
  if (
    !renderSite ||
    renderSite.kind !== "render-site" ||
    !renderSite.repeatedRegion?.callbackParameterNames?.includes(identifier.name)
  ) {
    return false;
  }

  return sourceAnchorContains(renderSite.location, identifier.location);
}

function resolveLocalValueBindingsForIdentifier(input: {
  input: SymbolicExpressionEvaluatorInput;
  rootOwnerNodeId: string;
  identifierName: string;
  targetLocation: ExpressionSyntaxNode["location"];
}): SymbolicExpressionEvaluatorInput["graph"]["nodes"]["localValueBindings"] {
  const ownerNodeIds = collectOwnerNodeIds(input.input, input.rootOwnerNodeId);

  const bindingNodeIds = ownerNodeIds.flatMap(
    (ownerNodeId) =>
      input.input.graph.indexes.localValueBindingNodeIdsByOwnerNodeId.get(ownerNodeId) ?? [],
  );
  const scopedBindingNodes = [...new Set(bindingNodeIds)]
    .map((bindingNodeId) => input.input.graph.indexes.nodesById.get(bindingNodeId))
    .filter(isLocalValueBindingNode);
  const sameFileBindingNodes = input.input.graph.nodes.localValueBindings.filter(
    (binding) =>
      binding.localName === input.identifierName &&
      binding.filePath === input.targetLocation.filePath &&
      doesScopeContainTarget({
        scope: binding.scopeLocation,
        target: input.targetLocation,
      }),
  );

  return uniqueLocalValueBindings([...scopedBindingNodes, ...sameFileBindingNodes])
    .filter((binding) => binding.localName === input.identifierName)
    .filter((binding) =>
      isAnchorAtOrBefore({
        candidate: binding.location,
        target: input.targetLocation,
      }),
    )
    .sort((left, right) => {
      const scopeSpecificity = compareScopeSpecificityForTarget({
        leftScope: left.scopeLocation,
        rightScope: right.scopeLocation,
        target: input.targetLocation,
      });
      if (scopeSpecificity !== 0) {
        return scopeSpecificity;
      }
      if (left.location.startLine !== right.location.startLine) {
        return right.location.startLine - left.location.startLine;
      }
      return right.location.startColumn - left.location.startColumn;
    });
}

function isLocalValueBindingNode(
  node: ReturnType<SymbolicExpressionEvaluatorInput["graph"]["indexes"]["nodesById"]["get"]>,
): node is SymbolicExpressionEvaluatorInput["graph"]["nodes"]["localValueBindings"][number] {
  return Boolean(node && node.kind === "local-value-binding");
}

function uniqueLocalValueBindings(
  bindings: SymbolicExpressionEvaluatorInput["graph"]["nodes"]["localValueBindings"],
): SymbolicExpressionEvaluatorInput["graph"]["nodes"]["localValueBindings"] {
  const byId = new Map(bindings.map((binding) => [binding.id, binding] as const));
  return [...byId.values()];
}

function buildExternalContributionFromLocalBinding(input: {
  input: SymbolicExpressionEvaluatorInput;
  expressionId: string;
  bindingNode: SymbolicExpressionEvaluatorInput["graph"]["nodes"]["componentPropBindings"][number];
  localBinding: SymbolicExpressionEvaluatorInput["graph"]["nodes"]["localValueBindings"][number];
  sourceExpression: Extract<ExpressionSyntaxNode, { expressionKind: "identifier" }>;
}): { key: string; contribution: ExternalClassContribution } | undefined {
  if (
    input.bindingNode.bindingKind !== "props-identifier" ||
    input.localBinding.bindingKind !== "destructured-property" ||
    !input.localBinding.propertyName ||
    !input.localBinding.objectExpressionId
  ) {
    return undefined;
  }

  const objectExpression = getExpressionSyntax(input.input, input.localBinding.objectExpressionId);
  if (
    objectExpression?.expressionKind !== "identifier" ||
    objectExpression.name !== input.bindingNode.identifierName
  ) {
    return undefined;
  }

  const contributionKey = `${input.localBinding.propertyName}:${input.sourceExpression.location.startLine}:${input.sourceExpression.location.startColumn}`;
  return {
    key: contributionKey,
    contribution: {
      id: externalContributionId({
        expressionId: input.expressionId,
        contributionKey,
        index: 0,
      }),
      contributionKind: "component-prop",
      localName: input.localBinding.localName,
      propertyName: input.localBinding.propertyName,
      sourceAnchor: input.sourceExpression.location,
      conditionId: conditionId({ expressionId: input.expressionId, conditionKey: "always" }),
      confidence: "high",
      reason: `component prop "${input.localBinding.propertyName}" via local destructuring`,
    },
  };
}

function getLocalBindingExpressionSyntax(
  input: SymbolicExpressionEvaluatorInput,
  binding: SymbolicExpressionEvaluatorInput["graph"]["nodes"]["localValueBindings"][number],
): ExpressionSyntaxNode[] {
  return [binding.expressionId, binding.initializerExpressionId, binding.objectExpressionId]
    .filter((expressionId): expressionId is string => Boolean(expressionId))
    .map((expressionId) => getExpressionSyntax(input, expressionId))
    .filter((expression): expression is ExpressionSyntaxNode => Boolean(expression));
}

function collectChildExpressionSyntax(
  input: SymbolicExpressionEvaluatorInput,
  expression: ExpressionSyntaxNode,
): ExpressionSyntaxNode[] {
  const ids: string[] = [];
  switch (expression.expressionKind) {
    case "wrapper":
      ids.push(expression.innerExpressionId);
      break;
    case "template-literal":
      ids.push(...expression.spans.map((span) => span.expressionId));
      break;
    case "binary":
      ids.push(expression.leftExpressionId, expression.rightExpressionId);
      break;
    case "conditional":
      ids.push(
        expression.conditionExpressionId,
        expression.whenTrueExpressionId,
        expression.whenFalseExpressionId,
      );
      break;
    case "call":
      ids.push(expression.calleeExpressionId, ...expression.argumentExpressionIds);
      break;
    case "array-literal":
      ids.push(...expression.elementExpressionIds);
      break;
    case "object-literal":
      for (const property of expression.properties) {
        if (property.valueExpressionId) {
          ids.push(property.valueExpressionId);
        }
        if (property.keyExpressionId) {
          ids.push(property.keyExpressionId);
        }
        if (property.spreadExpressionId) {
          ids.push(property.spreadExpressionId);
        }
      }
      break;
    case "member-access":
      ids.push(expression.objectExpressionId);
      break;
    case "element-access":
      ids.push(expression.objectExpressionId);
      if (expression.argumentExpressionId) {
        ids.push(expression.argumentExpressionId);
      }
      break;
    case "prefix-unary":
      ids.push(expression.operandExpressionId);
      break;
    default:
      break;
  }
  return ids
    .map((expressionId) => getExpressionSyntax(input, expressionId))
    .filter((child): child is ExpressionSyntaxNode => Boolean(child));
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

function shouldExpandTemplateAgainstKnownClasses(input: SymbolicExpressionEvaluatorInput): boolean {
  return !input.classExpressionSite.classExpressionSiteKey.includes("clone-element-class");
}

function collectKnownClassNames(input: SymbolicExpressionEvaluatorInput): string[] {
  return uniqueSorted(
    input.graph.nodes.selectorBranches.flatMap((branch) => branch.requiredClassNames),
  );
}

function expandTemplateAgainstKnownClasses(
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "template-literal" }>,
  knownClassNames: string[],
): string[] {
  if (knownClassNames.length === 0) {
    return [];
  }

  const text = [
    expression.headText,
    ...expression.spans.flatMap((span) => ["${expr}", span.literalText]),
  ].join("");
  const tokens = text.split(/\s+/).filter(Boolean);
  const matched = new Set<string>();
  for (const token of tokens) {
    if (!token.includes("${expr}")) {
      if (knownClassNames.includes(token)) {
        matched.add(token);
      }
      continue;
    }

    const tokenPattern = token.split("${expr}").map(escapeRegex).join(".*");
    const regex = new RegExp(`^${tokenPattern}$`);
    for (const className of knownClassNames) {
      if (regex.test(className)) {
        matched.add(className);
      }
    }
  }
  return [...matched].sort((left, right) => left.localeCompare(right));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  helperBindings?: Map<string, AbstractValue>;
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
  helperBindings?: Map<string, AbstractValue>;
}): AbstractValue {
  const callee = getExpressionSyntax(input.input, input.expression.calleeExpressionId);
  const helperCall = callee ? summarizeLocalHelperCall(input, callee, input.expression) : undefined;
  if (helperCall) {
    return helperCall;
  }
  if (callee && isClassNamesHelper(callee)) {
    return summarizeClassNamesHelperArgs(input, input.expression.argumentExpressionIds);
  }

  if (input.expression.hasSpreadArgument) {
    return { kind: "unknown", reason: "unsupported-call:spread-argument" };
  }

  const arrayJoinTarget = callee ? getArrayJoinTarget(input.input, callee) : undefined;
  if (arrayJoinTarget) {
    return summarizeClassArrayJoin({
      ...input,
      elementExpressionIds: arrayJoinTarget.elementExpressionIds,
      hasSpreadElement: arrayJoinTarget.hasSpreadElement,
      hasOmittedElement: arrayJoinTarget.hasOmittedElement,
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
    helperBindings?: Map<string, AbstractValue>;
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
    helperBindings?: Map<string, AbstractValue>;
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

function summarizeObjectExpressionSyntax(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "object-literal" }>;
  depth: number;
  seenExpressionIds: Set<string>;
  helperBindings?: Map<string, AbstractValue>;
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

function summarizeMemberAccessExpressionSyntax(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "member-access" }>;
  depth: number;
  seenExpressionIds: Set<string>;
  helperBindings?: Map<string, AbstractValue>;
}): AbstractValue {
  const objectExpression = getExpressionSyntax(input.input, input.expression.objectExpressionId);
  if (!objectExpression) {
    return { kind: "unknown", reason: "missing-expression-syntax" };
  }

  const unwrapped = unwrapExpressionSyntax({
    ...input,
    expression: objectExpression,
  });
  if (unwrapped.expressionKind !== "object-literal") {
    return { kind: "unknown", reason: "unresolved-member-access" };
  }

  const property = unwrapped.properties.find(
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

  return summarizeNormalizedClassExpression({
    input: input.input,
    expression: propertyExpression,
    depth: input.depth + 1,
    seenExpressionIds: input.seenExpressionIds,
    helperBindings: input.helperBindings,
  });
}

function summarizeElementAccessExpressionSyntax(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "element-access" }>;
  depth: number;
  seenExpressionIds: Set<string>;
  helperBindings?: Map<string, AbstractValue>;
}): AbstractValue {
  if (!input.expression.argumentExpressionId) {
    return { kind: "unknown", reason: "unresolved-element-access-key" };
  }

  const objectExpression = getExpressionSyntax(input.input, input.expression.objectExpressionId);
  const objectLiteral = objectExpression
    ? resolveObjectLiteralExpressionSyntax({
        ...input,
        expression: objectExpression,
      })
    : undefined;
  if (!objectLiteral) {
    return { kind: "unknown", reason: "unresolved-element-access-object" };
  }

  const argumentValue = getExpressionValue(
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
    return { kind: "unknown", reason: "unresolved-element-access-key" };
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
      getExpressionValue(
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

function resolveObjectLiteralExpressionSyntax(input: {
  input: SymbolicExpressionEvaluatorInput;
  expression: ExpressionSyntaxNode;
  depth: number;
  seenExpressionIds: Set<string>;
  helperBindings?: Map<string, AbstractValue>;
}): Extract<ExpressionSyntaxNode, { expressionKind: "object-literal" }> | undefined {
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
    });
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}

function summarizeArrayExpressionSyntax(input: {
  input: SymbolicExpressionEvaluatorInput;
  elementExpressionIds: string[];
  hasSpreadElement: boolean;
  hasOmittedElement: boolean;
  depth: number;
  seenExpressionIds: Set<string>;
  helperBindings?: Map<string, AbstractValue>;
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
  hasSpreadElement: boolean;
  hasOmittedElement: boolean;
  argumentExpressionIds: string[];
  depth: number;
  seenExpressionIds: Set<string>;
  helperBindings?: Map<string, AbstractValue>;
}): AbstractValue {
  const separator = getJoinSeparator(input.input, input.argumentExpressionIds);
  if (separator === undefined) {
    return { kind: "unknown", reason: "unsupported-join-separator" };
  }

  if (/^\s*$/.test(separator)) {
    return summarizeArrayExpressionSyntax({
      ...input,
    });
  }

  if (input.hasSpreadElement || input.hasOmittedElement) {
    return { kind: "unknown", reason: "non-whitespace-join-with-unsupported-array-element" };
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

function summarizeLocalHelperCall(
  input: {
    input: SymbolicExpressionEvaluatorInput;
    expression: Extract<ExpressionSyntaxNode, { expressionKind: "call" }>;
    depth: number;
    seenExpressionIds: Set<string>;
    helperBindings?: Map<string, AbstractValue>;
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
    return summarizeClassNamesHelperArgs(input, callExpression.argumentExpressionIds);
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
    getExpressionValue(
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
            ? getExpressionValue(
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
  });

  const returnValues = returnExpressionIds
    .map((returnExpressionId) => getExpressionSyntax(input.input, returnExpressionId))
    .filter((expression): expression is ExpressionSyntaxNode => Boolean(expression))
    .map((returnExpression) =>
      summarizeNormalizedClassExpression({
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
        ? getExpressionValue(
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
    });
    input.scopedBindings.set(binding.localName, value);
  }
}

function resolveDestructuredPropertyValue(input: {
  input: SymbolicExpressionEvaluatorInput;
  argumentExpression: ExpressionSyntaxNode | undefined;
  argumentValue: AbstractValue;
  propertyName: string;
  fallback: AbstractValue;
  mergeWithFallback: boolean;
  depth: number;
  seenExpressionIds: Set<string>;
  helperBindings?: Map<string, AbstractValue>;
}): AbstractValue {
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
    const shorthandValue = summarizeIdentifierExpressionSyntax({
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

  const propertyValue = summarizeNormalizedClassExpression({
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
): ClassArrayJoinTarget | undefined {
  const unwrappedCallee =
    callee.expressionKind === "wrapper"
      ? (getExpressionSyntax(input, callee.innerExpressionId) ?? callee)
      : callee;
  if (
    unwrappedCallee.expressionKind !== "member-access" ||
    unwrappedCallee.propertyName !== "join"
  ) {
    return undefined;
  }

  const target = getExpressionSyntax(input, unwrappedCallee.objectExpressionId);
  return target ? getClassArrayJoinTarget(input, target) : undefined;
}

function getClassArrayJoinTarget(
  input: SymbolicExpressionEvaluatorInput,
  expression: ExpressionSyntaxNode,
): ClassArrayJoinTarget | undefined {
  const unwrapped =
    expression.expressionKind === "wrapper"
      ? (getExpressionSyntax(input, expression.innerExpressionId) ?? expression)
      : expression;
  if (unwrapped.expressionKind === "array-literal") {
    return {
      elementExpressionIds: unwrapped.elementExpressionIds,
      hasSpreadElement: unwrapped.hasSpreadElement,
      hasOmittedElement: unwrapped.hasOmittedElement,
    };
  }

  if (unwrapped.expressionKind !== "call" || !isBooleanFilterCall(input, unwrapped)) {
    return undefined;
  }

  const filterCallee = getExpressionSyntax(input, unwrapped.calleeExpressionId);
  if (!filterCallee || filterCallee.expressionKind !== "member-access") {
    return undefined;
  }

  const filterTarget = getExpressionSyntax(input, filterCallee.objectExpressionId);
  return filterTarget ? getClassArrayJoinTarget(input, filterTarget) : undefined;
}

function isBooleanFilterCall(
  input: SymbolicExpressionEvaluatorInput,
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "call" }>,
): boolean {
  const callee = getExpressionSyntax(input, expression.calleeExpressionId);
  if (!callee || callee.expressionKind !== "member-access" || callee.propertyName !== "filter") {
    return false;
  }

  if (expression.argumentExpressionIds.length === 0) {
    return true;
  }

  if (expression.argumentExpressionIds.length !== 1) {
    return false;
  }

  const argument = getExpressionSyntax(input, expression.argumentExpressionIds[0]);
  return argument?.expressionKind === "identifier" && argument.name === "Boolean";
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
