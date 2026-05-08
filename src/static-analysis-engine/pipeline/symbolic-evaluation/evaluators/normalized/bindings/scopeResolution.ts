import type { ExpressionSyntaxNode } from "../../../../fact-graph/index.js";
import type { SymbolicExpressionEvaluatorInput } from "../../../model/types.js";

export function collectOwnerNodeIds(
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

export function resolveLocalValueBindingsForIdentifier(input: {
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

export function isAnchorAtOrBefore(input: {
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

export function doesScopeContainTarget(input: {
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

export function sourceAnchorContains(
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
