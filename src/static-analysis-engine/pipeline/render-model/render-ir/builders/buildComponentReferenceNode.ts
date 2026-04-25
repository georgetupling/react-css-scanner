import ts from "typescript";

import type { SameFileComponentDefinition } from "../collection/shared/types.js";
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
  const definition =
    resolveComponentDefinition(tagNameNode, context) ??
    context.componentsByFilePath.get(context.currentComponentFilePath)?.get(componentName);
  if (!definition) {
    const sourceAnchor = toSourceAnchor(tagNameNode, context.parsedSourceFile, context.filePath);
    return {
      kind: "component-reference",
      sourceAnchor,
      componentName,
      reason: COMPONENT_DEFINITION_NOT_FOUND_REASON,
      traces: [
        createRenderExpansionTrace({
          traceId: "render-expansion:component-reference:not-found",
          summary: `could not resolve component reference "${componentName}" for render expansion`,
          anchor: sourceAnchor,
          metadata: {
            componentName,
            reason: COMPONENT_DEFINITION_NOT_FOUND_REASON,
          },
        }),
      ],
    };
  }

  const expansionScope = getExpansionScope(context.currentComponentFilePath, definition.filePath);

  if (context.expansionStack.includes(componentName)) {
    const sourceAnchor = toSourceAnchor(tagNameNode, context.parsedSourceFile, context.filePath);
    const reason = buildComponentExpansionReason(expansionScope, "cycle");
    return {
      kind: "component-reference",
      sourceAnchor,
      componentName,
      reason,
      traces: [
        createRenderExpansionTrace({
          traceId: "render-expansion:component-reference:cycle",
          summary: `stopped expanding component reference "${componentName}" because expansion would cycle`,
          anchor: sourceAnchor,
          metadata: {
            componentName,
            reason,
          },
        }),
      ],
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
      traces: [
        createRenderExpansionTrace({
          traceId: "render-expansion:component-reference:budget-exceeded",
          summary: `stopped expanding component reference "${componentName}" because the render expansion budget was exceeded`,
          anchor: sourceAnchor,
          metadata: {
            componentName,
            reason,
          },
        }),
      ],
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
      traces: [
        createRenderExpansionTrace({
          traceId: "render-expansion:component-reference:unsupported",
          summary: `stopped expanding component reference "${componentName}" because prop or children binding is unsupported in the current bounded slice`,
          anchor: sourceAnchor,
          metadata: {
            componentName,
            reason: expansionBinding.reason,
          },
        }),
      ],
    };
  }

  const sourceAnchor = toSourceAnchor(tagNameNode, context.parsedSourceFile, context.filePath);
  const expansionTrace = createRenderExpansionTrace({
    traceId: `render-expansion:component-reference:expanded:${context.filePath}:${componentName}:${sourceAnchor.startLine}:${sourceAnchor.startColumn}`,
    summary: `expanded component reference "${componentName}" into render IR`,
    anchor: sourceAnchor,
    metadata: {
      componentName,
      targetComponentName: definition.componentName,
      targetFilePath: definition.filePath,
    },
  });

  return applyPlacementAnchor(
    applyComponentReferenceExpansion(
      buildRenderNode(definition.rootExpression, {
        ...context,
        filePath: definition.filePath,
        parsedSourceFile: definition.parsedSourceFile,
        currentComponentFilePath: definition.filePath,
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
      }),
      {
        componentName: definition.componentName,
        filePath: definition.filePath,
        targetSourceAnchor: definition.sourceAnchor,
        sourceAnchor,
        traces: [expansionTrace],
      },
    ),
    sourceAnchor,
  );
}

function resolveComponentDefinition(
  tagNameNode: ts.JsxTagNameExpression,
  context: BuildContext,
): SameFileComponentDefinition | undefined {
  if (ts.isPropertyAccessExpression(tagNameNode) && ts.isIdentifier(tagNameNode.expression)) {
    return context.namespaceComponentDefinitions
      .get(tagNameNode.expression.text)
      ?.get(tagNameNode.name.text);
  }

  return undefined;
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
  expansionScope: import("../shared/expansionSemantics.js").ExpansionScope,
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
      return {
        reason: buildComponentExpansionReason(expansionScope, "unsupportedProps"),
      };
    }

    if (!ts.isIdentifier(property.name)) {
      return {
        reason: buildComponentExpansionReason(expansionScope, "unsupportedProps"),
      };
    }

    if (!property.initializer) {
      return {
        reason: buildComponentExpansionReason(expansionScope, "unsupportedProps"),
      };
    }

    const expression = unwrapJsxAttributeInitializer(property.initializer);
    if (!expression) {
      return {
        reason: buildComponentExpansionReason(expansionScope, "unsupportedProps"),
      };
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
