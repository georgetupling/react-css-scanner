import ts from "typescript";
import type { AnalysisTrace } from "../../../types/analysis.js";
import type { SourceAnchor } from "../../../types/core.js";
import {
  collectStringCandidates,
  combineStrings,
  getStringCandidates,
  mergeClassSets,
  toClassSet,
  toStringValue,
  tokenizeClassNames,
  uniqueSorted,
} from "./classValueOperations.js";
import type { AbstractValue } from "./types.js";

const MAX_STRING_COMBINATIONS = 32;

export function summarizeClassNameExpression(expression: ts.Expression): AbstractValue {
  expression = unwrapExpression(expression);

  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return {
      kind: "string-exact",
      value: expression.text,
    };
  }

  if (ts.isTemplateExpression(expression)) {
    return summarizeTemplateExpression(expression);
  }

  if (ts.isBinaryExpression(expression)) {
    if (expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return combineStringLikeValues(
        summarizeClassNameExpression(expression.left),
        summarizeClassNameExpression(expression.right),
      );
    }

    if (
      expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
    ) {
      return summarizeLogicalExpression(expression);
    }
  }

  if (ts.isConditionalExpression(expression)) {
    const whenTrue = summarizeClassNameExpression(expression.whenTrue);
    const whenFalse = summarizeClassNameExpression(expression.whenFalse);
    const stringCandidates = collectStringCandidates(whenTrue, whenFalse);

    if (stringCandidates) {
      return {
        kind: "string-set",
        values: stringCandidates,
      };
    }

    return mergeClassSets([whenTrue, whenFalse], "conditional expression");
  }

  if (ts.isCallExpression(expression)) {
    return summarizeClassNameCall(expression);
  }

  if (ts.isArrayLiteralExpression(expression)) {
    return summarizeClassArray(expression.elements);
  }

  if (ts.isObjectLiteralExpression(expression)) {
    return summarizeClassObject(expression);
  }

  return {
    kind: "unknown",
    reason: `unsupported-expression:${ts.SyntaxKind[expression.kind]}`,
  };
}

export function buildClassExpressionTraces(input: {
  sourceAnchor: SourceAnchor;
  sourceText: string;
  value: AbstractValue;
  includeTraces?: boolean;
}): AnalysisTrace[] {
  if (input.includeTraces === false) {
    return [];
  }

  return [
    {
      traceId: `value-evaluation:class-expression:${input.sourceAnchor.filePath}:${input.sourceAnchor.startLine}:${input.sourceAnchor.startColumn}`,
      category: "value-evaluation",
      summary: getClassExpressionTraceSummary(input.value),
      anchor: input.sourceAnchor,
      children: [],
      metadata: {
        sourceText: input.sourceText,
        valueKind: input.value.kind,
      },
    },
  ];
}

function getClassExpressionTraceSummary(value: AbstractValue): string {
  if (value.kind === "string-exact") {
    return "className expression evaluated to an exact string";
  }

  if (value.kind === "string-set") {
    return "className expression evaluated to a bounded set of strings";
  }

  if (value.kind === "class-set") {
    if (value.unknownDynamic) {
      return "className expression evaluated to a partial class set with unknown dynamic input";
    }

    return "className expression evaluated to a bounded class set";
  }

  return `className expression could not be fully evaluated: ${value.reason}`;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    expression = expression.expression;
  }

  return expression;
}

function summarizeTemplateExpression(expression: ts.TemplateExpression): AbstractValue {
  let candidates = [expression.head.text];
  const staticTokens = collectSafeStaticTemplateClassTokens(expression);

  for (const span of expression.templateSpans) {
    const spanValue = summarizeClassNameExpression(span.expression);
    const spanCandidates = getStringCandidates(spanValue);
    if (!spanCandidates) {
      return buildPartialTemplateClassSet(staticTokens, "unsupported-template-interpolation");
    }

    candidates = combineStrings(candidates, spanCandidates);
    if (candidates.length > MAX_STRING_COMBINATIONS) {
      return buildPartialTemplateClassSet(staticTokens, "template-interpolation-budget-exceeded");
    }

    candidates = candidates.map((candidate) => `${candidate}${span.literal.text}`);
  }

  return toStringValue(candidates);
}

function buildPartialTemplateClassSet(staticTokens: string[], reason: string): AbstractValue {
  if (staticTokens.length === 0) {
    return { kind: "unknown", reason };
  }

  return {
    kind: "class-set",
    definite: uniqueSorted(staticTokens),
    possible: [],
    unknownDynamic: true,
    reason: `partial-template:${reason}`,
  };
}

function summarizeLogicalExpression(expression: ts.BinaryExpression): AbstractValue {
  const right = summarizeClassNameExpression(expression.right);
  const rightClassSet = toClassSet(right);

  if (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return {
      kind: "class-set",
      definite: [],
      possible: [...rightClassSet.definite, ...rightClassSet.possible],
      unknownDynamic: rightClassSet.unknownDynamic,
      reason: "logical-and expression",
    };
  }

  const left = summarizeClassNameExpression(expression.left);
  return mergeClassSets([left, right], "logical-or expression");
}

function summarizeClassNameCall(expression: ts.CallExpression): AbstractValue {
  if (isClassNamesHelper(expression.expression)) {
    return summarizeClassNamesHelperArgs(expression.arguments);
  }

  const arrayJoinTarget = getArrayJoinTarget(expression);
  if (arrayJoinTarget) {
    return summarizeClassArray(arrayJoinTarget.elements);
  }

  return {
    kind: "unknown",
    reason: `unsupported-call:${expression.expression.getText()}`,
  };
}

function summarizeClassNamesHelperArgs(args: ts.NodeArray<ts.Expression>): AbstractValue {
  const parts = args.map((arg) => summarizeClassNamesHelperArg(arg));
  return mergeClassSets(parts, "class name helper call");
}

function summarizeClassNamesHelperArg(expression: ts.Expression): AbstractValue {
  expression = unwrapExpression(expression);

  if (
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    expression.kind === ts.SyntaxKind.NullKeyword ||
    expression.kind === ts.SyntaxKind.UndefinedKeyword
  ) {
    return { kind: "string-exact", value: "" };
  }

  if (expression.kind === ts.SyntaxKind.TrueKeyword) {
    return { kind: "class-set", definite: [], possible: [], unknownDynamic: false };
  }

  if (ts.isObjectLiteralExpression(expression)) {
    return summarizeClassObject(expression);
  }

  if (ts.isArrayLiteralExpression(expression)) {
    return summarizeClassArray(expression.elements);
  }

  if (ts.isConditionalExpression(expression)) {
    return summarizeClassNameExpression(expression);
  }

  if (ts.isBinaryExpression(expression)) {
    return summarizeClassNameExpression(expression);
  }

  const value = summarizeClassNameExpression(expression);
  if (value.kind === "unknown") {
    return {
      kind: "class-set",
      definite: [],
      possible: [],
      unknownDynamic: true,
      reason: value.reason,
    };
  }

  return value;
}

function summarizeClassObject(expression: ts.ObjectLiteralExpression): AbstractValue {
  const possible: string[] = [];
  let unknownDynamic = false;

  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property)) {
      unknownDynamic = true;
      continue;
    }

    const key = getStaticPropertyName(property.name);
    if (!key) {
      unknownDynamic = true;
      continue;
    }

    if (isDefinitelyFalsy(property.initializer)) {
      continue;
    }

    possible.push(...tokenizeClassNames(key));
  }

  return {
    kind: "class-set",
    definite: [],
    possible: uniqueSorted(possible),
    unknownDynamic,
    reason: "object class map",
  };
}

function summarizeClassArray(elements: ts.NodeArray<ts.Expression>): AbstractValue {
  const parts = elements.map((element) => summarizeClassNamesHelperArg(element));
  return mergeClassSets(parts, "class array");
}

function combineStringLikeValues(left: AbstractValue, right: AbstractValue): AbstractValue {
  const leftCandidates = getStringCandidates(left);
  const rightCandidates = getStringCandidates(right);

  if (!leftCandidates || !rightCandidates) {
    return { kind: "unknown", reason: "unsupported-string-concatenation" };
  }

  const combined = combineStrings(leftCandidates, rightCandidates);
  if (combined.length > MAX_STRING_COMBINATIONS) {
    return { kind: "unknown", reason: "string-concatenation-budget-exceeded" };
  }

  return toStringValue(combined);
}

function collectSafeStaticTemplateClassTokens(expression: ts.TemplateExpression): string[] {
  const templateParts = [
    expression.head.text,
    ...expression.templateSpans.map((span) => span.literal.text),
  ];
  const tokens: string[] = [];

  for (let index = 0; index < templateParts.length; index += 1) {
    tokens.push(
      ...collectSafeStaticClassTokensFromTemplatePart(templateParts[index], {
        isTemplateStart: index === 0,
        isTemplateEnd: index === templateParts.length - 1,
      }),
    );
  }

  return uniqueSorted(tokens);
}

function collectSafeStaticClassTokensFromTemplatePart(
  text: string,
  boundaries: {
    isTemplateStart: boolean;
    isTemplateEnd: boolean;
  },
): string[] {
  const tokens: string[] = [];
  const tokenPattern = /\S+/g;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(text)) !== null) {
    const token = match[0];
    const startIndex = match.index;
    const endIndex = startIndex + token.length;
    const hasSafeStart =
      startIndex > 0 ? /\s/.test(text[startIndex - 1]) : boundaries.isTemplateStart;
    const hasSafeEnd =
      endIndex < text.length ? /\s/.test(text[endIndex]) : boundaries.isTemplateEnd;

    if (hasSafeStart && hasSafeEnd) {
      tokens.push(token);
    }
  }

  return tokens;
}

function isClassNamesHelper(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) {
    return (
      expression.text === "clsx" ||
      expression.text === "classnames" ||
      expression.text === "classNames"
    );
  }

  return false;
}

function getArrayJoinTarget(expression: ts.CallExpression): ts.ArrayLiteralExpression | undefined {
  if (!ts.isPropertyAccessExpression(expression.expression)) {
    return undefined;
  }

  if (expression.expression.name.text !== "join") {
    return undefined;
  }

  if (!ts.isArrayLiteralExpression(expression.expression.expression)) {
    return undefined;
  }

  return expression.expression.expression;
}

function getStaticPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return undefined;
}

function isDefinitelyFalsy(expression: ts.Expression): boolean {
  expression = unwrapExpression(expression);

  return (
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    expression.kind === ts.SyntaxKind.NullKeyword ||
    expression.kind === ts.SyntaxKind.UndefinedKeyword ||
    (ts.isNumericLiteral(expression) && Number(expression.text) === 0) ||
    (ts.isStringLiteral(expression) && expression.text.length === 0)
  );
}
