import ts from "typescript";
import { buildComponentReferenceNode } from "./builders/buildComponentReferenceNode.js";
import { resolveReferenceAt } from "../../symbol-resolution/index.js";
import {
  buildElementNode,
  buildChildren,
  summarizeClassNameExpressionForRender,
} from "./builders/buildIntrinsicNode.js";
import { buildLogicalRenderNode } from "./builders/buildLogicalNode.js";
import {
  buildArrayRenderNode,
  tryBuildFoundArrayRenderNode,
  tryBuildMappedArrayRenderNode,
} from "./builders/buildArrayNodes.js";
import { collectSameFileComponents } from "./collection/discovery/collectSameFileComponents.js";
import type { BuildContext } from "./shared/internalTypes.js";
import {
  applyPlacementAnchor,
  createEmptyFragmentNode,
  createRenderExpansionTrace,
  isUndefinedIdentifier,
  toSourceAnchor,
  withStaticallySkippedBranch,
} from "./shared/renderIrUtils.js";
import { resolveDeclaredValueSymbol } from "./collection/shared/indexExpressionBindingsBySymbolId.js";
import {
  getHelperCallResolutionFailureReason,
  mergeExpressionBindings,
  resolveBoundExpression,
  resolveHelperCallContext,
} from "./resolution/resolveBindings.js";
import { resolveExactBooleanExpression } from "./resolution/resolveExactValues.js";
import { isRenderableExpression } from "./collection/shared/renderableExpressionGuards.js";
import {
  buildClassExpressionTraces,
  mergeClassNameValues,
  toAbstractClassSet,
} from "../abstract-values/classExpressions.js";
import type { ClassExpressionSummary } from "../abstract-values/types.js";
import type { SourceAnchor } from "../../../types/core.js";
import type { RenderNode, RenderSubtree } from "./types.js";

const MAX_RENDER_EXPRESSION_RESOLUTION_DEPTH = 100;

type RenderExpressionResolutionState = {
  activeExpressions: Set<string>;
  depth: number;
};

export function buildSameFileRenderSubtrees(input: {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
  symbolResolution: import("../../symbol-resolution/index.js").ProjectBindingResolution;
  componentDefinitions?: import("./collection/shared/types.js").SameFileComponentDefinition[];
  componentsByFilePath?: Map<
    string,
    Map<string, import("./collection/shared/types.js").SameFileComponentDefinition>
  >;
  importedExpressionBindingsBySymbolId?: Map<string, ts.Expression>;
  importedHelperDefinitions?: Map<
    string,
    import("./collection/shared/types.js").LocalHelperDefinition
  >;
  topLevelHelperDefinitions?: Map<
    string,
    import("./collection/shared/types.js").LocalHelperDefinition
  >;
  topLevelExpressionBindingsBySymbolId?: Map<string, ts.Expression>;
  topLevelHelperDefinitionsByFilePath?: Map<
    string,
    Map<string, import("./collection/shared/types.js").LocalHelperDefinition>
  >;
  topLevelExpressionBindingsBySymbolIdByFilePath?: Map<string, Map<string, ts.Expression>>;
  importedNamespaceExpressionBindingsBySymbolId?: Map<string, Map<string, ts.Expression>>;
  importedNamespaceHelperDefinitionsBySymbolId?: Map<
    string,
    Map<string, import("./collection/shared/types.js").LocalHelperDefinition>
  >;
  importedNamespaceComponentDefinitionsBySymbolId?: Map<
    string,
    Map<string, import("./collection/shared/types.js").SameFileComponentDefinition>
  >;
  includeTraces?: boolean;
}): RenderSubtree[] {
  const includeTraces = input.includeTraces ?? true;
  const componentDefinitions = input.componentDefinitions ?? collectSameFileComponents(input);
  const localComponentsByName = new Map(
    componentDefinitions.map((definition) => [definition.componentName, definition]),
  );
  const componentsByFilePath =
    input.componentsByFilePath ?? new Map([[input.filePath, localComponentsByName]]);

  return componentDefinitions.map((definition) => ({
    root: buildRenderNode(definition.rootExpression, {
      filePath: definition.filePath,
      parsedSourceFile: definition.parsedSourceFile,
      currentComponentFilePath: definition.filePath,
      symbolResolution: input.symbolResolution,
      componentsByFilePath,
      currentDepth: 0,
      expansionStack: [definition.componentName],
      expressionBindings: new Map([...definition.localExpressionBindings.entries()]),
      expressionBindingsBySymbolId: new Map([
        ...(input.importedExpressionBindingsBySymbolId?.entries() ?? []),
        ...(input.topLevelExpressionBindingsBySymbolId?.entries() ?? []),
        ...definition.localExpressionBindingsBySymbolId.entries(),
      ]),
      stringSetBindings: buildDefinitionStringSetBindings(definition),
      helperDefinitions: new Map([
        ...(input.importedHelperDefinitions?.entries() ?? []),
        ...(input.topLevelHelperDefinitions?.entries() ?? []),
        ...definition.localHelperDefinitions.entries(),
      ]),
      topLevelHelperDefinitionsByFilePath:
        input.topLevelHelperDefinitionsByFilePath ??
        new Map(
          input.topLevelHelperDefinitions
            ? [[definition.filePath, input.topLevelHelperDefinitions]]
            : [],
        ),
      topLevelExpressionBindingsBySymbolIdByFilePath:
        input.topLevelExpressionBindingsBySymbolIdByFilePath ??
        new Map(
          input.topLevelExpressionBindingsBySymbolId
            ? [[definition.filePath, input.topLevelExpressionBindingsBySymbolId]]
            : [],
        ),
      namespaceExpressionBindingsBySymbolId: new Map(
        input.importedNamespaceExpressionBindingsBySymbolId?.entries() ?? [],
      ),
      namespaceHelperDefinitionsBySymbolId: new Map(
        input.importedNamespaceHelperDefinitionsBySymbolId?.entries() ?? [],
      ),
      namespaceComponentDefinitionsBySymbolId: new Map(
        input.importedNamespaceComponentDefinitionsBySymbolId?.entries() ?? [],
      ),
      helperExpansionStack: [],
      propsObjectProperties: new Map(),
      propsObjectSubtreeProperties: new Map(),
      subtreeBindings: new Map(),
      subtreeBindingsBySymbolId: new Map(),
      includeTraces,
    }),
    exported: definition.exported,
    componentName: definition.componentName,
    sourceAnchor: definition.sourceAnchor,
  }));
}

function buildDefinitionStringSetBindings(
  definition: import("./collection/shared/types.js").SameFileComponentDefinition,
): Map<string, string[]> {
  const bindings = new Map(definition.localStringSetBindings);
  if (definition.parameterBinding.kind === "destructured-props") {
    for (const property of definition.parameterBinding.properties) {
      if (property.finiteStringValues) {
        bindings.set(property.identifierName, property.finiteStringValues);
      }
    }
  }

  return bindings;
}

function buildRenderNode(node: ts.Expression | ts.JsxChild, context: BuildContext): RenderNode {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    return buildRenderNode(node.expression, context);
  }

  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return buildLogicalRenderNode({ node, context, buildRenderNode });
  }

  if (isNullishRenderExpression(node)) {
    return createEmptyFragmentNode(node, context);
  }

  if (ts.isExpression(node)) {
    const insertedSubtree = tryResolveInsertedSubtreeExpression(node, context, node);
    if (insertedSubtree) {
      return insertedSubtree;
    }
  }

  const boundRenderableNode = tryBuildBoundRenderableNode(node, context);
  if (boundRenderableNode) {
    return boundRenderableNode;
  }

  if (ts.isConditionalExpression(node)) {
    const resolvedCondition = resolveExactBooleanExpression(node.condition, context);
    if (resolvedCondition === true) {
      return withStaticallySkippedBranch(
        applyPlacementAnchor(
          buildRenderNode(node.whenTrue, context),
          toSourceAnchor(node.whenTrue, context.parsedSourceFile, context.filePath),
        ),
        {
          reason: "condition-resolved-true",
          conditionSourceText: node.condition.getText(context.parsedSourceFile),
          skippedBranch: "when-false",
          sourceAnchor: toSourceAnchor(node, context.parsedSourceFile, context.filePath),
          node: buildRenderNode(node.whenFalse, context),
        },
      );
    }

    if (resolvedCondition === false) {
      return withStaticallySkippedBranch(
        applyPlacementAnchor(
          buildRenderNode(node.whenFalse, context),
          toSourceAnchor(node.whenFalse, context.parsedSourceFile, context.filePath),
        ),
        {
          reason: "condition-resolved-false",
          conditionSourceText: node.condition.getText(context.parsedSourceFile),
          skippedBranch: "when-true",
          sourceAnchor: toSourceAnchor(node, context.parsedSourceFile, context.filePath),
          node: buildRenderNode(node.whenTrue, context),
        },
      );
    }

    return {
      kind: "conditional",
      sourceAnchor: toSourceAnchor(node, context.parsedSourceFile, context.filePath),
      conditionSourceText: node.condition.getText(context.parsedSourceFile),
      whenTrue: buildRenderNode(node.whenTrue, context),
      whenFalse: buildRenderNode(node.whenFalse, context),
    };
  }

  if (ts.isArrayLiteralExpression(node)) {
    return buildArrayRenderNode({ node, context, buildRenderNode });
  }

  if (ts.isJsxElement(node)) {
    return buildElementNode({
      tagNameNode: node.openingElement.tagName,
      attributes: node.openingElement.attributes,
      children: node.children,
      context,
      buildRenderNode,
      buildComponentReferenceNode: (tagNameNode, attributes, children, buildContext) =>
        buildComponentReferenceNode(
          tagNameNode,
          attributes,
          children,
          buildContext,
          buildRenderNode,
        ),
    });
  }

  if (ts.isJsxSelfClosingElement(node)) {
    return buildElementNode({
      tagNameNode: node.tagName,
      attributes: node.attributes,
      children: [],
      context,
      buildRenderNode,
      buildComponentReferenceNode: (tagNameNode, attributes, children, buildContext) =>
        buildComponentReferenceNode(
          tagNameNode,
          attributes,
          children,
          buildContext,
          buildRenderNode,
        ),
    });
  }

  if (ts.isJsxFragment(node)) {
    return {
      kind: "fragment",
      sourceAnchor: toSourceAnchor(node, context.parsedSourceFile, context.filePath),
      children: buildChildren(node.children, context, buildRenderNode),
    };
  }

  if (ts.isJsxExpression(node)) {
    if (!node.expression) {
      const sourceAnchor = toSourceAnchor(node, context.parsedSourceFile, context.filePath);
      return {
        kind: "unknown",
        sourceAnchor,
        reason: "empty-jsx-expression",
        traces: context.includeTraces
          ? [
              createRenderExpansionTrace({
                traceId: "render-expansion:unknown:empty-jsx-expression",
                summary: "encountered an empty JSX expression while building render IR",
                anchor: sourceAnchor,
                metadata: {
                  reason: "empty-jsx-expression",
                },
              }),
            ]
          : [],
      };
    }

    const insertedSubtree = tryResolveInsertedSubtreeExpression(node.expression, context, node);
    if (insertedSubtree) {
      return insertedSubtree;
    }

    return buildRenderNode(node.expression, context);
  }

  if (ts.isJsxText(node)) {
    const sourceAnchor = toSourceAnchor(node, context.parsedSourceFile, context.filePath);
    return {
      kind: "unknown",
      sourceAnchor,
      reason: "jsx-text",
      traces: context.includeTraces
        ? [
            createRenderExpansionTrace({
              traceId: "render-expansion:unknown:jsx-text",
              summary: "preserved JSX text as an unknown render node in the current bounded IR",
              anchor: sourceAnchor,
              metadata: {
                reason: "jsx-text",
              },
            }),
          ]
        : [],
    };
  }

  if (ts.isCallExpression(node)) {
    const reactChildApiNode = tryBuildReactChildApiRenderNode(node, context);
    if (reactChildApiNode) {
      return reactChildApiNode;
    }

    const foundArrayNode = tryBuildFoundArrayRenderNode({
      expression: node,
      context,
      buildRenderNode,
    });
    if (foundArrayNode) {
      return foundArrayNode;
    }

    const mappedArrayNode = tryBuildMappedArrayRenderNode({
      expression: node,
      context,
      buildRenderNode,
    });
    if (mappedArrayNode) {
      return mappedArrayNode;
    }

    const helperResolution = resolveHelperCallContext(node, context);
    if (helperResolution) {
      return applyPlacementAnchor(
        buildRenderNode(helperResolution.expression, helperResolution.context),
        toSourceAnchor(node, context.parsedSourceFile, context.filePath),
      );
    }

    const helperFailureReason = getHelperCallResolutionFailureReason(node, context);
    if (helperFailureReason) {
      const sourceAnchor = toSourceAnchor(node, context.parsedSourceFile, context.filePath);
      return {
        kind: "unknown",
        sourceAnchor,
        reason: helperFailureReason,
        traces: context.includeTraces
          ? [
              createRenderExpansionTrace({
                traceId: "render-expansion:unknown:helper-call",
                summary:
                  "could not inline helper-driven render output under the current bounded expansion rules",
                anchor: sourceAnchor,
                metadata: {
                  reason: helperFailureReason,
                },
              }),
            ]
          : [],
      };
    }
  }

  const sourceAnchor = toSourceAnchor(node, context.parsedSourceFile, context.filePath);
  return {
    kind: "unknown",
    sourceAnchor,
    reason: `unsupported-render-node:${ts.SyntaxKind[node.kind]}`,
    traces: context.includeTraces
      ? [
          createRenderExpansionTrace({
            traceId: "render-expansion:unknown:unsupported-node",
            summary:
              "encountered a render expression shape that is unsupported in the current bounded IR",
            anchor: sourceAnchor,
            metadata: {
              reason: `unsupported-render-node:${ts.SyntaxKind[node.kind]}`,
            },
          }),
        ]
      : [],
  };
}

function tryResolveInsertedSubtreeExpression(
  expression: ts.Expression,
  context: BuildContext,
  anchorNode: ts.Node,
): RenderNode | undefined {
  const subtreeNodes = resolveInsertedSubtreeNodes(expression, context);
  if (!subtreeNodes) {
    return undefined;
  }

  return {
    kind: "fragment",
    sourceAnchor: toSourceAnchor(anchorNode, context.parsedSourceFile, context.filePath),
    children: subtreeNodes,
  };
}

function resolveInsertedSubtreeNodes(
  expression: ts.Expression,
  context: BuildContext,
  state: RenderExpressionResolutionState = {
    activeExpressions: new Set(),
    depth: 0,
  },
): RenderNode[] | undefined {
  if (state.depth > MAX_RENDER_EXPRESSION_RESOLUTION_DEPTH) {
    return undefined;
  }

  expression = unwrapRenderableExpression(expression);
  const expressionKey = getRenderExpressionResolutionKey(expression, context);
  if (state.activeExpressions.has(expressionKey)) {
    return undefined;
  }

  state.activeExpressions.add(expressionKey);
  try {
    if (ts.isIdentifier(expression)) {
      const resolvedSymbol = resolveReferenceAtIdentifier(expression, context);
      const subtreeBinding = resolvedSymbol
        ? context.subtreeBindingsBySymbolId.get(resolvedSymbol.id)
        : context.subtreeBindings.get(expression.text);
      if (subtreeBinding) {
        return subtreeBinding;
      }

      const boundExpression = resolveBoundExpression(expression, context);
      if (boundExpression) {
        return resolveInsertedSubtreeNodes(
          boundExpression,
          context,
          nextRenderExpressionResolutionState(state),
        );
      }
    }

    if (
      ts.isPropertyAccessExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      isPropsObjectReference(expression.expression, context)
    ) {
      return context.propsObjectSubtreeProperties.get(expression.name.text);
    }

    if (ts.isCallExpression(expression)) {
      const collectionSubtreeNodes = tryResolveReactChildrenCollectionNodes(
        expression,
        context,
        nextRenderExpressionResolutionState(state),
      );
      if (collectionSubtreeNodes) {
        return collectionSubtreeNodes;
      }

      if (isChildrenOnlyCallExpression(expression)) {
        return expression.arguments[0]
          ? resolveInsertedSubtreeNodes(
              expression.arguments[0],
              context,
              nextRenderExpressionResolutionState(state),
            )
          : undefined;
      }

      const clonedSubtreeNodes = tryResolveCloneElementRenderNodes(
        expression,
        context,
        nextRenderExpressionResolutionState(state),
      );
      if (clonedSubtreeNodes) {
        return clonedSubtreeNodes;
      }

      if (isCloneElementPreservationCallExpression(expression, context)) {
        return expression.arguments[0]
          ? resolveInsertedSubtreeNodes(
              expression.arguments[0],
              context,
              nextRenderExpressionResolutionState(state),
            )
          : undefined;
      }
    }

    return undefined;
  } finally {
    state.activeExpressions.delete(expressionKey);
  }
}

function isNullishRenderExpression(node: ts.Expression | ts.JsxChild): boolean {
  if (!("kind" in node)) {
    return false;
  }

  return node.kind === ts.SyntaxKind.NullKeyword || isUndefinedIdentifier(node);
}

function tryBuildBoundRenderableNode(
  node: ts.Expression | ts.JsxChild,
  context: BuildContext,
): RenderNode | undefined {
  if (!ts.isExpression(node) || ts.isCallExpression(node)) {
    return undefined;
  }

  const boundExpression = resolveBoundExpression(node, context);
  if (!boundExpression || !isRenderableExpression(boundExpression)) {
    return undefined;
  }

  return applyPlacementAnchor(
    buildRenderNode(boundExpression, context),
    toSourceAnchor(node, context.parsedSourceFile, context.filePath),
  );
}

function tryBuildReactChildApiRenderNode(
  expression: ts.CallExpression,
  context: BuildContext,
): RenderNode | undefined {
  const collectionSubtreeNodes = tryResolveReactChildrenCollectionNodes(expression, context);
  if (collectionSubtreeNodes) {
    return {
      kind: "fragment",
      sourceAnchor: toSourceAnchor(expression, context.parsedSourceFile, context.filePath),
      children: collectionSubtreeNodes,
    };
  }

  const subtreeNodes = isChildrenOnlyCallExpression(expression)
    ? expression.arguments[0]
      ? resolveInsertedSubtreeNodes(expression.arguments[0], context)
      : undefined
    : (tryResolveCloneElementRenderNodes(expression, context) ??
      (isCloneElementPreservationCallExpression(expression, context)
        ? expression.arguments[0]
          ? resolveInsertedSubtreeNodes(expression.arguments[0], context)
          : undefined
        : undefined));

  if (!subtreeNodes) {
    return undefined;
  }

  return {
    kind: "fragment",
    sourceAnchor: toSourceAnchor(expression, context.parsedSourceFile, context.filePath),
    children: subtreeNodes,
  };
}

function tryResolveReactChildrenCollectionNodes(
  expression: ts.CallExpression,
  context: BuildContext,
  state?: RenderExpressionResolutionState,
): RenderNode[] | undefined {
  const mapExpression = getReactChildrenMapExpression(expression);
  if (!mapExpression) {
    return undefined;
  }

  const callback = unwrapRenderableExpression(mapExpression.callback);
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) {
    return undefined;
  }

  if (!hasSupportedChildrenMapCallbackParameters(callback)) {
    return undefined;
  }

  const callbackBodyExpression = summarizeFunctionBodyExpression(callback.body);
  if (!callbackBodyExpression) {
    return undefined;
  }

  const sourceSubtreeNodes = resolveInsertedSubtreeNodes(
    mapExpression.sourceExpression,
    context,
    state ?? {
      activeExpressions: new Set(),
      depth: 0,
    },
  );
  if (!sourceSubtreeNodes) {
    return undefined;
  }

  const mappedNodes: RenderNode[] = [];
  for (let index = 0; index < sourceSubtreeNodes.length; index += 1) {
    mappedNodes.push(
      buildRenderNode(
        callbackBodyExpression,
        buildChildrenMapCallbackContext({
          context,
          callback,
          childNode: sourceSubtreeNodes[index],
          index,
        }),
      ),
    );
  }

  return mappedNodes;
}

function getReactChildrenMapExpression(expression: ts.CallExpression):
  | {
      sourceExpression: ts.Expression;
      callback: ts.Expression;
    }
  | undefined {
  if (isChildrenMapCallExpression(expression)) {
    return {
      sourceExpression: expression.arguments[0],
      callback: expression.arguments[1],
    };
  }

  if (
    ts.isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === "map" &&
    expression.arguments.length === 1 &&
    ts.isCallExpression(expression.expression.expression) &&
    isChildrenToArrayCallExpression(expression.expression.expression)
  ) {
    return {
      sourceExpression: expression.expression.expression.arguments[0],
      callback: expression.arguments[0],
    };
  }

  return undefined;
}

function isChildrenMapCallExpression(expression: ts.CallExpression): boolean {
  return (
    expression.arguments.length === 2 &&
    ts.isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === "map" &&
    isChildrenNamespaceExpression(expression.expression.expression)
  );
}

function isChildrenToArrayCallExpression(expression: ts.CallExpression): boolean {
  return (
    expression.arguments.length === 1 &&
    ts.isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === "toArray" &&
    isChildrenNamespaceExpression(expression.expression.expression)
  );
}

function hasSupportedChildrenMapCallbackParameters(
  callback: ts.ArrowFunction | ts.FunctionExpression,
): boolean {
  return (
    callback.parameters.length <= 2 &&
    callback.parameters.every((parameter) => ts.isIdentifier(parameter.name))
  );
}

function summarizeFunctionBodyExpression(body: ts.ConciseBody): ts.Expression | undefined {
  if (!ts.isBlock(body)) {
    return body;
  }

  for (const statement of body.statements) {
    if (ts.isReturnStatement(statement) && statement.expression) {
      return statement.expression;
    }
  }

  return undefined;
}

function buildChildrenMapCallbackContext(input: {
  context: BuildContext;
  callback: ts.ArrowFunction | ts.FunctionExpression;
  childNode: RenderNode;
  index: number;
}): BuildContext {
  const [childParameter, indexParameter] = input.callback.parameters;
  const subtreeBindings = new Map(input.context.subtreeBindings);
  const subtreeBindingsBySymbolId = new Map(input.context.subtreeBindingsBySymbolId);
  const expressionBindings = new Map<string, ts.Expression>();
  const expressionBindingsBySymbolId = new Map<string, ts.Expression>();

  if (childParameter && ts.isIdentifier(childParameter.name)) {
    subtreeBindings.set(childParameter.name.text, [input.childNode]);
    const childSymbol = resolveDeclaredValueSymbol({
      declaration: childParameter.name,
      filePath: input.context.filePath,
      parsedSourceFile: input.context.parsedSourceFile,
      symbolResolution: input.context.symbolResolution,
    });
    if (childSymbol) {
      subtreeBindingsBySymbolId.set(childSymbol.id, [input.childNode]);
    }
  }

  if (indexParameter && ts.isIdentifier(indexParameter.name)) {
    const indexExpression = ts.factory.createNumericLiteral(input.index);
    expressionBindings.set(indexParameter.name.text, indexExpression);
    const indexSymbol = resolveDeclaredValueSymbol({
      declaration: indexParameter.name,
      filePath: input.context.filePath,
      parsedSourceFile: input.context.parsedSourceFile,
      symbolResolution: input.context.symbolResolution,
    });
    if (indexSymbol) {
      expressionBindingsBySymbolId.set(indexSymbol.id, indexExpression);
    }
  }

  return {
    ...input.context,
    expressionBindings: mergeExpressionBindings(
      input.context.expressionBindings,
      expressionBindings,
    ),
    expressionBindingsBySymbolId: mergeExpressionBindings(
      input.context.expressionBindingsBySymbolId,
      expressionBindingsBySymbolId,
    ),
    subtreeBindings,
    subtreeBindingsBySymbolId,
  };
}

function isPropsObjectReference(identifier: ts.Identifier, context: BuildContext): boolean {
  const resolvedSymbol = resolveReferenceAtIdentifier(identifier, context);
  if (resolvedSymbol && context.propsObjectBindingSymbolId) {
    return resolvedSymbol.id === context.propsObjectBindingSymbolId;
  }

  return Boolean(
    context.propsObjectBindingName && identifier.text === context.propsObjectBindingName,
  );
}

function resolveReferenceAtIdentifier(identifier: ts.Identifier, context: BuildContext) {
  const location = getNodeLocation(identifier, context.parsedSourceFile);
  return resolveReferenceAt({
    symbolResolution: context.symbolResolution,
    filePath: context.filePath,
    line: location.line,
    column: location.column,
    symbolSpace: "value",
  });
}

function getNodeLocation(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): {
  line: number;
  column: number;
} {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    line: position.line + 1,
    column: position.character + 1,
  };
}

function tryResolveCloneElementRenderNodes(
  expression: ts.CallExpression,
  context: BuildContext,
  state?: RenderExpressionResolutionState,
): RenderNode[] | undefined {
  if (!isCloneElementExpression(expression.expression) || expression.arguments.length !== 2) {
    return undefined;
  }

  const [childExpression, propsExpression] = expression.arguments;
  const classNameExpression = getCloneElementClassNameExpression(propsExpression, context);
  if (!classNameExpression) {
    return undefined;
  }

  const subtreeNodes = resolveInsertedSubtreeNodes(
    childExpression,
    context,
    state ?? {
      activeExpressions: new Set(),
      depth: 0,
    },
  );
  if (!subtreeNodes || subtreeNodes.length !== 1) {
    return undefined;
  }

  return applyCloneElementClassName(subtreeNodes[0], classNameExpression, childExpression, context)
    ?.nodes;
}

function getCloneElementClassNameExpression(
  expression: ts.Expression,
  context: BuildContext,
): ts.Expression | undefined {
  expression = unwrapRenderableExpression(expression);

  const boundExpression = resolveBoundExpression(expression, context);
  if (boundExpression) {
    return getCloneElementClassNameExpression(boundExpression, context);
  }

  if (!ts.isObjectLiteralExpression(expression)) {
    return undefined;
  }

  for (const property of expression.properties) {
    if (ts.isSpreadAssignment(property)) {
      return undefined;
    }

    if (
      ts.isPropertyAssignment(property) &&
      getStaticPropertyNameText(property.name) === "className"
    ) {
      return property.initializer;
    }

    if (
      ts.isShorthandPropertyAssignment(property) &&
      getStaticPropertyNameText(property.name) === "className"
    ) {
      return property.name;
    }
  }

  return undefined;
}

function applyCloneElementClassName(
  node: RenderNode,
  classNameExpression: ts.Expression,
  childExpression: ts.Expression,
  context: BuildContext,
): { nodes: RenderNode[]; className?: ClassExpressionSummary } | undefined {
  if (node.kind === "element") {
    const className = summarizeCloneElementClassName(
      classNameExpression,
      node.className,
      childExpression,
      context,
    );
    return {
      nodes: [
        {
          ...node,
          className,
        },
      ],
      className,
    };
  }

  if (node.kind === "fragment" && node.children.length === 1) {
    const clonedChild = applyCloneElementClassName(
      node.children[0],
      classNameExpression,
      childExpression,
      context,
    );
    if (!clonedChild) {
      return undefined;
    }

    return {
      nodes: [
        {
          ...node,
          children: clonedChild.nodes,
        },
      ],
      className: clonedChild.className,
    };
  }

  if (node.kind === "conditional") {
    const whenTrue = applyCloneElementClassName(
      node.whenTrue,
      classNameExpression,
      childExpression,
      context,
    );
    const whenFalse = applyCloneElementClassName(
      node.whenFalse,
      classNameExpression,
      childExpression,
      context,
    );
    if (!whenTrue || !whenFalse || whenTrue.nodes.length !== 1 || whenFalse.nodes.length !== 1) {
      return undefined;
    }

    return {
      nodes: [
        {
          ...node,
          whenTrue: whenTrue.nodes[0],
          whenFalse: whenFalse.nodes[0],
        },
      ],
    };
  }

  return undefined;
}

function summarizeCloneElementClassName(
  classNameExpression: ts.Expression,
  originalClassName: ClassExpressionSummary | undefined,
  childExpression: ts.Expression,
  context: BuildContext,
): ClassExpressionSummary {
  const overrideClassName = summarizeClassNameExpressionForRender(classNameExpression, context);
  if (
    !originalClassName ||
    !containsChildPropsClassNameReference(classNameExpression, childExpression)
  ) {
    return overrideClassName;
  }

  const value = mergeClassNameValues(
    [originalClassName.value, overrideClassName.value],
    "cloneElement className merge",
  );
  const classNameSourceAnchors = mergeClassNameSourceAnchors([
    originalClassName.classNameSourceAnchors,
    overrideClassName.classNameSourceAnchors,
  ]);

  return {
    sourceAnchor: overrideClassName.sourceAnchor,
    value,
    classes: toAbstractClassSet(value, overrideClassName.sourceAnchor),
    classNameSourceAnchors,
    sourceText: overrideClassName.sourceText,
    traces: buildClassExpressionTraces({
      sourceAnchor: overrideClassName.sourceAnchor,
      sourceText: overrideClassName.sourceText,
      value,
      includeTraces: context.includeTraces,
    }),
  };
}

function containsChildPropsClassNameReference(
  expression: ts.Expression,
  childExpression: ts.Expression,
): boolean {
  const childName = ts.isIdentifier(childExpression) ? childExpression.text : undefined;
  let found = false;

  const visit = (node: ts.Node): void => {
    if (found) {
      return;
    }

    if (ts.isPropertyAccessExpression(node) && node.name.text === "className") {
      const propsExpression = node.expression;
      if (
        ts.isPropertyAccessExpression(propsExpression) &&
        propsExpression.name.text === "props" &&
        (!childName ||
          (ts.isIdentifier(propsExpression.expression) &&
            propsExpression.expression.text === childName))
      ) {
        found = true;
        return;
      }
    }

    if (ts.isElementAccessExpression(node) && isStaticClassNameAccess(node.argumentExpression)) {
      const propsExpression = node.expression;
      if (
        ts.isPropertyAccessExpression(propsExpression) &&
        propsExpression.name.text === "props" &&
        (!childName ||
          (ts.isIdentifier(propsExpression.expression) &&
            propsExpression.expression.text === childName))
      ) {
        found = true;
        return;
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(expression);
  return found;
}

function isStaticClassNameAccess(expression: ts.Expression | undefined): boolean {
  if (!expression) {
    return false;
  }

  expression = unwrapRenderableExpression(expression);
  return (
    (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) &&
    expression.text === "className"
  );
}

function mergeClassNameSourceAnchors(
  entries: Array<Record<string, SourceAnchor> | undefined>,
): Record<string, SourceAnchor> | undefined {
  const merged: Record<string, SourceAnchor> = {};
  for (const entry of entries) {
    if (!entry) {
      continue;
    }

    for (const [className, sourceAnchor] of Object.entries(entry)) {
      merged[className] ??= sourceAnchor;
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function isChildrenOnlyCallExpression(expression: ts.CallExpression): boolean {
  if (expression.arguments.length !== 1) {
    return false;
  }

  if (ts.isPropertyAccessExpression(expression.expression)) {
    return (
      expression.expression.name.text === "only" &&
      isChildrenNamespaceExpression(expression.expression.expression)
    );
  }

  return false;
}

function isCloneElementPreservationCallExpression(
  expression: ts.CallExpression,
  context: BuildContext,
): boolean {
  if (expression.arguments.length < 1 || expression.arguments.length > 2) {
    return false;
  }

  if (!isCloneElementExpression(expression.expression)) {
    return false;
  }

  const propsExpression = expression.arguments[1];
  return !propsExpression || isCloneElementPropsPreservationOnly(propsExpression, context);
}

function isCloneElementPropsPreservationOnly(
  expression: ts.Expression,
  context: BuildContext,
): boolean {
  expression = unwrapRenderableExpression(expression);

  if (expression.kind === ts.SyntaxKind.NullKeyword || isUndefinedIdentifier(expression)) {
    return true;
  }

  const boundExpression = resolveBoundExpression(expression, context);
  if (boundExpression) {
    return isCloneElementPropsPreservationOnly(boundExpression, context);
  }

  if (!ts.isObjectLiteralExpression(expression)) {
    return false;
  }

  for (const property of expression.properties) {
    if (ts.isSpreadAssignment(property)) {
      return false;
    }

    if (
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      getStaticPropertyNameText(property.name) === "className"
    ) {
      return false;
    }
  }

  return true;
}

function isCloneElementExpression(expression: ts.Expression): boolean {
  return (
    (ts.isIdentifier(expression) && expression.text === "cloneElement") ||
    (ts.isPropertyAccessExpression(expression) &&
      expression.name.text === "cloneElement" &&
      isReactNamespaceExpression(expression.expression))
  );
}

function isChildrenNamespaceExpression(expression: ts.Expression): boolean {
  return (
    (ts.isIdentifier(expression) && expression.text === "Children") ||
    (ts.isPropertyAccessExpression(expression) &&
      expression.name.text === "Children" &&
      isReactNamespaceExpression(expression.expression))
  );
}

function isReactNamespaceExpression(expression: ts.Expression): boolean {
  return ts.isIdentifier(expression) && expression.text === "React";
}

function getStaticPropertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return undefined;
}

function unwrapRenderableExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

function nextRenderExpressionResolutionState(
  state: RenderExpressionResolutionState,
): RenderExpressionResolutionState {
  return {
    activeExpressions: state.activeExpressions,
    depth: state.depth + 1,
  };
}

function getRenderExpressionResolutionKey(
  expression: ts.Expression,
  context: BuildContext,
): string {
  return `${context.filePath}:${expression.pos}:${expression.end}:${expression.kind}`;
}
