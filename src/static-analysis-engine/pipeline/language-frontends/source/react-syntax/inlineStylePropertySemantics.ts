import { getCssDeclarationPropertyEffects } from "../../../../libraries/css-parsing/index.js";
import type { CssDeclarationPropertyEffect } from "../../../../types/css.js";
import type { SourceExpressionSyntaxFact } from "../expression-syntax/index.js";

export type ReactInlineStyleDeclarationSemantics = {
  property: string;
  value: string;
  propertyEffects: CssDeclarationPropertyEffect[];
};

export function getReactInlineStyleDeclarationSemantics(input: {
  propertyName: string;
  valueExpression: SourceExpressionSyntaxFact | undefined;
  expressionById: Map<string, SourceExpressionSyntaxFact>;
}): ReactInlineStyleDeclarationSemantics | undefined {
  const property = reactStylePropertyToCssProperty(input.propertyName);
  if (!property) {
    return undefined;
  }

  const value = inlineStyleExpressionToCssValue({
    property,
    expression: input.valueExpression,
    expressionById: input.expressionById,
  });
  if (value === undefined) {
    return undefined;
  }

  return {
    property,
    value,
    propertyEffects: getCssDeclarationPropertyEffects({
      property,
      value,
    }),
  };
}

function inlineStyleExpressionToCssValue(input: {
  property: string;
  expression: SourceExpressionSyntaxFact | undefined;
  expressionById: Map<string, SourceExpressionSyntaxFact>;
}): string | undefined {
  const expression = input.expression;
  if (!expression) {
    return undefined;
  }
  if (expression.expressionKind === "string-literal") {
    return expression.value;
  }
  if (expression.expressionKind === "numeric-literal") {
    return reactNumericInlineStyleValue(input.property, expression.value);
  }
  if (expression.expressionKind === "prefix-unary" && expression.operator !== "~") {
    const operand = unwrapExpressionSyntax(
      input.expressionById.get(expression.operandExpressionId),
      input.expressionById,
    );
    if (!operand || operand.expressionKind !== "numeric-literal") {
      return undefined;
    }
    const signedValue = expression.operator === "-" ? `-${operand.value}` : operand.value;
    return reactNumericInlineStyleValue(input.property, signedValue);
  }
  if (expression.expressionKind === "template-literal" && expression.spans.length === 0) {
    return expression.headText;
  }
  return undefined;
}

function unwrapExpressionSyntax(
  expression: SourceExpressionSyntaxFact | undefined,
  expressionById: Map<string, SourceExpressionSyntaxFact>,
): SourceExpressionSyntaxFact | undefined {
  let current = expression;
  const seen = new Set<string>();
  while (current?.expressionKind === "wrapper" && !seen.has(current.expressionId)) {
    seen.add(current.expressionId);
    current = expressionById.get(current.innerExpressionId);
  }
  return current;
}

const REACT_UNITLESS_CSS_PROPERTIES = new Set([
  "animation-iteration-count",
  "aspect-ratio",
  "border-image-outset",
  "border-image-slice",
  "border-image-width",
  "box-flex",
  "box-flex-group",
  "box-ordinal-group",
  "column-count",
  "columns",
  "flex",
  "flex-grow",
  "flex-negative",
  "flex-order",
  "flex-positive",
  "flex-shrink",
  "font-weight",
  "grid-area",
  "grid-column",
  "grid-column-end",
  "grid-column-start",
  "grid-row",
  "grid-row-end",
  "grid-row-start",
  "line-clamp",
  "-webkit-line-clamp",
  "line-height",
  "opacity",
  "order",
  "orphans",
  "scale",
  "tab-size",
  "widows",
  "z-index",
  "zoom",
  "fill-opacity",
  "flood-opacity",
  "stop-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
]);

function reactNumericInlineStyleValue(property: string, rawValue: string): string {
  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue)) {
    return rawValue;
  }
  if (
    numericValue === 0 ||
    property.startsWith("--") ||
    REACT_UNITLESS_CSS_PROPERTIES.has(property)
  ) {
    return rawValue;
  }
  return `${rawValue}px`;
}

function reactStylePropertyToCssProperty(propertyName: string): string | undefined {
  if (propertyName.startsWith("--")) {
    return propertyName;
  }
  if (!/^[A-Za-z_$][\w$-]*$/.test(propertyName) && !propertyName.includes("-")) {
    return undefined;
  }
  if (propertyName.includes("-")) {
    return propertyName.toLowerCase();
  }

  const prefixed = propertyName
    .replace(/^ms([A-Z])/, "-ms-$1")
    .replace(/^(Webkit|Moz|O)([A-Z])/, "-$1-$2");
  return prefixed.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`).toLowerCase();
}
