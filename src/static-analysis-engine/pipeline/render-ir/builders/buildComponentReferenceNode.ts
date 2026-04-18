import ts from "typescript";

import type { SameFileComponentDefinition } from "../collection/types.js";
import { isRenderableExpression } from "../collection/renderableExpressionGuards.js";
import type { BuildContext } from "../shared/internalTypes.js";
import {
  buildUnsupportedParameterExpansionReason,
  LOCAL_COMPONENT_EXPANSION_REASONS,
  MAX_LOCAL_COMPONENT_EXPANSION_DEPTH,
} from "../shared/expansionPolicy.js";
import { toSourceAnchor } from "../shared/renderIrUtils.js";
import { mergeExpressionBindings, mergeHelperDefinitions } from "../resolution/resolveBindings.js";
import type { RenderNode } from "../types.js";
import { buildChildren } from "./buildIntrinsicNode.js";

export function buildComponentReferenceNode(
  tagNameNode: ts.JsxTagNameExpression,
  attributes: ts.JsxAttributes,
  children: readonly ts.JsxChild[],
  context: BuildContext,
  buildRenderNode: (node: ts.Expression | ts.JsxChild, context: BuildContext) => RenderNode,
): RenderNode {
  const componentName = tagNameNode.getText(context.parsedSourceFile);
  const definition = context.componentsByName.get(componentName);
  if (!definition) {
    return {
      kind: "component-reference",
      sourceAnchor: toSourceAnchor(tagNameNode, context.parsedSourceFile, context.filePath),
      componentName,
      reason: LOCAL_COMPONENT_EXPANSION_REASONS.definitionNotFound,
    };
  }

  if (context.expansionStack.includes(componentName)) {
    return {
      kind: "component-reference",
      sourceAnchor: toSourceAnchor(tagNameNode, context.parsedSourceFile, context.filePath),
      componentName,
      reason: LOCAL_COMPONENT_EXPANSION_REASONS.cycle,
    };
  }

  if (context.currentDepth >= MAX_LOCAL_COMPONENT_EXPANSION_DEPTH) {
    return {
      kind: "component-reference",
      sourceAnchor: toSourceAnchor(tagNameNode, context.parsedSourceFile, context.filePath),
      componentName,
      reason: LOCAL_COMPONENT_EXPANSION_REASONS.budgetExceeded,
    };
  }

  const expansionBinding = buildComponentExpansionBindings(
    definition,
    attributes,
    children,
    context,
    buildRenderNode,
  );
  if ("reason" in expansionBinding) {
    return {
      kind: "component-reference",
      sourceAnchor: toSourceAnchor(tagNameNode, context.parsedSourceFile, context.filePath),
      componentName,
      reason: expansionBinding.reason,
    };
  }

  return buildRenderNode(definition.rootExpression, {
    ...context,
    currentDepth: context.currentDepth + 1,
    expansionStack: [...context.expansionStack, componentName],
    expressionBindings: mergeExpressionBindings(
      expansionBinding.expressionBindings,
      definition.localExpressionBindings,
    ),
    helperDefinitions: mergeHelperDefinitions(
      context.helperDefinitions,
      definition.localHelperDefinitions,
    ),
    helperExpansionStack: [],
    propsObjectBindingName: expansionBinding.propsObjectBindingName,
    propsObjectProperties: expansionBinding.propsObjectProperties,
    propsObjectSubtreeProperties: expansionBinding.propsObjectSubtreeProperties,
    subtreeBindings: expansionBinding.subtreeBindings,
  });
}

function buildComponentExpansionBindings(
  definition: SameFileComponentDefinition,
  attributes: ts.JsxAttributes,
  children: readonly ts.JsxChild[],
  context: BuildContext,
  buildRenderNode: (node: ts.Expression | ts.JsxChild, context: BuildContext) => RenderNode,
):
  | {
      expressionBindings: Map<string, ts.Expression>;
      propsObjectBindingName?: string;
      propsObjectProperties: Map<string, ts.Expression>;
      propsObjectSubtreeProperties: Map<string, RenderNode[]>;
      subtreeBindings: Map<string, RenderNode[]>;
    }
  | {
      reason: string;
    } {
  const attributeExpressions = collectLocalComponentAttributeExpressions(
    attributes,
    context,
    buildRenderNode,
  );
  if ("reason" in attributeExpressions) {
    return { reason: attributeExpressions.reason };
  }

  if (definition.parameterBinding.kind === "unsupported") {
    return {
      reason: buildUnsupportedParameterExpansionReason(definition.parameterBinding.reason),
    };
  }

  if (definition.parameterBinding.kind === "none") {
    if (
      attributeExpressions.properties.size > 0 ||
      attributeExpressions.subtreeProperties.size > 0
    ) {
      return { reason: LOCAL_COMPONENT_EXPANSION_REASONS.unsupportedProps };
    }

    if (children.length > 0) {
      return { reason: LOCAL_COMPONENT_EXPANSION_REASONS.childrenNotConsumed };
    }

    return {
      expressionBindings: new Map(),
      propsObjectProperties: new Map(),
      propsObjectSubtreeProperties: new Map(),
      subtreeBindings: new Map(),
    };
  }

  const childrenNodes = buildChildren(children, context, buildRenderNode);
  if (definition.parameterBinding.kind === "props-identifier") {
    const propsObjectSubtreeProperties = new Map(attributeExpressions.subtreeProperties);
    if (childrenNodes.length > 0) {
      propsObjectSubtreeProperties.set("children", childrenNodes);
    }

    return {
      expressionBindings: new Map(),
      propsObjectBindingName: definition.parameterBinding.identifierName,
      propsObjectProperties: attributeExpressions.properties,
      propsObjectSubtreeProperties,
      subtreeBindings: new Map(),
    };
  }

  const expressionBindings = new Map<string, ts.Expression>();
  const subtreeBindings = new Map<string, RenderNode[]>();
  for (const property of definition.parameterBinding.properties) {
    const boundExpression = attributeExpressions.properties.get(property.propertyName);
    if (boundExpression) {
      expressionBindings.set(property.identifierName, boundExpression);
    }

    const boundSubtree = attributeExpressions.subtreeProperties.get(property.propertyName);
    if (boundSubtree) {
      subtreeBindings.set(property.identifierName, boundSubtree);
    }
  }

  const childrenIdentifierName = definition.parameterBinding.properties.find(
    (property) => property.propertyName === "children",
  )?.identifierName;
  if (childrenIdentifierName && childrenNodes.length > 0) {
    subtreeBindings.set(childrenIdentifierName, childrenNodes);
  }

  return {
    expressionBindings,
    propsObjectProperties: attributeExpressions.properties,
    propsObjectSubtreeProperties: new Map(attributeExpressions.subtreeProperties),
    subtreeBindings,
  };
}

function collectLocalComponentAttributeExpressions(
  attributes: ts.JsxAttributes,
  context: BuildContext,
  buildRenderNode: (node: ts.Expression | ts.JsxChild, context: BuildContext) => RenderNode,
):
  | {
      properties: Map<string, ts.Expression>;
      subtreeProperties: Map<string, RenderNode[]>;
    }
  | {
      reason: string;
    } {
  const properties = new Map<string, ts.Expression>();
  const subtreeProperties = new Map<string, RenderNode[]>();

  for (const property of attributes.properties) {
    if (ts.isJsxSpreadAttribute(property)) {
      return { reason: LOCAL_COMPONENT_EXPANSION_REASONS.unsupportedProps };
    }

    if (!ts.isIdentifier(property.name)) {
      return { reason: LOCAL_COMPONENT_EXPANSION_REASONS.unsupportedProps };
    }

    if (!property.initializer) {
      return { reason: LOCAL_COMPONENT_EXPANSION_REASONS.unsupportedProps };
    }

    const expression = unwrapJsxAttributeInitializer(property.initializer);
    if (!expression) {
      return { reason: LOCAL_COMPONENT_EXPANSION_REASONS.unsupportedProps };
    }

    properties.set(property.name.text, expression);

    if (isRenderableExpression(expression)) {
      subtreeProperties.set(property.name.text, [buildRenderNode(expression, context)]);
    }
  }

  return { properties, subtreeProperties };
}

function unwrapJsxAttributeInitializer(
  initializer: ts.JsxAttribute["initializer"],
): ts.Expression | undefined {
  if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) {
    return initializer;
  }

  if (ts.isJsxExpression(initializer)) {
    return initializer.expression ?? undefined;
  }

  return undefined;
}
