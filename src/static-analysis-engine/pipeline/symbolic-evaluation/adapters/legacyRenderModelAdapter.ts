import ts from "typescript";

import type { SourceAnchor } from "../../../types/core.js";
import { mergeClassNameValues, toAbstractClassSet } from "../class-values/index.js";
import { buildClassExpressionTraces } from "../class-values/classExpressionTraces.js";
import { summarizeClassNameExpression } from "../class-values/classExpressions.js";
import type { ClassExpressionSummary } from "../class-values/index.js";
import type { BuildContext } from "../../render-model/render-ir/shared/internalTypes.js";
import {
  toSourceAnchor,
  unwrapExpression,
} from "../../render-model/render-ir/shared/renderIrUtils.js";
import { resolveDeclaredValueSymbol } from "../../render-model/render-ir/collection/shared/indexExpressionBindingsBySymbolId.js";
import {
  mergeExpressionBindings,
  resolveBoundExpressionContext,
  resolveHelperCallContext,
} from "../../render-model/render-ir/resolution/resolveBindings.js";
import { resolveExactTruthyExpression } from "../../render-model/render-ir/resolution/resolveExactValues.js";

const MAX_CLASS_NAME_RESOLUTION_DEPTH = 100;
const MAX_EXACT_CLASS_ARRAY_RESOLUTION_DEPTH = 100;
const MAX_TEMPLATE_STRING_COMBINATIONS = 32;

type ClassNameResolutionState = {
  activeExpressions: Set<string>;
  depth: number;
};

type ExactClassArrayResolutionState = {
  activeExpressions: Set<string>;
  depth: number;
};

export function summarizeClassNameExpressionInLegacyRenderModel(input: {
  expression: ts.Expression;
  context: BuildContext;
}): ClassExpressionSummary {
  const boundSummary = summarizeBoundClassNameExpression(input.expression, input.context);
  const sourceExpression = boundSummary.sourceExpression ?? input.expression;
  const sourceFile = sourceExpression.getSourceFile() ?? input.context.parsedSourceFile;
  const sourceAnchor = toSourceAnchor(sourceExpression, sourceFile, sourceFile.fileName);
  const sourceText = sourceExpression.getText(sourceFile);

  const summary = {
    sourceAnchor,
    value: boundSummary.value,
    classes: toAbstractClassSet(boundSummary.value, sourceAnchor),
    classNameSourceAnchors: collectClassNameSourceAnchors(input.expression, input.context),
    sourceText,
    traces: buildClassExpressionTraces({
      sourceAnchor,
      sourceText,
      value: boundSummary.value,
      includeTraces: input.context.includeTraces,
    }),
  };

  input.context.classExpressionSummarySink?.({
    location: toSourceAnchor(
      input.expression,
      input.expression.getSourceFile(),
      input.expression.getSourceFile().fileName,
    ),
    rawExpressionText: input.expression.getText(input.expression.getSourceFile()),
    summary,
  });

  return summary;
}

function summarizeBoundClassNameExpression(
  expression: ts.Expression,
  context: BuildContext,
  state: ClassNameResolutionState = {
    activeExpressions: new Set(),
    depth: 0,
  },
): {
  value: ReturnType<typeof summarizeClassNameExpression>;
  sourceExpression?: ts.Expression;
} {
  if (state.depth > MAX_CLASS_NAME_RESOLUTION_DEPTH) {
    return {
      value: { kind: "unknown", reason: "class-name-resolution-budget-exceeded" },
      sourceExpression: expression,
    };
  }

  const expressionKey = getExpressionResolutionKey(expression, context);
  if (state.activeExpressions.has(expressionKey)) {
    return {
      value: { kind: "unknown", reason: "class-name-resolution-cycle" },
      sourceExpression: expression,
    };
  }

  state.activeExpressions.add(expressionKey);
  try {
    const foundExpression = ts.isCallExpression(expression)
      ? resolveExactFoundClassExpression(expression, context)
      : undefined;
    if (foundExpression !== undefined) {
      if (foundExpression === null) {
        return { value: { kind: "string-exact", value: "" }, sourceExpression: expression };
      }

      return summarizeBoundClassNameExpression(
        foundExpression,
        context,
        nextClassNameResolutionState(state),
      );
    }

    const joinedClassArraySummary = ts.isCallExpression(expression)
      ? summarizeJoinedClassArrayExpression(expression, context, state)
      : undefined;
    if (joinedClassArraySummary) {
      return joinedClassArraySummary;
    }

    const helperResolution = ts.isCallExpression(expression)
      ? resolveHelperCallContext(expression, context)
      : undefined;
    if (helperResolution) {
      return summarizeBoundClassNameExpression(
        helperResolution.expression,
        helperResolution.context,
        nextClassNameResolutionState(state),
      );
    }

    const boundExpression = resolveBoundExpressionContext(expression, context);
    if (boundExpression) {
      return summarizeBoundClassNameExpression(
        boundExpression.expression,
        boundExpression.context,
        nextClassNameResolutionState(state),
      );
    }

    if (ts.isIdentifier(expression)) {
      const stringValues = context.stringSetBindings.get(expression.text);
      if (stringValues) {
        return {
          value: {
            kind: "string-set",
            values: stringValues,
          },
          sourceExpression: expression,
        };
      }
    }

    if (ts.isTemplateExpression(expression)) {
      return {
        value: summarizeBoundTemplateExpression(expression, context, state),
        sourceExpression: expression,
      };
    }

    if (ts.isConditionalExpression(expression)) {
      const whenTrue = summarizeBoundClassNameExpression(
        expression.whenTrue,
        context,
        nextClassNameResolutionState(state),
      );
      const whenFalse = summarizeBoundClassNameExpression(
        expression.whenFalse,
        context,
        nextClassNameResolutionState(state),
      );
      const branchValues = [whenTrue.value, whenFalse.value];
      if (branchValues.some((value) => value.kind === "class-set")) {
        return {
          value: mergeClassNameValues(branchValues, "conditional expression"),
          sourceExpression: expression,
        };
      }

      const values = new Set<string>();

      for (const candidate of branchValues) {
        if (candidate.kind === "string-exact") {
          values.add(candidate.value);
          continue;
        }

        if (candidate.kind === "string-set") {
          for (const value of candidate.values) {
            values.add(value);
          }
          continue;
        }

        return {
          value: { kind: "unknown", reason: "unsupported-conditional-branch" },
          sourceExpression: expression,
        };
      }

      return {
        value: {
          kind: "string-set",
          values: [...values].sort((left, right) => left.localeCompare(right)),
        },
        sourceExpression: expression,
      };
    }

    if (
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      const left = summarizeBoundClassNameExpression(
        expression.left,
        context,
        nextClassNameResolutionState(state),
      );
      if (left.value.kind !== "unknown") {
        return {
          value: left.value,
          sourceExpression: expression,
        };
      }

      const right = summarizeBoundClassNameExpression(
        expression.right,
        context,
        nextClassNameResolutionState(state),
      );
      const rightClassSet = toAbstractClassSet(
        right.value,
        toSourceAnchor(expression.right, expression.right.getSourceFile(), context.filePath),
      );
      return {
        value: {
          kind: "class-set",
          definite: [],
          possible: uniqueSorted([...rightClassSet.definite, ...rightClassSet.possible]),
          mutuallyExclusiveGroups: rightClassSet.mutuallyExclusiveGroups,
          unknownDynamic: true,
          reason: "nullish coalescing expression",
        },
        sourceExpression: expression,
      };
    }

    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isSatisfiesExpression(expression)
    ) {
      return summarizeBoundClassNameExpression(
        expression.expression,
        context,
        nextClassNameResolutionState(state),
      );
    }

    return {
      value: summarizeClassNameExpression(expression),
      sourceExpression: expression,
    };
  } finally {
    state.activeExpressions.delete(expressionKey);
  }
}

function summarizeBoundTemplateExpression(
  expression: ts.TemplateExpression,
  context: BuildContext,
  state: ClassNameResolutionState,
): ReturnType<typeof summarizeClassNameExpression> {
  let candidates = [expression.head.text];
  const staticTokens = collectSafeStaticTemplateClassTokens(expression);

  for (const span of expression.templateSpans) {
    const spanValue = summarizeBoundClassNameExpression(
      span.expression,
      context,
      nextClassNameResolutionState(state),
    ).value;
    const spanCandidates = getStringCandidates(spanValue);
    if (!spanCandidates) {
      return buildPartialTemplateClassSet(staticTokens, "unsupported-template-interpolation");
    }

    candidates = combineStrings(candidates, spanCandidates);
    if (candidates.length > MAX_TEMPLATE_STRING_COMBINATIONS) {
      return buildPartialTemplateClassSet(staticTokens, "template-interpolation-budget-exceeded");
    }

    candidates = candidates.map((candidate) => `${candidate}${span.literal.text}`);
  }

  return toStringValue(candidates);
}

function buildPartialTemplateClassSet(
  staticTokens: string[],
  reason: string,
): ReturnType<typeof summarizeClassNameExpression> {
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

function summarizeJoinedClassArrayExpression(
  expression: ts.CallExpression,
  context: BuildContext,
  state: ClassNameResolutionState,
):
  | {
      value: ReturnType<typeof summarizeClassNameExpression>;
      sourceExpression: ts.Expression;
    }
  | undefined {
  if (
    !ts.isPropertyAccessExpression(expression.expression) ||
    expression.expression.name.text !== "join" ||
    expression.arguments.length > 1
  ) {
    return undefined;
  }

  const sourceElements = resolveExactClassArrayElements(expression.expression.expression, context);
  if (!sourceElements) {
    return undefined;
  }

  const separator = getJoinSeparator(expression.arguments);
  if (separator === undefined) {
    return {
      value: { kind: "unknown", reason: "unsupported-join-separator" },
      sourceExpression: expression,
    };
  }

  if (!/^\s*$/.test(separator)) {
    let candidates = [""];
    for (const element of sourceElements) {
      const elementValue = summarizeBoundClassNameExpression(
        element,
        context,
        nextClassNameResolutionState(state),
      ).value;
      const elementCandidates = getStringCandidates(elementValue);
      if (!elementCandidates) {
        return {
          value: { kind: "unknown", reason: "non-whitespace-join-separator" },
          sourceExpression: expression,
        };
      }

      candidates = candidates.flatMap((prefix) =>
        elementCandidates.map((candidate) =>
          prefix.length === 0 ? candidate : `${prefix}${separator}${candidate}`,
        ),
      );
      if (candidates.length > MAX_TEMPLATE_STRING_COMBINATIONS) {
        return {
          value: { kind: "unknown", reason: "string-concatenation-budget-exceeded" },
          sourceExpression: expression,
        };
      }
    }

    return {
      value: toStringValue(candidates),
      sourceExpression: expression,
    };
  }

  return {
    value: mergeClassNameValues(
      sourceElements.map(
        (element) =>
          summarizeBoundClassNameExpression(element, context, nextClassNameResolutionState(state))
            .value,
      ),
      "class array join",
    ),
    sourceExpression: expression,
  };
}

function collectClassNameSourceAnchors(
  expression: ts.Expression,
  context: BuildContext,
  state: ClassNameResolutionState = {
    activeExpressions: new Set(),
    depth: 0,
  },
): Record<string, SourceAnchor> | undefined {
  if (state.depth > MAX_CLASS_NAME_RESOLUTION_DEPTH) {
    return undefined;
  }

  expression = unwrapExpression(expression);
  const expressionKey = getExpressionResolutionKey(expression, context);
  if (state.activeExpressions.has(expressionKey)) {
    return undefined;
  }

  state.activeExpressions.add(expressionKey);
  try {
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return buildTokenAnchors(
        tokenizeSourceClassNames(expression.text),
        toSourceAnchor(expression, expression.getSourceFile(), expression.getSourceFile().fileName),
      );
    }

    const foundExpression = ts.isCallExpression(expression)
      ? resolveExactFoundClassExpression(expression, context)
      : undefined;
    if (foundExpression === null) {
      return {};
    }
    if (foundExpression) {
      return collectClassNameSourceAnchors(
        foundExpression,
        context,
        nextClassNameResolutionState(state),
      );
    }

    const joinedClassArrayElements = ts.isCallExpression(expression)
      ? getJoinedClassArrayElements(expression, context)
      : undefined;
    if (joinedClassArrayElements) {
      return mergeClassNameSourceAnchors(
        joinedClassArrayElements.map((element) =>
          collectClassNameSourceAnchors(element, context, nextClassNameResolutionState(state)),
        ),
      );
    }

    if (ts.isCallExpression(expression) && isClassNamesHelperExpression(expression.expression)) {
      return mergeClassNameSourceAnchors(
        expression.arguments.map((argument) =>
          collectClassNameSourceAnchors(argument, context, nextClassNameResolutionState(state)),
        ),
      );
    }

    const helperResolution = ts.isCallExpression(expression)
      ? resolveHelperCallContext(expression, context)
      : undefined;
    if (helperResolution) {
      return collectClassNameSourceAnchors(
        helperResolution.expression,
        helperResolution.context,
        nextClassNameResolutionState(state),
      );
    }

    const boundExpression = resolveBoundExpressionContext(expression, context);
    if (boundExpression) {
      return collectClassNameSourceAnchors(
        boundExpression.expression,
        boundExpression.context,
        nextClassNameResolutionState(state),
      );
    }

    if (ts.isIdentifier(expression)) {
      const stringValues = context.stringSetBindings.get(expression.text);
      if (stringValues) {
        const sourceAnchor = toSourceAnchor(
          expression,
          expression.getSourceFile(),
          expression.getSourceFile().fileName,
        );
        return buildTokenAnchors(
          stringValues.flatMap((value) => tokenizeSourceClassNames(value)),
          sourceAnchor,
        );
      }
    }

    if (ts.isTemplateExpression(expression)) {
      const sourceAnchor = toSourceAnchor(
        expression,
        expression.getSourceFile(),
        expression.getSourceFile().fileName,
      );
      return buildTokenAnchors(collectSafeStaticTemplateClassTokens(expression), sourceAnchor);
    }

    if (ts.isArrayLiteralExpression(expression)) {
      return mergeClassNameSourceAnchors(
        expression.elements.map((element) =>
          collectClassNameSourceAnchors(element, context, nextClassNameResolutionState(state)),
        ),
      );
    }

    if (ts.isObjectLiteralExpression(expression)) {
      const entries: Record<string, SourceAnchor> = {};
      for (const property of expression.properties) {
        if (
          !ts.isPropertyAssignment(property) ||
          resolveExactTruthyExpression(property.initializer, context) === false
        ) {
          continue;
        }

        const key = getStaticPropertyNameText(property.name);
        if (!key) {
          continue;
        }

        Object.assign(
          entries,
          buildTokenAnchors(
            tokenizeSourceClassNames(key),
            toSourceAnchor(
              property.name,
              property.name.getSourceFile(),
              property.name.getSourceFile().fileName,
            ),
          ),
        );
      }
      return entries;
    }

    if (ts.isConditionalExpression(expression)) {
      return mergeClassNameSourceAnchors([
        collectClassNameSourceAnchors(
          expression.whenTrue,
          context,
          nextClassNameResolutionState(state),
        ),
        collectClassNameSourceAnchors(
          expression.whenFalse,
          context,
          nextClassNameResolutionState(state),
        ),
      ]);
    }

    if (ts.isBinaryExpression(expression)) {
      if (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
        return collectClassNameSourceAnchors(
          expression.right,
          context,
          nextClassNameResolutionState(state),
        );
      }

      if (expression.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
        return mergeClassNameSourceAnchors([
          collectClassNameSourceAnchors(
            expression.left,
            context,
            nextClassNameResolutionState(state),
          ),
          collectClassNameSourceAnchors(
            expression.right,
            context,
            nextClassNameResolutionState(state),
          ),
        ]);
      }
    }

    return undefined;
  } finally {
    state.activeExpressions.delete(expressionKey);
  }
}

function buildTokenAnchors(
  tokens: string[],
  sourceAnchor: SourceAnchor,
): Record<string, SourceAnchor> {
  const anchors: Record<string, SourceAnchor> = {};
  for (const token of tokens) {
    anchors[token] = sourceAnchor;
  }
  return anchors;
}

function mergeClassNameSourceAnchors(
  entries: Array<Record<string, SourceAnchor> | undefined>,
): Record<string, SourceAnchor> | undefined {
  const merged: Record<string, SourceAnchor> = {};
  for (const entry of entries) {
    if (!entry) {
      continue;
    }

    for (const [className, sourceAnchor] of Object.entries(entry)) {
      merged[className] ??= sourceAnchor;
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function tokenizeSourceClassNames(value: string): string[] {
  return value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function getJoinedClassArrayElements(
  expression: ts.CallExpression,
  context: BuildContext,
): ts.Expression[] | undefined {
  if (
    !ts.isPropertyAccessExpression(expression.expression) ||
    expression.expression.name.text !== "join" ||
    expression.arguments.length > 1
  ) {
    return undefined;
  }

  return resolveExactClassArrayElements(expression.expression.expression, context);
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

function isClassNamesHelperExpression(expression: ts.Expression): boolean {
  return (
    ts.isIdentifier(expression) &&
    (expression.text === "clsx" ||
      expression.text === "classnames" ||
      expression.text === "classNames")
  );
}

function getStaticPropertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return undefined;
}

function resolveExactFoundClassExpression(
  expression: ts.CallExpression,
  context: BuildContext,
): ts.Expression | null | undefined {
  if (
    !ts.isPropertyAccessExpression(expression.expression) ||
    expression.expression.name.text !== "find" ||
    expression.arguments.length !== 1
  ) {
    return undefined;
  }

  const sourceElements = resolveExactClassArrayElements(expression.expression.expression, context);
  if (!sourceElements) {
    return undefined;
  }

  const callback = unwrapExpression(expression.arguments[0]);
  if (ts.isIdentifier(callback) && callback.text === "Boolean") {
    for (const elementExpression of sourceElements) {
      const isTruthy = resolveExactTruthyExpression(elementExpression, context);
      if (isTruthy === undefined) {
        return undefined;
      }

      if (isTruthy) {
        return elementExpression;
      }
    }

    return null;
  }

  if (
    (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) ||
    callback.parameters.length > 2 ||
    callback.parameters.some((parameter) => !ts.isIdentifier(parameter.name))
  ) {
    return undefined;
  }

  const callbackBodyExpression = summarizeArrayCallbackBody(callback.body);
  if (!callbackBodyExpression) {
    return undefined;
  }

  for (let index = 0; index < sourceElements.length; index += 1) {
    const callbackContext = buildArrayCallbackContext({
      context,
      callback,
      elementExpression: sourceElements[index],
      index,
    });
    const isMatch = resolveExactTruthyExpression(callbackBodyExpression, callbackContext);
    if (isMatch === undefined) {
      return undefined;
    }

    if (isMatch) {
      return sourceElements[index];
    }
  }

  return null;
}

function resolveExactClassArrayElements(
  expression: ts.Expression,
  context: BuildContext,
  state: ExactClassArrayResolutionState = {
    activeExpressions: new Set(),
    depth: 0,
  },
): ts.Expression[] | undefined {
  if (state.depth > MAX_EXACT_CLASS_ARRAY_RESOLUTION_DEPTH) {
    return undefined;
  }

  const expressionKey = getExpressionResolutionKey(expression, context);
  if (state.activeExpressions.has(expressionKey)) {
    return undefined;
  }

  state.activeExpressions.add(expressionKey);
  try {
    const helperResolution = ts.isCallExpression(expression)
      ? resolveHelperCallContext(expression, context)
      : undefined;
    if (helperResolution) {
      return resolveExactClassArrayElements(
        helperResolution.expression,
        helperResolution.context,
        nextExactClassArrayResolutionState(state),
      );
    }

    const boundExpression = resolveBoundExpressionContext(expression, context);
    if (boundExpression) {
      return resolveExactClassArrayElements(
        boundExpression.expression,
        boundExpression.context,
        nextExactClassArrayResolutionState(state),
      );
    }

    if (ts.isArrayLiteralExpression(expression)) {
      const elements: ts.Expression[] = [];
      for (const element of expression.elements) {
        if (ts.isOmittedExpression(element) || ts.isSpreadElement(element)) {
          return undefined;
        }

        elements.push(element);
      }

      return elements;
    }

    if (
      ts.isCallExpression(expression) &&
      ts.isPropertyAccessExpression(expression.expression) &&
      expression.expression.name.text === "filter" &&
      expression.arguments.length === 1
    ) {
      const callback = unwrapExpression(expression.arguments[0]);
      if (ts.isIdentifier(callback) && callback.text === "Boolean") {
        const sourceElements = resolveExactClassArrayElements(
          expression.expression.expression,
          context,
          nextExactClassArrayResolutionState(state),
        );
        if (!sourceElements) {
          return undefined;
        }

        const filteredElements: ts.Expression[] = [];
        for (const element of sourceElements) {
          const isTruthy = resolveExactTruthyExpression(element, context);
          if (isTruthy === false) {
            continue;
          }

          filteredElements.push(element);
        }

        return filteredElements;
      }
    }

    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isSatisfiesExpression(expression)
    ) {
      return resolveExactClassArrayElements(
        expression.expression,
        context,
        nextExactClassArrayResolutionState(state),
      );
    }

    return undefined;
  } finally {
    state.activeExpressions.delete(expressionKey);
  }
}

function summarizeArrayCallbackBody(body: ts.ConciseBody): ts.Expression | undefined {
  if (!ts.isBlock(body)) {
    return body;
  }

  for (const statement of body.statements) {
    if (ts.isReturnStatement(statement) && statement.expression) {
      return statement.expression;
    }
  }

  return undefined;
}

function buildArrayCallbackContext(input: {
  context: BuildContext;
  callback: ts.ArrowFunction | ts.FunctionExpression;
  elementExpression: ts.Expression;
  index: number;
}): BuildContext {
  const callbackBindings = new Map<string, ts.Expression>();
  const callbackBindingsBySymbolId = new Map<string, ts.Expression>();
  const [itemParameter, indexParameter] = input.callback.parameters;

  if (itemParameter && ts.isIdentifier(itemParameter.name)) {
    callbackBindings.set(itemParameter.name.text, input.elementExpression);
    const itemSymbol = resolveDeclaredValueSymbol({
      declaration: itemParameter.name,
      filePath: input.context.filePath,
      parsedSourceFile: input.context.parsedSourceFile,
      symbolResolution: input.context.symbolResolution,
    });
    if (itemSymbol) {
      callbackBindingsBySymbolId.set(itemSymbol.id, input.elementExpression);
    }
  }

  if (indexParameter && ts.isIdentifier(indexParameter.name)) {
    const indexExpression = ts.factory.createNumericLiteral(input.index);
    callbackBindings.set(indexParameter.name.text, indexExpression);
    const indexSymbol = resolveDeclaredValueSymbol({
      declaration: indexParameter.name,
      filePath: input.context.filePath,
      parsedSourceFile: input.context.parsedSourceFile,
      symbolResolution: input.context.symbolResolution,
    });
    if (indexSymbol) {
      callbackBindingsBySymbolId.set(indexSymbol.id, indexExpression);
    }
  }

  return {
    ...input.context,
    expressionBindings: mergeExpressionBindings(input.context.expressionBindings, callbackBindings),
    expressionBindingsBySymbolId: mergeExpressionBindings(
      input.context.expressionBindingsBySymbolId,
      callbackBindingsBySymbolId,
    ),
    stringSetBindings: input.context.stringSetBindings,
  };
}

function nextClassNameResolutionState(state: ClassNameResolutionState): ClassNameResolutionState {
  return {
    activeExpressions: state.activeExpressions,
    depth: state.depth + 1,
  };
}

function nextExactClassArrayResolutionState(
  state: ExactClassArrayResolutionState,
): ExactClassArrayResolutionState {
  return {
    activeExpressions: state.activeExpressions,
    depth: state.depth + 1,
  };
}

function getExpressionResolutionKey(expression: ts.Expression, context: BuildContext): string {
  return `${context.filePath}:${expression.pos}:${expression.end}:${expression.kind}`;
}

function getStringCandidates(
  value: ReturnType<typeof summarizeClassNameExpression>,
): string[] | undefined {
  if (value.kind === "string-exact") {
    return [value.value];
  }

  if (value.kind === "string-set") {
    return value.values;
  }

  return undefined;
}

function combineStrings(left: string[], right: string[]): string[] {
  return left.flatMap((leftValue) => right.map((rightValue) => `${leftValue}${rightValue}`));
}

function toStringValue(candidates: string[]): ReturnType<typeof summarizeClassNameExpression> {
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

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
