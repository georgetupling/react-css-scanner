import ts from "typescript";
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
      expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
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
        mutuallyExclusiveGroups: [
          uniqueSorted(stringCandidates.flatMap((candidate) => tokenizeClassNames(candidate))),
        ],
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
  if (expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    if (left.kind !== "unknown") {
      return left;
    }

    return {
      kind: "class-set",
      definite: [],
      possible: uniqueSorted([...rightClassSet.definite, ...rightClassSet.possible]),
      mutuallyExclusiveGroups: rightClassSet.mutuallyExclusiveGroups,
      unknownDynamic: true,
      reason: "nullish coalescing expression",
    };
  }

  return mergeClassSets([left, right], "logical-or expression");
}

function summarizeClassNameCall(expression: ts.CallExpression): AbstractValue {
  if (isClassNamesHelper(expression.expression)) {
    return summarizeClassNamesHelperArgs(expression.arguments);
  }

  const arrayJoinTarget = getArrayJoinTarget(expression);
  if (arrayJoinTarget) {
    return summarizeClassArrayJoin(arrayJoinTarget.elements, expression.arguments);
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
  const definite: string[] = [];
  const possible: string[] = [];
  let unknownDynamic = false;

  for (const property of expression.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      possible.push(...tokenizeClassNames(property.name.text));
      continue;
    }

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

    if (isDefinitelyTruthy(property.initializer)) {
      definite.push(...tokenizeClassNames(key));
      continue;
    }

    possible.push(...tokenizeClassNames(key));
  }

  return {
    kind: "class-set",
    definite: uniqueSorted(definite),
    possible: uniqueSorted(possible),
    unknownDynamic,
    reason: "object class map",
  };
}

function summarizeClassArray(elements: ts.NodeArray<ts.Expression>): AbstractValue {
  const parts = elements.map((element) => summarizeClassNamesHelperArg(element));
  return mergeClassSets(parts, "class array");
}

function summarizeClassArrayJoin(
  elements: ts.NodeArray<ts.Expression>,
  args: ts.NodeArray<ts.Expression>,
): AbstractValue {
  const separator = getJoinSeparator(args);
  if (separator === undefined) {
    return { kind: "unknown", reason: "unsupported-join-separator" };
  }

  if (/^\s*$/.test(separator)) {
    return summarizeClassArray(elements);
  }

  let candidates = [""];
  for (const element of elements) {
    const elementCandidates = getStringCandidates(summarizeClassNamesHelperArg(element));
    if (!elementCandidates) {
      return { kind: "unknown", reason: "non-whitespace-join-separator" };
    }

    candidates = candidates.flatMap((prefix) =>
      elementCandidates.map((candidate) =>
        prefix.length === 0 ? candidate : `${prefix}${separator}${candidate}`,
      ),
    );
    if (candidates.length > MAX_STRING_COMBINATIONS) {
      return { kind: "unknown", reason: "string-concatenation-budget-exceeded" };
    }
  }

  return toStringValue(candidates);
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

function getJoinSeparator(args: ts.NodeArray<ts.Expression>): string | undefined {
  if (args.length === 0) {
    return ",";
  }

  if (args.length !== 1) {
    return undefined;
  }

  const separator = unwrapExpression(args[0]);
  if (ts.isStringLiteral(separator) || ts.isNoSubstitutionTemplateLiteral(separator)) {
    return separator.text;
  }

  return undefined;
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

function isDefinitelyTruthy(expression: ts.Expression): boolean {
  expression = unwrapExpression(expression);

  return (
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    (ts.isNumericLiteral(expression) && Number(expression.text) !== 0) ||
    (ts.isStringLiteral(expression) && expression.text.length > 0) ||
    (ts.isNoSubstitutionTemplateLiteral(expression) && expression.text.length > 0)
  );
}
