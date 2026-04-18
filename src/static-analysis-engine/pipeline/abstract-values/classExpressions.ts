import ts from "typescript";
import type { SourceAnchor } from "../../types/core.js";
import type { AbstractClassSet, AbstractValue, ClassExpressionSummary } from "./types.js";

export function collectClassExpressionSummaries(input: {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
}): ClassExpressionSummary[] {
  const summaries: ClassExpressionSummary[] = [];

  walk(input.parsedSourceFile, (node) => {
    if (
      !ts.isJsxAttribute(node) ||
      !ts.isIdentifier(node.name) ||
      node.name.text !== "className" ||
      !node.initializer
    ) {
      return;
    }

    const expression = unwrapJsxAttributeInitializer(node.initializer);
    if (!expression) {
      return;
    }

    const sourceAnchor = toSourceAnchor(expression, input.parsedSourceFile, input.filePath);
    const sourceText = expression.getText(input.parsedSourceFile);
    const value = summarizeClassNameExpression(expression);

    summaries.push({
      sourceAnchor,
      value,
      classes: toAbstractClassSet(value, sourceAnchor),
      sourceText,
    });
  });

  return summaries;
}

export function summarizeClassNameExpression(expression: ts.Expression): AbstractValue {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return {
      kind: "string-exact",
      value: expression.text,
    };
  }

  if (ts.isConditionalExpression(expression)) {
    const whenTrue = summarizeClassNameExpression(expression.whenTrue);
    const whenFalse = summarizeClassNameExpression(expression.whenFalse);
    const values = new Set<string>();

    for (const candidate of [whenTrue, whenFalse]) {
      if (candidate.kind === "string-exact") {
        values.add(candidate.value);
      } else if (candidate.kind === "string-set") {
        for (const value of candidate.values) {
          values.add(value);
        }
      } else {
        return { kind: "unknown", reason: "unsupported-conditional-branch" };
      }
    }

    return {
      kind: "string-set",
      values: [...values].sort((left, right) => left.localeCompare(right)),
    };
  }

  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    return summarizeClassNameExpression(expression.expression);
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

function tokenizeClassNames(value: string): string[] {
  return value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function unwrapJsxAttributeInitializer(
  initializer: ts.JsxAttribute["initializer"],
): ts.Expression | undefined {
  if (!initializer) {
    return undefined;
  }

  if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) {
    return initializer;
  }

  if (
    ts.isJsxElement(initializer) ||
    ts.isJsxSelfClosingElement(initializer) ||
    ts.isJsxFragment(initializer)
  ) {
    return initializer;
  }

  if (ts.isJsxExpression(initializer)) {
    return initializer.expression ?? undefined;
  }

  return undefined;
}

function toSourceAnchor(node: ts.Node, sourceFile: ts.SourceFile, filePath: string): SourceAnchor {
  const start = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile));
  const end = ts.getLineAndCharacterOfPosition(sourceFile, node.getEnd());

  return {
    filePath,
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}
