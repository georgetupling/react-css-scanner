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

export type CreatedReactInlineStyleSite = {
  site: ReactInlineStyleSiteFact;
  expressionSyntax: SourceExpressionSyntaxFact[];
};

export function createJsxInlineStyleSites(input: {
  node: ts.Node;
  filePath: string;
  sourceFile: ts.SourceFile;
  renderSite?: ReactRenderSiteFact;
  template?: ReactElementTemplateFact;
  emittingComponentKey?: string;
  componentPropBinding?: ReactComponentPropBindingFact;
}): CreatedReactInlineStyleSite[] {
  if (!ts.isJsxElement(input.node) && !ts.isJsxSelfClosingElement(input.node)) {
    return [];
  }

  const tagName = getJsxTagName(input.node);
  if (!tagName) {
    return [];
  }
  const intrinsicTag = isIntrinsicTagName(tagName);
  const attributes = ts.isJsxElement(input.node)
    ? input.node.openingElement.attributes.properties
    : input.node.attributes.properties;
  const styleSiteInputs = collectEffectiveJsxStyleSiteInputs({
    attributes,
    sourceFile: input.sourceFile,
    intrinsicTag,
    componentPropBinding: input.componentPropBinding,
  });
  if (styleSiteInputs.length === 0) {
    return [];
  }

  const emittingComponentKey = input.renderSite?.emittingComponentKey ?? input.emittingComponentKey;
  const placementComponentKey = input.renderSite?.placementComponentKey ?? emittingComponentKey;

  return styleSiteInputs.map((styleSiteInput) => {
    const expression = styleSiteInput.expression;
    const location = toSourceAnchor(styleSiteInput.initializer, input.sourceFile, input.filePath);
    const expressionSyntax = collectExpressionSyntaxForNode({
      node: expression,
      filePath: input.filePath,
      sourceFile: input.sourceFile,
    });
    const sourceComponentPropName =
      styleSiteInput.forwardedComponentPropName ??
      resolveReferencedComponentPropName({
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
        ...(emittingComponentKey ? { emittingComponentKey } : {}),
        ...(placementComponentKey ? { placementComponentKey } : {}),
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
  });
}

type JsxStyleSiteInput = {
  initializer: ts.Node;
  expression: ts.Expression;
  forwardedComponentPropName?: string;
};

function collectEffectiveJsxStyleSiteInputs(input: {
  attributes: ts.NodeArray<ts.JsxAttributeLike>;
  sourceFile: ts.SourceFile;
  intrinsicTag: boolean;
  componentPropBinding?: ReactComponentPropBindingFact;
}): JsxStyleSiteInput[] {
  let effectiveStyles: JsxStyleSiteInput[] = [];
  for (const attribute of input.attributes) {
    if (
      ts.isJsxAttribute(attribute) &&
      ts.isIdentifier(attribute.name) &&
      attribute.name.text === "style" &&
      attribute.initializer
    ) {
      const expression = unwrapJsxAttributeInitializer(attribute.initializer);
      if (expression) {
        effectiveStyles = applyStyleSiteInputs(effectiveStyles, [
          {
            initializer: attribute,
            expression,
          },
        ]);
      }
      continue;
    }

    if (!ts.isJsxSpreadAttribute(attribute)) {
      continue;
    }

    const spreadStyles =
      resolveSpreadStyles({
        expression: attribute.expression,
        sourceFile: input.sourceFile,
      }) ??
      resolveForwardedComponentPropSpread({
        expression: attribute.expression,
        componentPropBinding: input.componentPropBinding,
      });
    if (spreadStyles.length > 0) {
      effectiveStyles = applyStyleSiteInputs(effectiveStyles, spreadStyles);
    }
  }

  return effectiveStyles;
}

function applyStyleSiteInputs(
  existing: JsxStyleSiteInput[],
  next: JsxStyleSiteInput[],
): JsxStyleSiteInput[] {
  return next.length > 0 ? next : existing;
}

function resolveForwardedComponentPropSpread(input: {
  expression: ts.Expression;
  componentPropBinding?: ReactComponentPropBindingFact;
}): JsxStyleSiteInput[] {
  const binding = input.componentPropBinding;
  const unwrapped = unwrapExpression(input.expression);
  if (!binding || !ts.isIdentifier(unwrapped)) {
    return [];
  }

  if (binding.bindingKind === "props-identifier" && binding.identifierName === unwrapped.text) {
    return [
      {
        initializer: unwrapped,
        expression: unwrapped,
        forwardedComponentPropName: "style",
      },
    ];
  }

  const destructuresStyle = binding.properties.some(
    (property) => property.propertyName === "style",
  );
  if (
    binding.bindingKind === "destructured-props" &&
    binding.restPropertyName === unwrapped.text &&
    !destructuresStyle
  ) {
    return [
      {
        initializer: unwrapped,
        expression: unwrapped,
        forwardedComponentPropName: "style",
      },
    ];
  }

  return [];
}

function resolveSpreadStyles(input: {
  expression: ts.Expression;
  sourceFile: ts.SourceFile;
}): JsxStyleSiteInput[] | undefined {
  const objectLiterals = resolveObjectLiteralExpressions({
    expression: input.expression,
    sourceFile: input.sourceFile,
  });
  if (!objectLiterals) {
    return undefined;
  }

  const styles: JsxStyleSiteInput[] = [];
  for (const objectLiteral of objectLiterals) {
    const styleProperties = objectLiteral.properties.filter(
      (property): property is ts.PropertyAssignment =>
        ts.isPropertyAssignment(property) && getStaticPropertyName(property.name) === "style",
    );
    if (styleProperties.length === 0) {
      return undefined;
    }

    for (const styleProperty of styleProperties) {
      styles.push({
        initializer: styleProperty.initializer,
        expression: styleProperty.initializer,
      });
    }
  }

  return styles;
}

function resolveObjectLiteralExpressions(input: {
  expression: ts.Expression;
  sourceFile: ts.SourceFile;
}): ts.ObjectLiteralExpression[] | undefined {
  const unwrapped = unwrapExpression(input.expression);
  if (ts.isConditionalExpression(unwrapped)) {
    const whenTrue = resolveObjectLiteralExpressions({
      expression: unwrapped.whenTrue,
      sourceFile: input.sourceFile,
    });
    const whenFalse = resolveObjectLiteralExpressions({
      expression: unwrapped.whenFalse,
      sourceFile: input.sourceFile,
    });
    if (!whenTrue || !whenFalse) {
      return undefined;
    }
    return [...whenTrue, ...whenFalse];
  }

  const objectLiteral = resolveObjectLiteralExpression({
    expression: unwrapped,
    sourceFile: input.sourceFile,
  });
  return objectLiteral ? [objectLiteral] : undefined;
}

function resolveObjectLiteralExpression(input: {
  expression: ts.Expression;
  sourceFile: ts.SourceFile;
}): ts.ObjectLiteralExpression | undefined {
  const unwrapped = unwrapExpression(input.expression);
  if (ts.isObjectLiteralExpression(unwrapped)) {
    return unwrapped;
  }

  if (!ts.isIdentifier(unwrapped)) {
    return undefined;
  }

  const declaration = findVisibleConstObjectLiteralDeclaration({
    sourceFile: input.sourceFile,
    localName: unwrapped.text,
    usage: unwrapped,
  });
  return declaration?.initializer
    ? unwrapObjectLiteralInitializer(declaration.initializer)
    : undefined;
}

function findVisibleConstObjectLiteralDeclaration(input: {
  sourceFile: ts.SourceFile;
  localName: string;
  usage: ts.Identifier;
}): ts.VariableDeclaration | undefined {
  let current: ts.Node | undefined = input.usage;
  while (current) {
    if (ts.isBlock(current) || ts.isSourceFile(current) || ts.isModuleBlock(current)) {
      const declaration = findConstObjectLiteralDeclarationInStatements({
        statements: current.statements,
        localName: input.localName,
        usage: input.usage,
      });
      if (declaration) {
        return declaration;
      }
    }
    current = current.parent;
  }

  return undefined;
}

function findConstObjectLiteralDeclarationInStatements(input: {
  statements: ts.NodeArray<ts.Statement>;
  localName: string;
  usage: ts.Identifier;
}): ts.VariableDeclaration | undefined {
  for (const statement of input.statements) {
    if (statement.pos > input.usage.pos) {
      break;
    }
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) === ts.NodeFlags.Const;
    if (!isConst) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        declaration.pos <= input.usage.pos &&
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === input.localName &&
        declaration.initializer
      ) {
        return declaration;
      }
    }
  }

  return undefined;
}

function unwrapObjectLiteralInitializer(
  expression: ts.Expression,
): ts.ObjectLiteralExpression | undefined {
  const unwrapped = unwrapExpression(expression);
  return ts.isObjectLiteralExpression(unwrapped) ? unwrapped : undefined;
}

function getStaticPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
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
