import ts from "typescript";

import {
  toSourceAnchor,
  unwrapExpression,
} from "../../../../libraries/react-components/reactComponentAstUtils.js";
import {
  extractParsedSelectorEntriesFromSelectorPrelude,
  projectToCssSelectorBranchFact,
} from "../../../../libraries/selector-parsing/index.js";
import {
  readCssIdentifier,
  skipBalancedSection,
} from "../../../../libraries/selector-parsing/readCssIdentifier.js";
import type { CssSelectorBranchFact } from "../../../../types/css.js";
import type { CssInJsSelectorFact, CssInJsSelectorHostKind } from "../../types.js";
import type { SourceModuleSyntaxFacts } from "../module-syntax/index.js";

export function collectCssInJsSelectors(input: {
  filePath: string;
  sourceFile: ts.SourceFile;
  moduleSyntax: SourceModuleSyntaxFacts;
}): CssInJsSelectorFact[] {
  const facts: CssInJsSelectorFact[] = [];
  const sourceText = input.sourceFile.getFullText();

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      facts.push(...collectFromJsxElement({ ...input, node, sourceText }));
    }

    if (ts.isCallExpression(node)) {
      facts.push(...collectFromStyledCall({ ...input, node, sourceText }));
    }

    ts.forEachChild(node, visit);
  };

  visit(input.sourceFile);
  return dedupeFacts(facts).sort(compareFacts);
}

function collectFromJsxElement(input: {
  filePath: string;
  sourceFile: ts.SourceFile;
  sourceText: string;
  moduleSyntax: SourceModuleSyntaxFacts;
  node: ts.JsxElement | ts.JsxSelfClosingElement;
}): CssInJsSelectorFact[] {
  const attributes = ts.isJsxElement(input.node)
    ? input.node.openingElement.attributes.properties
    : input.node.attributes.properties;
  const facts: CssInJsSelectorFact[] = [];

  for (const attribute of attributes) {
    if (
      !ts.isJsxAttribute(attribute) ||
      !ts.isIdentifier(attribute.name) ||
      !attribute.initializer
    ) {
      continue;
    }

    const initializer = unwrapJsxInitializer(attribute.initializer);
    if (!initializer) {
      continue;
    }

    if (attribute.name.text === "sx") {
      facts.push(
        ...collectFromStyleExpression({
          ...input,
          expression: initializer,
          hostKind: "jsx-sx",
          confidence: "high",
        }),
      );
      continue;
    }

    if (attribute.name.text === "slotProps") {
      facts.push(...collectFromSlotProps({ ...input, expression: initializer }));
    }
  }

  return facts;
}

function collectFromSlotProps(input: {
  filePath: string;
  sourceFile: ts.SourceFile;
  sourceText: string;
  moduleSyntax: SourceModuleSyntaxFacts;
  expression: ts.Expression;
}): CssInJsSelectorFact[] {
  const expression = resolveStyleObjectExpression(input.expression, input.moduleSyntax);
  if (!expression) {
    return [];
  }

  const facts: CssInJsSelectorFact[] = [];
  visitObjectLiteral(expression);
  return facts;

  function visitObjectLiteral(objectLiteral: ts.ObjectLiteralExpression): void {
    for (const property of objectLiteral.properties) {
      if (!ts.isPropertyAssignment(property)) {
        continue;
      }

      const propertyName = getStaticPropertyName(property.name);
      const initializer = unwrapExpression(property.initializer);
      if (propertyName === "sx") {
        facts.push(
          ...collectFromStyleExpression({
            ...input,
            expression: initializer,
            hostKind: "jsx-sx",
            confidence: "medium",
          }),
        );
        continue;
      }

      const nested = resolveStyleObjectExpression(initializer, input.moduleSyntax);
      if (nested) {
        visitObjectLiteral(nested);
      }
    }
  }
}

function collectFromStyledCall(input: {
  filePath: string;
  sourceFile: ts.SourceFile;
  sourceText: string;
  moduleSyntax: SourceModuleSyntaxFacts;
  node: ts.CallExpression;
}): CssInJsSelectorFact[] {
  const callee = input.node.expression;
  if (!ts.isCallExpression(callee) || !isStyledCallee(callee.expression)) {
    return [];
  }

  const styleArgument = input.node.arguments[0];
  if (!styleArgument) {
    return [];
  }

  return collectFromStyleExpression({
    ...input,
    expression: styleArgument,
    hostKind: "mui-styled",
    confidence: "high",
  });
}

function collectFromStyleExpression(input: {
  filePath: string;
  sourceFile: ts.SourceFile;
  sourceText: string;
  moduleSyntax: SourceModuleSyntaxFacts;
  expression: ts.Expression;
  hostKind: CssInJsSelectorHostKind;
  confidence: CssInJsSelectorFact["confidence"];
}): CssInJsSelectorFact[] {
  const expression = unwrapExpression(input.expression);

  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    const body = unwrapFunctionBody(expression);
    return body
      ? collectFromStyleExpression({
          ...input,
          expression: body,
          confidence: "medium",
        })
      : [];
  }

  if (ts.isConditionalExpression(expression)) {
    return [
      ...collectFromStyleExpression({
        ...input,
        expression: expression.whenTrue,
        confidence: lowerConfidence(input.confidence),
      }),
      ...collectFromStyleExpression({
        ...input,
        expression: expression.whenFalse,
        confidence: lowerConfidence(input.confidence),
      }),
    ];
  }

  const objectLiteral = resolveStyleObjectExpression(expression, input.moduleSyntax);
  if (!objectLiteral) {
    return [];
  }

  return collectFromStyleObject({
    ...input,
    objectLiteral,
  });
}

function collectFromStyleObject(input: {
  filePath: string;
  sourceFile: ts.SourceFile;
  sourceText: string;
  objectLiteral: ts.ObjectLiteralExpression;
  hostKind: CssInJsSelectorHostKind;
  confidence: CssInJsSelectorFact["confidence"];
}): CssInJsSelectorFact[] {
  const facts: CssInJsSelectorFact[] = [];

  for (const property of input.objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }

    const selectorKey = getStaticSelectorPropertyName(property.name);
    if (selectorKey) {
      facts.push(...createSelectorFacts({ ...input, selectorKey, keyNode: property.name }));
    }

    const nested = unwrapExpression(property.initializer);
    if (ts.isObjectLiteralExpression(nested)) {
      facts.push(
        ...collectFromStyleObject({
          ...input,
          objectLiteral: nested,
          hostKind: selectorKey ? "object-literal-style" : input.hostKind,
        }),
      );
    }
  }

  return facts;
}

function createSelectorFacts(input: {
  filePath: string;
  sourceFile: ts.SourceFile;
  sourceText: string;
  selectorKey: string;
  keyNode: ts.PropertyName;
  hostKind: CssInJsSelectorHostKind;
  confidence: CssInJsSelectorFact["confidence"];
}): CssInJsSelectorFact[] {
  const selectorText = input.selectorKey.trim();
  const selectorStart = getSelectorTextStart(input.keyNode, input.sourceFile);
  const entries = extractParsedSelectorEntriesFromSelectorPrelude({
    selectorPrelude: selectorText,
    preludeStartIndex: selectorStart,
    sourceText: input.sourceText,
    filePath: input.filePath,
  });
  if (entries.length === 0) {
    const mentionBranch = createSelectorMentionBranch(selectorText, []);
    if (!mentionBranch) {
      return [];
    }

    return [
      {
        factId: [
          "css-in-js-selector",
          input.filePath,
          toSourceAnchor(input.keyNode, input.sourceFile, input.filePath).startLine,
          toSourceAnchor(input.keyNode, input.sourceFile, input.filePath).startColumn,
          stableHash(selectorText),
        ].join(":"),
        filePath: input.filePath,
        location: toSourceAnchor(input.keyNode, input.sourceFile, input.filePath),
        selectorText,
        hostKind: input.hostKind,
        confidence: lowerConfidence(input.confidence),
        selectorBranches: [mentionBranch],
        trace: {
          summary: `extracted CSS-in-JS selector class mentions from "${selectorText}" in ${input.hostKind}`,
        },
      },
    ];
  }

  const location = toSourceAnchor(input.keyNode, input.sourceFile, input.filePath);
  const selectorBranches = entries.map((entry) =>
    projectToCssSelectorBranchFact(entry.parsedBranch),
  );
  const mentionBranch = createSelectorMentionBranch(selectorText, selectorBranches);
  if (mentionBranch) {
    selectorBranches.push(mentionBranch);
  }

  return [
    {
      factId: [
        "css-in-js-selector",
        input.filePath,
        location.startLine,
        location.startColumn,
        stableHash(selectorText),
      ].join(":"),
      filePath: input.filePath,
      location,
      selectorText,
      hostKind: input.hostKind,
      confidence: mentionBranch ? lowerConfidence(input.confidence) : input.confidence,
      selectorBranches,
      trace: {
        summary: `extracted CSS-in-JS selector "${selectorText}" from ${input.hostKind}`,
      },
    },
  ];
}

function createSelectorMentionBranch(
  selectorText: string,
  parsedBranches: CssSelectorBranchFact[],
): CssSelectorBranchFact | undefined {
  const parsedClassNames = new Set<string>();
  for (const branch of parsedBranches) {
    for (const className of [
      ...branch.subjectClassNames,
      ...branch.requiredClassNames,
      ...branch.contextClassNames,
    ]) {
      parsedClassNames.add(className);
    }
  }

  const mentionClassNames = extractClassMentionsFromSelectorText(selectorText).filter(
    (className) => !parsedClassNames.has(className),
  );
  if (mentionClassNames.length === 0) {
    return undefined;
  }

  return {
    raw: selectorText,
    matchKind: "complex",
    subjectClassNames: [],
    requiredClassNames: [],
    contextClassNames: uniqueSortedStrings(mentionClassNames),
    negativeClassNames: [],
    hasDescendantClassNames: [],
    hasCombinators: true,
    hasSubjectModifiers: true,
    hasUnknownSemantics: true,
  };
}

function extractClassMentionsFromSelectorText(selectorText: string): string[] {
  const classNames: string[] = [];
  let index = 0;

  while (index < selectorText.length) {
    const character = selectorText[index];
    if (character === "[") {
      index = skipBalancedSection(selectorText, index, "[", "]");
      continue;
    }

    if (character !== ".") {
      index += 1;
      continue;
    }

    const identifier = readCssIdentifier(selectorText, index + 1);
    if (!identifier) {
      index += 1;
      continue;
    }

    classNames.push(identifier.value);
    index = identifier.nextIndex;
  }

  return uniqueSortedStrings(classNames);
}

function resolveStyleObjectExpression(
  expression: ts.Expression,
  moduleSyntax: SourceModuleSyntaxFacts,
): ts.ObjectLiteralExpression | undefined {
  const unwrapped = unwrapExpression(expression);
  if (ts.isObjectLiteralExpression(unwrapped)) {
    return unwrapped;
  }

  if (!ts.isIdentifier(unwrapped)) {
    return undefined;
  }

  const declaration = moduleSyntax.declarations.valueDeclarations.get(unwrapped.text);
  if (declaration?.kind !== "const" || !declaration.initializer) {
    return undefined;
  }

  const initializer = unwrapExpression(declaration.initializer);
  return ts.isObjectLiteralExpression(initializer) ? initializer : undefined;
}

function unwrapFunctionBody(
  expression: ts.ArrowFunction | ts.FunctionExpression,
): ts.Expression | undefined {
  if (!ts.isBlock(expression.body)) {
    return unwrapExpression(expression.body);
  }

  for (const statement of expression.body.statements) {
    if (ts.isReturnStatement(statement) && statement.expression) {
      return unwrapExpression(statement.expression);
    }
  }

  return undefined;
}

function unwrapJsxInitializer(
  initializer: ts.JsxAttribute["initializer"],
): ts.Expression | undefined {
  if (!initializer) {
    return undefined;
  }

  if (ts.isStringLiteral(initializer)) {
    return initializer;
  }

  if (ts.isJsxExpression(initializer)) {
    return initializer.expression;
  }

  return undefined;
}

function getStaticSelectorPropertyName(name: ts.PropertyName): string | undefined {
  const value = getStaticPropertyName(name);
  if (!value || !looksLikeSelectorKey(value)) {
    return undefined;
  }

  return value;
}

function getStaticPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  if (ts.isNoSubstitutionTemplateLiteral(name)) {
    return name.text;
  }

  return undefined;
}

function looksLikeSelectorKey(value: string): boolean {
  const trimmed = value.trim();
  return (
    /(^|,)\s*&(?:[.#:[\s>+~]|$)/.test(trimmed) ||
    /(^|,)\s*\.[_a-zA-Z-][-_a-zA-Z0-9]*(?:[\s.#:[>+~]|$)/.test(trimmed)
  );
}

function lowerConfidence(
  confidence: CssInJsSelectorFact["confidence"],
): CssInJsSelectorFact["confidence"] {
  return confidence === "high" ? "medium" : confidence;
}

function uniqueSortedStrings(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function isStyledCallee(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) {
    return expression.text === "styled";
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text === "styled";
  }

  return false;
}

function getSelectorTextStart(node: ts.PropertyName, sourceFile: ts.SourceFile): number {
  const start = node.getStart(sourceFile);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return start + 1;
  }

  return start;
}

function dedupeFacts(facts: CssInJsSelectorFact[]): CssInJsSelectorFact[] {
  const factsById = new Map<string, CssInJsSelectorFact>();
  for (const fact of facts) {
    factsById.set(fact.factId, fact);
  }
  return [...factsById.values()];
}

function compareFacts(left: CssInJsSelectorFact, right: CssInJsSelectorFact): number {
  return (
    left.filePath.localeCompare(right.filePath) ||
    left.location.startLine - right.location.startLine ||
    left.location.startColumn - right.location.startColumn ||
    left.selectorText.localeCompare(right.selectorText) ||
    left.hostKind.localeCompare(right.hostKind)
  );
}

function stableHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}
