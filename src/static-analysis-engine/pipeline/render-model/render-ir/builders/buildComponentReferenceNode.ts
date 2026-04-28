import ts from "typescript";

import type { SameFileComponentDefinition } from "../collection/shared/types.js";
import { resolveDeclaredValueSymbol } from "../collection/shared/indexExpressionBindingsBySymbolId.js";
import { isRenderableExpression } from "../collection/shared/renderableExpressionGuards.js";
import type { BuildContext } from "../shared/internalTypes.js";
import { MAX_LOCAL_COMPONENT_EXPANSION_DEPTH } from "../../../../libraries/policy/index.js";
import {
  buildComponentExpansionReason,
  buildUnsupportedParameterExpansionReason,
  COMPONENT_DEFINITION_NOT_FOUND_REASON,
  getExpansionScope,
} from "../shared/expansionSemantics.js";
import {
  applyComponentReferenceExpansion,
  applyPlacementAnchor,
  createRenderExpansionTrace,
  toSourceAnchor,
} from "../shared/renderIrUtils.js";
import { resolveAliasedValueSymbolForIdentifier } from "../shared/resolveAliasedValueSymbol.js";
import {
  bindExpression,
  mergeExpressionBindings,
  mergeHelperDefinitions,
  resolveBoundExpression,
  resolveBoundExpressionContext,
} from "../resolution/resolveBindings.js";
import type { ExpressionBinding } from "../shared/internalTypes.js";
import type { RenderNode } from "../types.js";
import { buildChildren, summarizeClassAttribute } from "./buildIntrinsicNode.js";
import { resolveReferenceAt } from "../../../symbol-resolution/index.js";

export function buildComponentReferenceNode(
  tagNameNode: ts.JsxTagNameExpression,
  attributes: ts.JsxAttributes,
  children: readonly ts.JsxChild[],
  context: BuildContext,
  buildRenderNode: (node: ts.Expression | ts.JsxChild, context: BuildContext) => RenderNode,
): RenderNode {
  const componentName = tagNameNode.getText(context.parsedSourceFile);
  const definition =
    resolveComponentDefinition(tagNameNode, context) ??
    context.componentsByFilePath.get(context.currentComponentFilePath)?.get(componentName);
  if (!definition) {
    const sourceAnchor = toSourceAnchor(tagNameNode, context.parsedSourceFile, context.filePath);
    return {
      kind: "component-reference",
      sourceAnchor,
      componentName,
      className: summarizeClassAttribute(attributes, context),
      reason: COMPONENT_DEFINITION_NOT_FOUND_REASON,
      traces: context.includeTraces
        ? [
            createRenderExpansionTrace({
              traceId: "render-expansion:component-reference:not-found",
              summary: `could not resolve component reference "${componentName}" for render expansion`,
              anchor: sourceAnchor,
              metadata: {
                componentName,
                reason: COMPONENT_DEFINITION_NOT_FOUND_REASON,
              },
            }),
          ]
        : [],
    };
  }

  const expansionScope = getExpansionScope(context.currentComponentFilePath, definition.filePath);
  const resolvedComponentName = definition.componentName;

  if (context.expansionStack.includes(resolvedComponentName)) {
    const sourceAnchor = toSourceAnchor(tagNameNode, context.parsedSourceFile, context.filePath);
    const reason = buildComponentExpansionReason(expansionScope, "cycle");
    return {
      kind: "component-reference",
      sourceAnchor,
      componentName,
      reason,
      traces: context.includeTraces
        ? [
            createRenderExpansionTrace({
              traceId: "render-expansion:component-reference:cycle",
              summary: `stopped expanding component reference "${componentName}" because expansion would cycle`,
              anchor: sourceAnchor,
              metadata: {
                componentName,
                reason,
              },
            }),
          ]
        : [],
    };
  }

  if (context.currentDepth >= MAX_LOCAL_COMPONENT_EXPANSION_DEPTH) {
    const sourceAnchor = toSourceAnchor(tagNameNode, context.parsedSourceFile, context.filePath);
    const reason = buildComponentExpansionReason(expansionScope, "budgetExceeded");
    return {
      kind: "component-reference",
      sourceAnchor,
      componentName,
      reason,
      traces: context.includeTraces
        ? [
            createRenderExpansionTrace({
              traceId: "render-expansion:component-reference:budget-exceeded",
              summary: `stopped expanding component reference "${componentName}" because the render expansion budget was exceeded`,
              anchor: sourceAnchor,
              metadata: {
                componentName,
                reason,
              },
            }),
          ]
        : [],
    };
  }

  const expansionBinding = buildComponentExpansionBindings(
    definition,
    attributes,
    children,
    expansionScope,
    context,
    buildRenderNode,
  );
  if ("reason" in expansionBinding) {
    const sourceAnchor = toSourceAnchor(tagNameNode, context.parsedSourceFile, context.filePath);
    return {
      kind: "component-reference",
      sourceAnchor,
      componentName,
      reason: expansionBinding.reason,
      traces: context.includeTraces
        ? [
            createRenderExpansionTrace({
              traceId: "render-expansion:component-reference:unsupported",
              summary: `stopped expanding component reference "${componentName}" because prop or children binding is unsupported in the current bounded slice`,
              anchor: sourceAnchor,
              metadata: {
                componentName,
                reason: expansionBinding.reason,
              },
            }),
          ]
        : [],
    };
  }

  const sourceAnchor = toSourceAnchor(tagNameNode, context.parsedSourceFile, context.filePath);
  const expansionTraces = context.includeTraces
    ? [
        createRenderExpansionTrace({
          traceId: `render-expansion:component-reference:expanded:${context.filePath}:${componentName}:${sourceAnchor.startLine}:${sourceAnchor.startColumn}`,
          summary: `expanded component reference "${componentName}" into render IR`,
          anchor: sourceAnchor,
          metadata: {
            componentName,
            targetComponentName: definition.componentName,
            targetFilePath: definition.filePath,
          },
        }),
      ]
    : [];

  return applyPlacementAnchor(
    applyComponentReferenceExpansion(
      buildRenderNode(definition.rootExpression, {
        ...context,
        filePath: definition.filePath,
        parsedSourceFile: definition.parsedSourceFile,
        currentComponentFilePath: definition.filePath,
        currentDepth: context.currentDepth + 1,
        expansionStack: [...context.expansionStack, resolvedComponentName],
        expressionBindings: mergeExpressionBindings(
          expansionBinding.expressionBindings,
          definition.localExpressionBindings,
        ),
        expressionBindingsBySymbolId: mergeExpressionBindings(
          mergeExpressionBindings(
            context.topLevelExpressionBindingsBySymbolIdByFilePath.get(definition.filePath) ??
              new Map(),
            expansionBinding.expressionBindingsBySymbolId,
          ),
          definition.localExpressionBindingsBySymbolId,
        ),
        stringSetBindings: mergeStringSetBindings(
          expansionBinding.stringSetBindings,
          definition.localStringSetBindings,
        ),
        helperDefinitions: mergeHelperDefinitions(
          context.topLevelHelperDefinitionsByFilePath.get(definition.filePath) ?? new Map(),
          definition.localHelperDefinitions,
        ),
        topLevelHelperDefinitionsByFilePath: context.topLevelHelperDefinitionsByFilePath,
        topLevelExpressionBindingsBySymbolIdByFilePath:
          context.topLevelExpressionBindingsBySymbolIdByFilePath,
        helperExpansionStack: [],
        propsObjectBindingName: expansionBinding.propsObjectBindingName,
        propsObjectBindingSymbolId: expansionBinding.propsObjectBindingSymbolId,
        propsObjectProperties: expansionBinding.propsObjectProperties,
        propsObjectSubtreeProperties: expansionBinding.propsObjectSubtreeProperties,
        subtreeBindings: expansionBinding.subtreeBindings,
        subtreeBindingsBySymbolId: expansionBinding.subtreeBindingsBySymbolId,
      }),
      {
        componentName: definition.componentName,
        filePath: definition.filePath,
        targetSourceAnchor: definition.sourceAnchor,
        sourceAnchor,
        traces: expansionTraces,
      },
    ),
    sourceAnchor,
  );
}

function mergeStringSetBindings(
  baseBindings: Map<string, string[]>,
  localBindings: Map<string, string[]>,
): Map<string, string[]> {
  const merged = new Map(baseBindings);
  for (const [identifierName, values] of localBindings.entries()) {
    merged.set(identifierName, values);
  }

  return merged;
}

function resolveComponentDefinition(
  tagNameNode: ts.JsxTagNameExpression,
  context: BuildContext,
): SameFileComponentDefinition | undefined {
  if (ts.isIdentifier(tagNameNode)) {
    const aliasedSymbol = resolveAliasedValueSymbolForIdentifier({
      identifier: tagNameNode,
      filePath: context.filePath,
      parsedSourceFile: context.parsedSourceFile,
      symbolResolution: context.symbolResolution,
    });
    if (aliasedSymbol) {
      return context.componentsByFilePath
        .get(context.currentComponentFilePath)
        ?.get(aliasedSymbol.localName);
    }
  }

  if (ts.isPropertyAccessExpression(tagNameNode) && ts.isIdentifier(tagNameNode.expression)) {
    const location = getNodeLocation(tagNameNode.expression, context.parsedSourceFile);
    const resolvedNamespaceSymbol = resolveReferenceAt({
      symbolResolution: context.symbolResolution,
      filePath: context.filePath,
      line: location.line,
      column: location.column,
      symbolSpace: "value",
    });
    if (resolvedNamespaceSymbol) {
      return context.namespaceComponentDefinitionsBySymbolId
        .get(resolvedNamespaceSymbol.id)
        ?.get(tagNameNode.name.text);
    }
  }

  return undefined;
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

function buildComponentExpansionBindings(
  definition: SameFileComponentDefinition,
  attributes: ts.JsxAttributes,
  children: readonly ts.JsxChild[],
  expansionScope: import("../shared/expansionSemantics.js").ExpansionScope,
  context: BuildContext,
  buildRenderNode: (node: ts.Expression | ts.JsxChild, context: BuildContext) => RenderNode,
):
  | {
      expressionBindings: Map<string, ExpressionBinding>;
      expressionBindingsBySymbolId: Map<string, ExpressionBinding>;
      stringSetBindings: Map<string, string[]>;
      propsObjectBindingName?: string;
      propsObjectBindingSymbolId?: string;
      propsObjectProperties: Map<string, ExpressionBinding>;
      propsObjectSubtreeProperties: Map<string, RenderNode[]>;
      subtreeBindings: Map<string, RenderNode[]>;
      subtreeBindingsBySymbolId: Map<string, RenderNode[]>;
    }
  | {
      reason: string;
    } {
  const attributeExpressions = collectLocalComponentAttributeExpressions(
    attributes,
    expansionScope,
    context,
    buildRenderNode,
  );
  if ("reason" in attributeExpressions) {
    return { reason: attributeExpressions.reason };
  }

  if (definition.parameterBinding.kind === "unsupported") {
    return {
      reason: buildUnsupportedParameterExpansionReason(
        expansionScope,
        definition.parameterBinding.reason,
      ),
    };
  }

  if (definition.parameterBinding.kind === "none") {
    if (
      attributeExpressions.properties.size > 0 ||
      attributeExpressions.subtreeProperties.size > 0
    ) {
      return {
        reason: buildComponentExpansionReason(expansionScope, "unsupportedProps"),
      };
    }

    if (children.length > 0) {
      return {
        reason: buildComponentExpansionReason(expansionScope, "childrenNotConsumed"),
      };
    }

    return {
      expressionBindings: new Map(),
      expressionBindingsBySymbolId: new Map(),
      stringSetBindings: new Map(),
      propsObjectProperties: new Map(),
      propsObjectSubtreeProperties: new Map(),
      subtreeBindings: new Map(),
      subtreeBindingsBySymbolId: new Map(),
    };
  }

  const childrenNodes = buildChildren(children, context, buildRenderNode);
  if (definition.parameterBinding.kind === "props-identifier") {
    const propsObjectSubtreeProperties = new Map(attributeExpressions.subtreeProperties);
    const propsObjectSymbol = resolveDeclaredValueSymbol({
      declaration: definition.parameterBinding.declaration,
      filePath: definition.filePath,
      parsedSourceFile: definition.parsedSourceFile,
      symbolResolution: context.symbolResolution,
    });
    if (childrenNodes.length > 0) {
      propsObjectSubtreeProperties.set("children", childrenNodes);
    }

    return {
      expressionBindings: new Map(),
      expressionBindingsBySymbolId: new Map(),
      stringSetBindings: new Map(),
      propsObjectBindingName: definition.parameterBinding.identifierName,
      propsObjectBindingSymbolId: propsObjectSymbol?.id,
      propsObjectProperties: attributeExpressions.properties,
      propsObjectSubtreeProperties,
      subtreeBindings: new Map(),
      subtreeBindingsBySymbolId: new Map(),
    };
  }

  const expressionBindings = new Map<string, ExpressionBinding>();
  const expressionBindingsBySymbolId = new Map<string, ExpressionBinding>();
  const stringSetBindings = new Map<string, string[]>();
  const subtreeBindings = new Map<string, RenderNode[]>();
  const subtreeBindingsBySymbolId = new Map<string, RenderNode[]>();
  for (const property of definition.parameterBinding.properties) {
    const boundExpression = attributeExpressions.properties.get(property.propertyName);
    if (boundExpression) {
      expressionBindings.set(property.identifierName, boundExpression);
      const propertySymbol = property.declaration
        ? resolveDeclaredValueSymbol({
            declaration: property.declaration,
            filePath: definition.filePath,
            parsedSourceFile: definition.parsedSourceFile,
            symbolResolution: context.symbolResolution,
          })
        : undefined;
      if (propertySymbol) {
        expressionBindingsBySymbolId.set(propertySymbol.id, boundExpression);
      }
    } else if (property.initializer) {
      const initializerBinding = bindExpression(property.initializer, context);
      expressionBindings.set(property.identifierName, initializerBinding);
      const propertySymbol = property.declaration
        ? resolveDeclaredValueSymbol({
            declaration: property.declaration,
            filePath: definition.filePath,
            parsedSourceFile: definition.parsedSourceFile,
            symbolResolution: context.symbolResolution,
          })
        : undefined;
      if (propertySymbol) {
        expressionBindingsBySymbolId.set(propertySymbol.id, initializerBinding);
      }
    }

    if (!boundExpression && property.finiteStringValues) {
      stringSetBindings.set(property.identifierName, property.finiteStringValues);
    }

    const boundSubtree = attributeExpressions.subtreeProperties.get(property.propertyName);
    if (boundSubtree) {
      subtreeBindings.set(property.identifierName, boundSubtree);
      const propertySymbol = property.declaration
        ? resolveDeclaredValueSymbol({
            declaration: property.declaration,
            filePath: definition.filePath,
            parsedSourceFile: definition.parsedSourceFile,
            symbolResolution: context.symbolResolution,
          })
        : undefined;
      if (propertySymbol) {
        subtreeBindingsBySymbolId.set(propertySymbol.id, boundSubtree);
      }
    }
  }

  const childrenProperty = definition.parameterBinding.properties.find(
    (property) => property.propertyName === "children",
  );
  if (childrenProperty?.identifierName && childrenNodes.length > 0) {
    subtreeBindings.set(childrenProperty.identifierName, childrenNodes);
    const childrenSymbol = childrenProperty.declaration
      ? resolveDeclaredValueSymbol({
          declaration: childrenProperty.declaration,
          filePath: definition.filePath,
          parsedSourceFile: definition.parsedSourceFile,
          symbolResolution: context.symbolResolution,
        })
      : undefined;
    if (childrenSymbol) {
      subtreeBindingsBySymbolId.set(childrenSymbol.id, childrenNodes);
    }
  }

  return {
    expressionBindings,
    expressionBindingsBySymbolId,
    stringSetBindings,
    propsObjectProperties: attributeExpressions.properties,
    propsObjectSubtreeProperties: new Map(attributeExpressions.subtreeProperties),
    subtreeBindings,
    subtreeBindingsBySymbolId,
  };
}

function collectLocalComponentAttributeExpressions(
  attributes: ts.JsxAttributes,
  expansionScope: import("../shared/expansionSemantics.js").ExpansionScope,
  context: BuildContext,
  buildRenderNode: (node: ts.Expression | ts.JsxChild, context: BuildContext) => RenderNode,
):
  | {
      properties: Map<string, ExpressionBinding>;
      subtreeProperties: Map<string, RenderNode[]>;
    }
  | {
      reason: string;
    } {
  const properties = new Map<string, ExpressionBinding>();
  const subtreeProperties = new Map<string, RenderNode[]>();

  for (const property of attributes.properties) {
    if (ts.isJsxSpreadAttribute(property)) {
      return {
        reason: buildComponentExpansionReason(expansionScope, "unsupportedProps"),
      };
    }

    if (!ts.isIdentifier(property.name)) {
      return {
        reason: buildComponentExpansionReason(expansionScope, "unsupportedProps"),
      };
    }

    const expression = property.initializer
      ? unwrapJsxAttributeInitializer(property.initializer)
      : ts.factory.createTrue();
    if (!expression) {
      return {
        reason: buildComponentExpansionReason(expansionScope, "unsupportedProps"),
      };
    }

    const boundExpression =
      resolveBoundExpressionContext(expression, context) ?? bindExpression(expression, context);
    properties.set(
      property.name.text,
      bindExpression(boundExpression.expression, boundExpression.context),
    );

    const renderableExpression = resolveRenderableExpression(
      boundExpression.expression,
      boundExpression.context,
    );
    if (renderableExpression) {
      subtreeProperties.set(property.name.text, [
        buildRenderNode(renderableExpression, boundExpression.context),
      ]);
    }
  }

  return { properties, subtreeProperties };
}

function resolveRenderableExpression(
  expression: ts.Expression,
  context: BuildContext,
): ts.Expression | undefined {
  if (isRenderableExpression(expression)) {
    return expression;
  }

  const boundExpression = resolveBoundExpression(expression, context);
  if (boundExpression && isRenderableExpression(boundExpression)) {
    return boundExpression;
  }

  return undefined;
}

function unwrapJsxAttributeInitializer(
  initializer: ts.JsxAttribute["initializer"],
): ts.Expression | undefined {
  if (!initializer) {
    return undefined;
  }

  if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) {
    return initializer;
  }

  if (
    ts.isJsxElement(initializer) ||
    ts.isJsxSelfClosingElement(initializer) ||
    ts.isJsxFragment(initializer)
  ) {
    return initializer;
  }

  if (ts.isJsxExpression(initializer)) {
    return initializer.expression ?? undefined;
  }

  return undefined;
}
