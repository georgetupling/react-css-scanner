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

export function createJsxClassExpressionSites(input: {
  node: ts.Node;
  filePath: string;
  sourceFile: ts.SourceFile;
  renderSite?: ReactRenderSiteFact;
  template?: ReactElementTemplateFact;
  emittingComponentKey?: string;
}): CreatedReactClassExpressionSite[] {
  if (!ts.isJsxElement(input.node) && !ts.isJsxSelfClosingElement(input.node)) {
    return [];
  }

  const tagName = getJsxTagName(input.node) ?? "";
  const intrinsicTag = isIntrinsicTagName(tagName);
  const attributes = ts.isJsxElement(input.node)
    ? input.node.openingElement.attributes.properties
    : input.node.attributes.properties;
  const classAttributes = attributes.filter(
    (attribute): attribute is ts.JsxAttribute =>
      ts.isJsxAttribute(attribute) &&
      ts.isIdentifier(attribute.name) &&
      Boolean(attribute.initializer) &&
      isClassLikeJsxAttributeName({
        attributeName: attribute.name.text,
        intrinsicTag,
      }),
  );
  if (classAttributes.length === 0) {
    return [];
  }

  const emittingComponentKey = input.renderSite?.emittingComponentKey ?? input.emittingComponentKey;
  const placementComponentKey = input.renderSite?.placementComponentKey ?? emittingComponentKey;
  const sites: CreatedReactClassExpressionSite[] = [];

  for (const classAttribute of classAttributes) {
    if (!ts.isIdentifier(classAttribute.name)) {
      continue;
    }
    const attributeName = classAttribute.name.text;
    const initializer = classAttribute.initializer;
    if (!initializer) {
      continue;
    }
    const expression = unwrapJsxAttributeInitializer(initializer);
    const anchorNode =
      !intrinsicTag && expression
        ? (unwrapFunctionReturnedExpression(expression) ?? expression)
        : (expression ?? initializer);
    const location = toSourceAnchor(anchorNode, input.sourceFile, input.filePath);
    const expressionSyntax = collectExpressionSyntaxForNode({
      node: anchorNode,
      filePath: input.filePath,
      sourceFile: input.sourceFile,
    });

    sites.push({
      site: {
        siteKey: createSiteKey(
          "class-expression",
          location,
          `${input.renderSite?.siteKey ?? "standalone-jsx-class"}:${attributeName}`,
        ),
        kind: intrinsicTag ? "jsx-class" : "component-prop-class",
        filePath: input.filePath,
        location,
        expressionId: expressionSyntax.rootExpressionId,
        rawExpressionText: anchorNode.getText(input.sourceFile),
        ...(emittingComponentKey ? { emittingComponentKey } : {}),
        ...(placementComponentKey ? { placementComponentKey } : {}),
        ...(!intrinsicTag ? { componentPropName: attributeName } : {}),
        ...(input.renderSite ? { renderSiteKey: input.renderSite.siteKey } : {}),
        ...(input.template ? { elementTemplateKey: input.template.templateKey } : {}),
      },
      expressionSyntax: expressionSyntax.expressions,
    });
  }

  return sites;
}

function unwrapFunctionReturnedExpression(expression: ts.Expression): ts.Expression | undefined {
  if (!ts.isArrowFunction(expression) && !ts.isFunctionExpression(expression)) {
    return undefined;
  }

  if (!ts.isBlock(expression.body)) {
    return expression.body;
  }

  for (const statement of expression.body.statements) {
    if (ts.isReturnStatement(statement) && statement.expression) {
      return statement.expression;
    }
  }

  return undefined;
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

function isClassLikeJsxAttributeName(input: {
  attributeName: string;
  intrinsicTag: boolean;
}): boolean {
  if (input.intrinsicTag) {
    return input.attributeName === "className";
  }

  return input.attributeName === "className" || input.attributeName.endsWith("ClassName");
}
