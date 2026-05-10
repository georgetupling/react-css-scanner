import ts from "typescript";

import { toSourceAnchor } from "../../../../libraries/react-components/reactComponentAstUtils.js";
import {
  collectExpressionSyntaxForNode,
  type SourceExpressionSyntaxFact,
} from "../expression-syntax/index.js";
import { createSiteKey } from "./keys.js";
import { getJsxTagName, isIntrinsicTagName, unwrapJsxAttributeInitializer } from "./jsxUtils.js";
import type {
  ReactElementTemplateFact,
  ReactInlineStyleSiteFact,
  ReactRenderSiteFact,
  ReactComponentPropBindingFact,
} from "./types.js";

export function createJsxInlineStyleSite(input: {
  node: ts.Node;
  filePath: string;
  sourceFile: ts.SourceFile;
  renderSite?: ReactRenderSiteFact;
  template?: ReactElementTemplateFact;
  emittingComponentKey?: string;
  componentPropBinding?: ReactComponentPropBindingFact;
}): { site: ReactInlineStyleSiteFact; expressionSyntax: SourceExpressionSyntaxFact[] } | undefined {
  const tagName = getJsxTagName(input.node);
  if (!tagName) {
    return undefined;
  }
  const intrinsicTag = isIntrinsicTagName(tagName);

  const styleAttribute = findStyleAttribute(input.node);
  if (!styleAttribute) {
    return undefined;
  }

  const expression = unwrapJsxAttributeInitializer(styleAttribute.initializer);
  if (!expression) {
    return undefined;
  }

  const expressionSyntax = collectExpressionSyntaxForNode({
    node: expression,
    filePath: input.filePath,
    sourceFile: input.sourceFile,
  });
  const location = toSourceAnchor(styleAttribute, input.sourceFile, input.filePath);
  const sourceComponentPropName = resolveReferencedComponentPropName({
    expression,
    componentPropBinding: input.componentPropBinding,
  });
  return {
    site: {
      siteKey: createSiteKey(
        "inline-style",
        location,
        input.renderSite?.siteKey ?? `${input.filePath}:standalone-inline-style`,
      ),
      kind: intrinsicTag ? "jsx-style" : "component-prop-style",
      filePath: input.filePath,
      location,
      expressionId: expressionSyntax.rootExpressionId,
      rawExpressionText: expression.getText(input.sourceFile),
      ...(input.emittingComponentKey ? { emittingComponentKey: input.emittingComponentKey } : {}),
      ...(input.template?.placementComponentKey
        ? { placementComponentKey: input.template.placementComponentKey }
        : {}),
      ...(!intrinsicTag ? { componentPropName: "style" } : {}),
      ...(intrinsicTag && sourceComponentPropName
        ? { componentPropName: sourceComponentPropName }
        : {}),
      ...(sourceComponentPropName ? { sourceComponentPropName } : {}),
      ...(input.renderSite ? { renderSiteKey: input.renderSite.siteKey } : {}),
      ...(input.template ? { elementTemplateKey: input.template.templateKey } : {}),
    },
    expressionSyntax: expressionSyntax.expressions,
  };
}

function findStyleAttribute(node: ts.Node): ts.JsxAttribute | undefined {
  const attributes = ts.isJsxElement(node)
    ? node.openingElement.attributes.properties
    : ts.isJsxSelfClosingElement(node)
      ? node.attributes.properties
      : [];

  for (let index = attributes.length - 1; index >= 0; index -= 1) {
    const attribute = attributes[index];
    if (
      ts.isJsxAttribute(attribute) &&
      ts.isIdentifier(attribute.name) &&
      attribute.name.text === "style"
    ) {
      return attribute;
    }
  }

  return undefined;
}

function resolveReferencedComponentPropName(input: {
  expression: ts.Expression;
  componentPropBinding?: ReactComponentPropBindingFact;
}): string | undefined {
  const binding = input.componentPropBinding;
  if (!binding) {
    return undefined;
  }

  const expression = unwrapExpression(input.expression);
  if (
    binding.bindingKind === "props-identifier" &&
    binding.identifierName &&
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === binding.identifierName
  ) {
    return expression.name.text;
  }

  if (binding.bindingKind === "destructured-props" && ts.isIdentifier(expression)) {
    const property = binding.properties.find(
      (candidate) => candidate.localName === expression.text,
    );
    return property?.propertyName;
  }

  return undefined;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}
