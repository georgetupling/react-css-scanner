import ts from "typescript";
import type { SourceAnchor } from "../../../types/core.js";
import type { AnalysisTrace } from "../../../types/analysis.js";
import type { AbstractClassSet, AbstractValue } from "./types.js";

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

export function toAbstractClassSet(
  value: AbstractValue,
  sourceAnchor: SourceAnchor,
): AbstractClassSet {
  if (value.kind === "string-exact") {
    return {
      definite: tokenizeClassNames(value.value),
      possible: [],
      mutuallyExclusiveGroups: [],
      unknownDynamic: false,
      derivedFrom: [
        {
          sourceAnchor,
          description: "derived from exact string className expression",
        },
      ],
    };
  }

  if (value.kind === "string-set") {
    const allTokens = value.values.flatMap((entry) => tokenizeClassNames(entry));
    const tokenCounts = new Map<string, number>();
    for (const token of allTokens) {
      tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
    }

    const definite: string[] = [];
    const possible: string[] = [];
    for (const [token, count] of tokenCounts.entries()) {
      if (count === value.values.length) {
        definite.push(token);
      } else {
        possible.push(token);
      }
    }

    return {
      definite: definite.sort((left, right) => left.localeCompare(right)),
      possible: possible.sort((left, right) => left.localeCompare(right)),
      mutuallyExclusiveGroups: [],
      unknownDynamic: false,
      derivedFrom: [
        {
          sourceAnchor,
          description: "derived from bounded string-set className expression",
        },
      ],
    };
  }

  if (value.kind === "class-set") {
    return {
      definite: [...value.definite].sort((left, right) => left.localeCompare(right)),
      possible: [...value.possible].sort((left, right) => left.localeCompare(right)),
      mutuallyExclusiveGroups: [],
      unknownDynamic: value.unknownDynamic,
      derivedFrom: [
        {
          sourceAnchor,
          description: value.reason
            ? `derived from bounded class-set expression: ${value.reason}`
            : "derived from bounded class-set expression",
        },
      ],
    };
  }

  return {
    definite: [],
    possible: [],
    mutuallyExclusiveGroups: [],
    unknownDynamic: true,
    derivedFrom: [
      {
        sourceAnchor,
        description: `className expression degraded to unknown: ${value.reason}`,
      },
    ],
  };
}

export function buildClassExpressionTraces(input: {
  sourceAnchor: SourceAnchor;
  sourceText: string;
  value: AbstractValue;
}): AnalysisTrace[] {
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

function tokenizeClassNames(value: string): string[] {
  return value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
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

  for (const span of expression.templateSpans) {
    const spanValue = summarizeClassNameExpression(span.expression);
    const spanCandidates = getStringCandidates(spanValue);
    if (!spanCandidates) {
      return { kind: "unknown", reason: "unsupported-template-interpolation" };
    }

    candidates = combineStrings(candidates, spanCandidates);
    if (candidates.length > MAX_STRING_COMBINATIONS) {
      return { kind: "unknown", reason: "template-interpolation-budget-exceeded" };
    }

    candidates = candidates.map((candidate) => `${candidate}${span.literal.text}`);
  }

  return toStringValue(candidates);
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

function mergeClassSets(values: AbstractValue[], reason: string): AbstractValue {
  const definite = new Set<string>();
  const possible = new Set<string>();
  let unknownDynamic = false;

  for (const value of values) {
    const classSet = toClassSet(value);
    for (const className of classSet.definite) {
      definite.add(className);
    }
    for (const className of classSet.possible) {
      possible.add(className);
    }
    unknownDynamic ||= classSet.unknownDynamic;
  }

  for (const className of definite) {
    possible.delete(className);
  }

  return {
    kind: "class-set",
    definite: [...definite].sort((left, right) => left.localeCompare(right)),
    possible: [...possible].sort((left, right) => left.localeCompare(right)),
    unknownDynamic,
    reason,
  };
}

function toClassSet(value: AbstractValue): {
  definite: string[];
  possible: string[];
  unknownDynamic: boolean;
} {
  if (value.kind === "string-exact") {
    return {
      definite: tokenizeClassNames(value.value),
      possible: [],
      unknownDynamic: false,
    };
  }

  if (value.kind === "string-set") {
    const allTokens = value.values.flatMap((entry) => tokenizeClassNames(entry));
    const tokenCounts = new Map<string, number>();
    for (const token of allTokens) {
      tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
    }

    const definite: string[] = [];
    const possible: string[] = [];
    for (const [token, count] of tokenCounts.entries()) {
      if (count === value.values.length) {
        definite.push(token);
      } else {
        possible.push(token);
      }
    }

    return {
      definite,
      possible,
      unknownDynamic: false,
    };
  }

  if (value.kind === "class-set") {
    return value;
  }

  return {
    definite: [],
    possible: [],
    unknownDynamic: true,
  };
}

function getStringCandidates(value: AbstractValue): string[] | undefined {
  if (value.kind === "string-exact") {
    return [value.value];
  }

  if (value.kind === "string-set") {
    return value.values;
  }

  return undefined;
}

function collectStringCandidates(...values: AbstractValue[]): string[] | undefined {
  const candidates = new Set<string>();

  for (const value of values) {
    const valueCandidates = getStringCandidates(value);
    if (!valueCandidates) {
      return undefined;
    }

    for (const candidate of valueCandidates) {
      candidates.add(candidate);
    }
  }

  return [...candidates].sort((left, right) => left.localeCompare(right));
}

function combineStrings(left: string[], right: string[]): string[] {
  return left.flatMap((leftValue) => right.map((rightValue) => `${leftValue}${rightValue}`));
}

function toStringValue(candidates: string[]): AbstractValue {
  const uniqueCandidates = uniqueSorted(candidates);
  if (uniqueCandidates.length === 1) {
    return {
      kind: "string-exact",
      value: uniqueCandidates[0],
    };
  }

  return {
    kind: "string-set",
    values: uniqueCandidates,
  };
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

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
