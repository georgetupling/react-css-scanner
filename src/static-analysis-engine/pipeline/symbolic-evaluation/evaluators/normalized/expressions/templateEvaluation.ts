import { uniqueSorted } from "../../../values/classValueOperations.js";
import type { AbstractValue } from "../../../values/types.js";
import type { ExpressionSyntaxNode } from "../../../../fact-graph/index.js";
import type { SymbolicExpressionEvaluatorInput } from "../../../model/types.js";

export function shouldExpandTemplateAgainstKnownClasses(
  input: SymbolicExpressionEvaluatorInput,
): boolean {
  return !input.classExpressionSite.classExpressionSiteKey.includes("clone-element-class");
}

export function collectKnownClassNames(input: SymbolicExpressionEvaluatorInput): string[] {
  return uniqueSorted(
    input.graph.nodes.selectorBranches.flatMap((branch) => branch.requiredClassNames),
  );
}

export function expandTemplateAgainstKnownClasses(
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "template-literal" }>,
  knownClassNames: string[],
): string[] {
  if (knownClassNames.length === 0) {
    return [];
  }

  const text = [
    expression.headText,
    ...expression.spans.flatMap((span) => ["${expr}", span.literalText]),
  ].join("");
  const tokens = text.split(/\s+/).filter(Boolean);
  const staticAnchors = tokens.filter((token) => !token.includes("${expr}"));
  const matched = new Set<string>();
  for (const token of tokens) {
    if (!token.includes("${expr}")) {
      if (knownClassNames.includes(token)) {
        matched.add(token);
      }
      continue;
    }

    const literalTemplateText = token.split("${expr}").join("");
    if (!hasMeaningfulTemplateLiteralAnchor(literalTemplateText)) {
      for (const className of inferModifierClassNamesFromStaticAnchors(
        staticAnchors,
        knownClassNames,
      )) {
        matched.add(className);
      }
      continue;
    }

    const tokenPattern = token.split("${expr}").map(escapeRegex).join(".*");
    const regex = new RegExp(`^${tokenPattern}$`);
    for (const className of knownClassNames) {
      if (regex.test(className)) {
        matched.add(className);
      }
    }
  }
  return [...matched].sort((left, right) => left.localeCompare(right));
}

function hasMeaningfulTemplateLiteralAnchor(text: string): boolean {
  return /[A-Za-z0-9_]{2,}|-[A-Za-z0-9_]|[A-Za-z0-9_]-/.test(text);
}

function inferModifierClassNamesFromStaticAnchors(
  staticAnchors: string[],
  knownClassNames: string[],
): string[] {
  const matched = new Set<string>();
  for (const anchor of staticAnchors) {
    if (!knownClassNames.includes(anchor)) {
      continue;
    }
    for (const className of knownClassNames) {
      if (
        className.startsWith(`${anchor}-`) ||
        className.startsWith(`${anchor}_`) ||
        className.startsWith(`${anchor}--`) ||
        className.startsWith(`${anchor}__`)
      ) {
        matched.add(className);
      }
    }
  }
  return [...matched].sort((left, right) => left.localeCompare(right));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function collectSafeStaticTemplateClassTokens(
  expression: Extract<ExpressionSyntaxNode, { expressionKind: "template-literal" }>,
): string[] {
  const templateParts = [expression.headText, ...expression.spans.map((span) => span.literalText)];
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

export function buildPartialTemplateClassSet(
  staticTokens: string[],
  reason: string,
): AbstractValue {
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
