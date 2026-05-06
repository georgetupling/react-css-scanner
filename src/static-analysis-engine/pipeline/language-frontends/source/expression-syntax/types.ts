import type { SourceAnchor } from "../../../../types/core.js";

export type SourceExpressionSyntaxFact = SourceExpressionSyntaxBase &
  (
    | SourceStringLiteralExpressionSyntax
    | SourceNumericLiteralExpressionSyntax
    | SourceBooleanLiteralExpressionSyntax
    | SourceNullishLiteralExpressionSyntax
    | SourceIdentifierExpressionSyntax
    | SourceTemplateExpressionSyntax
    | SourceMemberAccessExpressionSyntax
    | SourceElementAccessExpressionSyntax
    | SourceCallExpressionSyntax
    | SourceArrayLiteralExpressionSyntax
    | SourceObjectLiteralExpressionSyntax
    | SourceConditionalExpressionSyntax
    | SourceBinaryExpressionSyntax
    | SourcePrefixUnaryExpressionSyntax
    | SourceWrapperExpressionSyntax
    | SourceUnsupportedExpressionSyntax
  );

export type SourceExpressionSyntaxBase = {
  expressionId: string;
  filePath: string;
  location: SourceAnchor;
  rawText: string;
};

export type SourceStringLiteralExpressionSyntax = {
  expressionKind: "string-literal";
  literalKind: "string" | "no-substitution-template";
  value: string;
};

export type SourceNumericLiteralExpressionSyntax = {
  expressionKind: "numeric-literal";
  value: string;
};

export type SourceBooleanLiteralExpressionSyntax = {
  expressionKind: "boolean-literal";
  value: boolean;
};

export type SourceNullishLiteralExpressionSyntax = {
  expressionKind: "nullish-literal";
  value: "null" | "undefined";
};

export type SourceIdentifierExpressionSyntax = {
  expressionKind: "identifier";
  name: string;
  possibleStringValues?: string[];
};

export type SourceTemplateExpressionSyntax = {
  expressionKind: "template-literal";
  headText: string;
  spans: SourceTemplateExpressionSpan[];
};

export type SourceTemplateExpressionSpan = {
  expressionId: string;
  literalText: string;
  location: SourceAnchor;
};

export type SourceMemberAccessExpressionSyntax = {
  expressionKind: "member-access";
  objectExpressionId: string;
  propertyName: string;
  optional: boolean;
};

export type SourceElementAccessExpressionSyntax = {
  expressionKind: "element-access";
  objectExpressionId: string;
  argumentExpressionId?: string;
  optional: boolean;
};

export type SourceCallExpressionSyntax = {
  expressionKind: "call";
  calleeExpressionId: string;
  argumentExpressionIds: string[];
  hasSpreadArgument: boolean;
  optional: boolean;
};

export type SourceArrayLiteralExpressionSyntax = {
  expressionKind: "array-literal";
  elementExpressionIds: string[];
  hasSpreadElement: boolean;
  hasOmittedElement: boolean;
};

export type SourceObjectLiteralExpressionSyntax = {
  expressionKind: "object-literal";
  properties: SourceObjectExpressionProperty[];
  hasSpreadProperty: boolean;
  hasUnsupportedProperty: boolean;
};

export type SourceObjectExpressionProperty = {
  propertyKind: "property" | "shorthand" | "spread" | "method" | "accessor" | "unsupported";
  location: SourceAnchor;
  keyKind?: "identifier" | "string" | "numeric" | "computed" | "unknown";
  keyText?: string;
  keyExpressionId?: string;
  valueExpressionId?: string;
  spreadExpressionId?: string;
};

export type SourceConditionalExpressionSyntax = {
  expressionKind: "conditional";
  conditionExpressionId: string;
  whenTrueExpressionId: string;
  whenFalseExpressionId: string;
};

export type SourceBinaryExpressionSyntax = {
  expressionKind: "binary";
  operator: "+" | "&&" | "||" | "??";
  leftExpressionId: string;
  rightExpressionId: string;
};

export type SourcePrefixUnaryExpressionSyntax = {
  expressionKind: "prefix-unary";
  operator: "!" | "+" | "-" | "~";
  operandExpressionId: string;
};

export type SourceWrapperExpressionSyntax = {
  expressionKind: "wrapper";
  wrapperKind: "parenthesized" | "as" | "satisfies" | "type-assertion" | "non-null";
  innerExpressionId: string;
};

export type SourceUnsupportedExpressionSyntax = {
  expressionKind: "unsupported";
  syntaxKind: string;
};
