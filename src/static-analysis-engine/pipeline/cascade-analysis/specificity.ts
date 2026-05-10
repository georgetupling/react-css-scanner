import * as csstree from "css-tree";

import type { CssSpecificity } from "./types.js";

type SpecificityResult = {
  specificity: CssSpecificity;
  supported: boolean;
  reasons: string[];
};

type PlainCssTreeNode = {
  type?: string;
  name?: string;
  children?: PlainCssTreeNode[] | { children?: PlainCssTreeNode[] };
  [key: string]: unknown;
};

export function calculateSelectorSpecificity(selectorText: string): SpecificityResult {
  try {
    const ast = csstree.toPlainObject(
      csstree.parse(selectorText, {
        context: "selector",
        positions: false,
      }),
    ) as PlainCssTreeNode;
    return calculateNodeSpecificity(ast);
  } catch (error) {
    return {
      specificity: { a: 0, b: 0, c: 0 },
      supported: false,
      reasons: [
        `selector-specificity-parse-failed:${error instanceof Error ? error.message : "unknown"}`,
      ],
    };
  }
}

function calculateNodeSpecificity(node: PlainCssTreeNode): SpecificityResult {
  const result: SpecificityResult = {
    specificity: { a: 0, b: 0, c: 0 },
    supported: true,
    reasons: [],
  };

  visit(node, result);
  return result;
}

function visit(node: PlainCssTreeNode, result: SpecificityResult): void {
  switch (node.type) {
    case "IdSelector":
      result.specificity.a += 1;
      return;
    case "ClassSelector":
    case "AttributeSelector":
      result.specificity.b += 1;
      return;
    case "TypeSelector":
      if (node.name !== "*") {
        result.specificity.c += 1;
      }
      return;
    case "PseudoElementSelector":
      result.specificity.c += 1;
      return;
    case "PseudoClassSelector":
      visitPseudoClass(node, result);
      return;
    default:
      break;
  }

  for (const child of getChildren(node)) {
    visit(child, result);
  }
}

function visitPseudoClass(node: PlainCssTreeNode, result: SpecificityResult): void {
  const name = String(node.name ?? "").toLowerCase();
  if (name === "where") {
    return;
  }

  if (name === "is" || name === "not" || name === "has") {
    const argumentSpecificities = getChildren(node).map((child) => calculateNodeSpecificity(child));
    if (argumentSpecificities.length === 0) {
      result.supported = false;
      result.reasons.push(`unsupported-pseudo-class:${name}`);
      return;
    }

    for (const argument of argumentSpecificities) {
      if (!argument.supported) {
        result.supported = false;
        result.reasons.push(...argument.reasons);
      }
    }
    addSpecificity(result.specificity, maxSpecificity(argumentSpecificities));
    return;
  }

  result.specificity.b += 1;
  for (const child of getChildren(node)) {
    visit(child, result);
  }
}

function getChildren(node: PlainCssTreeNode): PlainCssTreeNode[] {
  const children = node.children;
  if (!children) {
    return [];
  }
  if (Array.isArray(children)) {
    return children;
  }
  return Array.isArray(children.children) ? children.children : [];
}

function maxSpecificity(results: SpecificityResult[]): CssSpecificity {
  return (
    results
      .map((result) => result.specificity)
      .sort(compareSpecificity)
      .at(-1) ?? { a: 0, b: 0, c: 0 }
  );
}

export function compareSpecificity(left: CssSpecificity, right: CssSpecificity): number {
  return left.a - right.a || left.b - right.b || left.c - right.c;
}

function addSpecificity(target: CssSpecificity, addition: CssSpecificity): void {
  target.a += addition.a;
  target.b += addition.b;
  target.c += addition.c;
}
