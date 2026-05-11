import ts from "typescript";

import {
  toSourceAnchor,
  unwrapExpression,
} from "../../../../libraries/react-components/reactComponentAstUtils.js";
import { collectExpressionSyntaxForNode } from "../expression-syntax/index.js";
import { createSiteKey } from "./keys.js";
import { getJsxTagName, isIntrinsicTagName, unwrapJsxAttributeInitializer } from "./jsxUtils.js";
import type {
  ReactClassExpressionSiteFact,
  ReactComponentPropBindingFact,
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
  componentPropBinding?: ReactComponentPropBindingFact;
}): CreatedReactClassExpressionSite[] {
  if (!ts.isJsxElement(input.node) && !ts.isJsxSelfClosingElement(input.node)) {
    return [];
  }

  const tagName = getJsxTagName(input.node) ?? "";
  const intrinsicTag = isIntrinsicTagName(tagName);
  const attributes = ts.isJsxElement(input.node)
    ? input.node.openingElement.attributes.properties
    : input.node.attributes.properties;
  const classSiteInputs = collectEffectiveJsxClassSiteInputs({
    attributes,
    filePath: input.filePath,
    sourceFile: input.sourceFile,
    intrinsicTag,
    componentPropBinding: input.componentPropBinding,
  });
  if (classSiteInputs.length === 0) {
    return [];
  }

  const emittingComponentKey = input.renderSite?.emittingComponentKey ?? input.emittingComponentKey;
  const placementComponentKey = input.renderSite?.placementComponentKey ?? emittingComponentKey;
  const sites: CreatedReactClassExpressionSite[] = [];

  for (const classSiteInput of classSiteInputs) {
    const attributeName = classSiteInput.attributeName;
    const initializer = classSiteInput.initializer;
    const expression = classSiteInput.expression;
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
        ...(!intrinsicTag || classSiteInput.forwardedComponentPropName
          ? { componentPropName: classSiteInput.forwardedComponentPropName ?? attributeName }
          : {}),
        ...(classSiteInput.valueProjection
          ? { valueProjection: classSiteInput.valueProjection }
          : {}),
        ...(input.renderSite ? { renderSiteKey: input.renderSite.siteKey } : {}),
        ...(input.template ? { elementTemplateKey: input.template.templateKey } : {}),
      },
      expressionSyntax: expressionSyntax.expressions,
    });
  }

  return sites;
}

type JsxClassSiteInput = {
  attributeName: string;
  initializer: ts.Node;
  expression?: ts.Expression;
  forwardedComponentPropName?: string;
  valueProjection?: ReactClassExpressionSiteFact["valueProjection"];
};

function collectEffectiveJsxClassSiteInputs(input: {
  attributes: ts.NodeArray<ts.JsxAttributeLike>;
  filePath: string;
  sourceFile: ts.SourceFile;
  intrinsicTag: boolean;
  componentPropBinding?: ReactComponentPropBindingFact;
}): JsxClassSiteInput[] {
  let effectiveClassNames: JsxClassSiteInput[] = [];
  for (const attribute of input.attributes) {
    if (
      ts.isJsxAttribute(attribute) &&
      ts.isIdentifier(attribute.name) &&
      attribute.initializer &&
      isClassLikeJsxAttributeName({
        attributeName: attribute.name.text,
        intrinsicTag: input.intrinsicTag,
      })
    ) {
      effectiveClassNames = applyClassSiteInputs(effectiveClassNames, [
        {
          attributeName: attribute.name.text,
          initializer: attribute.initializer,
          expression: unwrapJsxAttributeInitializer(attribute.initializer),
        },
      ]);
      continue;
    }

    if (ts.isJsxSpreadAttribute(attribute)) {
      const forwardedClassNames = resolveForwardedComponentPropSpread({
        expression: attribute.expression,
        componentPropBinding: input.componentPropBinding,
      });
      const spreadClassNames =
        forwardedClassNames.length > 0
          ? forwardedClassNames
          : createSpreadClassNameProjection({
              expression: attribute.expression,
            });
      if (spreadClassNames && spreadClassNames.length > 0) {
        effectiveClassNames = applyClassSiteInputs(effectiveClassNames, spreadClassNames);
      }
    }
  }

  return effectiveClassNames;
}

function applyClassSiteInputs(
  existing: JsxClassSiteInput[],
  next: JsxClassSiteInput[],
): JsxClassSiteInput[] {
  const overwrittenAttributeNames = new Set(next.map((entry) => entry.attributeName));
  return [
    ...existing.filter((entry) => !overwrittenAttributeNames.has(entry.attributeName)),
    ...next,
  ];
}

function resolveForwardedComponentPropSpread(input: {
  expression: ts.Expression;
  componentPropBinding?: ReactComponentPropBindingFact;
}): JsxClassSiteInput[] {
  const binding = input.componentPropBinding;
  const unwrapped = unwrapExpression(input.expression);
  if (!binding || !ts.isIdentifier(unwrapped)) {
    return [];
  }

  if (binding.bindingKind === "props-identifier" && binding.identifierName === unwrapped.text) {
    return [
      {
        attributeName: "className",
        initializer: unwrapped,
        expression: unwrapped,
        forwardedComponentPropName: "className",
      },
    ];
  }

  const destructuresClassName = binding.properties.some(
    (property) => property.propertyName === "className",
  );
  if (
    binding.bindingKind === "destructured-props" &&
    binding.restPropertyName === unwrapped.text &&
    !destructuresClassName
  ) {
    return [
      {
        attributeName: "className",
        initializer: unwrapped,
        expression: unwrapped,
        forwardedComponentPropName: "className",
      },
    ];
  }

  return [];
}

function createSpreadClassNameProjection(input: {
  expression: ts.Expression;
}): JsxClassSiteInput[] | undefined {
  return [
    {
      attributeName: "className",
      initializer: input.expression,
      expression: input.expression,
      valueProjection: {
        kind: "object-property",
        propertyNames: ["className"],
        unresolvedObjectEntriesAffectPresence: true,
      },
    },
  ];
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
      ts.isPropertyAssignment(property) &&
      getStaticPropertyName(property.name, input.sourceFile)?.key === "className",
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

export function tryCreateCreateElementClassExpressionSite(input: {
  node: ts.Node;
  filePath: string;
  sourceFile: ts.SourceFile;
  emittingComponentKey?: string;
}): CreatedReactClassExpressionSite | undefined {
  if (!ts.isCallExpression(input.node) || !isCreateElementCall(input.node)) {
    return undefined;
  }

  const propsArgument = input.node.arguments[1];
  if (!propsArgument || !ts.isObjectLiteralExpression(unwrapExpression(propsArgument))) {
    return undefined;
  }

  const objectLiteral = unwrapExpression(propsArgument);
  if (!ts.isObjectLiteralExpression(objectLiteral)) {
    return undefined;
  }

  const classNameProperty = objectLiteral.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      getStaticPropertyName(property.name, input.sourceFile)?.key === "className",
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
      siteKey: createSiteKey("class-expression", location, "create-element-class"),
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

function isCreateElementCall(expression: ts.CallExpression): boolean {
  const callee = expression.expression;
  if (ts.isIdentifier(callee)) {
    return callee.text === "createElement";
  }

  return ts.isPropertyAccessExpression(callee) && callee.name.text === "createElement";
}

function getStaticPropertyName(
  name: ts.PropertyName,
  sourceFile: ts.SourceFile,
): { key: string } | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return { key: name.text };
  }

  if (
    ts.isComputedPropertyName(name) &&
    (ts.isStringLiteral(name.expression) || ts.isNoSubstitutionTemplateLiteral(name.expression))
  ) {
    return { key: name.expression.text };
  }

  if (ts.isComputedPropertyName(name)) {
    const unwrapped = unwrapExpression(name.expression);
    if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
      return { key: unwrapped.text };
    }
    const text = unwrapped.getText(sourceFile);
    return text === '"className"' || text === "'className'" || text === "`className`"
      ? { key: "className" }
      : undefined;
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

  return (
    input.attributeName === "className" ||
    input.attributeName.endsWith("ClassName") ||
    input.attributeName.endsWith("Class")
  );
}
