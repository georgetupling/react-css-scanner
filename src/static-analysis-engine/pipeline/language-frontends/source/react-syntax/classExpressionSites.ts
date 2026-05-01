import ts from "typescript";

import { toSourceAnchor } from "../../../../libraries/react-components/reactComponentAstUtils.js";
import { collectExpressionSyntaxForNode } from "../expression-syntax/index.js";
import { createSiteKey } from "./keys.js";
import { getJsxTagName, isIntrinsicTagName, unwrapJsxAttributeInitializer } from "./jsxUtils.js";
import type {
  ReactClassExpressionSiteFact,
  ReactElementTemplateFact,
  ReactRenderSiteFact,
} from "./types.js";
import type { SourceExpressionSyntaxFact } from "../expression-syntax/index.js";

export type CreatedReactClassExpressionSite = {
  site: ReactClassExpressionSiteFact;
  expressionSyntax: SourceExpressionSyntaxFact[];
};

export function tryCreateJsxClassExpressionSite(input: {
  node: ts.Node;
  filePath: string;
  sourceFile: ts.SourceFile;
  renderSite?: ReactRenderSiteFact;
  template?: ReactElementTemplateFact;
  emittingComponentKey?: string;
}): CreatedReactClassExpressionSite | undefined {
  if (!ts.isJsxElement(input.node) && !ts.isJsxSelfClosingElement(input.node)) {
    return undefined;
  }

  const attributes = ts.isJsxElement(input.node)
    ? input.node.openingElement.attributes.properties
    : input.node.attributes.properties;
  const classNameAttribute = attributes.find(
    (attribute): attribute is ts.JsxAttribute =>
      ts.isJsxAttribute(attribute) &&
      ts.isIdentifier(attribute.name) &&
      attribute.name.text === "className",
  );
  if (!classNameAttribute?.initializer) {
    return undefined;
  }

  const tagName = getJsxTagName(input.node) ?? "";
  const expression = unwrapJsxAttributeInitializer(classNameAttribute.initializer);
  const anchorNode = expression ?? classNameAttribute.initializer;
  const location = toSourceAnchor(anchorNode, input.sourceFile, input.filePath);
  const emittingComponentKey = input.renderSite?.emittingComponentKey ?? input.emittingComponentKey;
  const placementComponentKey = input.renderSite?.placementComponentKey ?? emittingComponentKey;
  const expressionSyntax = collectExpressionSyntaxForNode({
    node: anchorNode,
    filePath: input.filePath,
    sourceFile: input.sourceFile,
  });

  return {
    site: {
      siteKey: createSiteKey(
        "class-expression",
        location,
        input.renderSite?.siteKey ?? "standalone-jsx-class",
      ),
      kind: isIntrinsicTagName(tagName) ? "jsx-class" : "component-prop-class",
      filePath: input.filePath,
      location,
      expressionId: expressionSyntax.rootExpressionId,
      rawExpressionText: anchorNode.getText(input.sourceFile),
      ...(emittingComponentKey ? { emittingComponentKey } : {}),
      ...(placementComponentKey ? { placementComponentKey } : {}),
      ...(input.renderSite ? { renderSiteKey: input.renderSite.siteKey } : {}),
      ...(input.template ? { elementTemplateKey: input.template.templateKey } : {}),
    },
    expressionSyntax: expressionSyntax.expressions,
  };
}

export function tryCreateCssModuleClassExpressionSite(input: {
  node: ts.Node;
  filePath: string;
  sourceFile: ts.SourceFile;
  cssModuleNamespaceNames: ReadonlySet<string>;
  emittingComponentKey?: string;
}): CreatedReactClassExpressionSite | undefined {
  if (
    !ts.isPropertyAccessExpression(input.node) ||
    !ts.isIdentifier(input.node.expression) ||
    !input.cssModuleNamespaceNames.has(input.node.expression.text)
  ) {
    return undefined;
  }

  const location = toSourceAnchor(input.node, input.sourceFile, input.filePath);
  const expressionSyntax = collectExpressionSyntaxForNode({
    node: input.node,
    filePath: input.filePath,
    sourceFile: input.sourceFile,
  });

  return {
    site: {
      siteKey: createSiteKey("class-expression", location, "css-module-member"),
      kind: "css-module-member",
      filePath: input.filePath,
      location,
      expressionId: expressionSyntax.rootExpressionId,
      rawExpressionText: input.node.getText(input.sourceFile),
      ...(input.emittingComponentKey
        ? {
            emittingComponentKey: input.emittingComponentKey,
            placementComponentKey: input.emittingComponentKey,
          }
        : {}),
    },
    expressionSyntax: expressionSyntax.expressions,
  };
}

export function tryCreateCloneElementClassExpressionSite(input: {
  node: ts.Node;
  filePath: string;
  sourceFile: ts.SourceFile;
  emittingComponentKey?: string;
}): CreatedReactClassExpressionSite | undefined {
  if (!ts.isCallExpression(input.node) || !isCloneElementCall(input.node)) {
    return undefined;
  }

  const propsArgument = input.node.arguments[1];
  if (!propsArgument || !ts.isObjectLiteralExpression(propsArgument)) {
    return undefined;
  }

  const classNameProperty = propsArgument.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && getStaticPropertyName(property.name) === "className",
  );
  if (!classNameProperty) {
    return undefined;
  }

  const expression = classNameProperty.initializer;
  const location = toSourceAnchor(expression, input.sourceFile, input.filePath);
  const expressionSyntax = collectExpressionSyntaxForNode({
    node: expression,
    filePath: input.filePath,
    sourceFile: input.sourceFile,
  });

  return {
    site: {
      siteKey: createSiteKey("class-expression", location, "clone-element-class"),
      kind: "jsx-class",
      filePath: input.filePath,
      location,
      expressionId: expressionSyntax.rootExpressionId,
      rawExpressionText: expression.getText(input.sourceFile),
      ...(input.emittingComponentKey
        ? {
            emittingComponentKey: input.emittingComponentKey,
            placementComponentKey: input.emittingComponentKey,
          }
        : {}),
    },
    expressionSyntax: expressionSyntax.expressions,
  };
}

export function dedupeClassExpressionSites(
  sites: ReactClassExpressionSiteFact[],
): ReactClassExpressionSiteFact[] {
  const byKey = new Map<string, ReactClassExpressionSiteFact>();
  for (const site of sites) {
    byKey.set(site.siteKey, site);
  }
  return [...byKey.values()];
}

function isCloneElementCall(expression: ts.CallExpression): boolean {
  const callee = expression.expression;
  if (ts.isIdentifier(callee)) {
    return callee.text === "cloneElement";
  }

  return ts.isPropertyAccessExpression(callee) && callee.name.text === "cloneElement";
}

function getStaticPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return undefined;
}
