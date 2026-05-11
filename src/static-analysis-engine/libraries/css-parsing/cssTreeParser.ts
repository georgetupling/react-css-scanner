import * as csstree from "css-tree";

import type {
  CssAtRuleContextFact,
  CssDeclarationFact,
  CssLayerOrderStatementFact,
  CssScopeSelectorRequirementFact,
  CssStyleRuleFact,
} from "../../types/css.js";
import { parseSelectorBranch } from "../selector-parsing/parseSelectorBranch.js";
import { splitTopLevelSelectorList } from "../selector-parsing/splitTopLevelSelectorList.js";
import {
  buildCssStyleRuleFact,
  DECLARATION_ONLY_AT_RULES,
  expandNestedSelectorPrelude,
  sourceAnchorFromOffsets,
} from "./parserUtils.js";
import { getCssDeclarationPropertyEffects } from "./declarationPropertyEffects.js";

type CssTreeNode = {
  type: string;
  loc?: {
    start?: { offset?: number; line?: number; column?: number };
    end?: { offset?: number; line?: number; column?: number };
  } | null;
  name?: string;
  property?: string;
  important?: boolean;
  value?: unknown;
  prelude?: CssTreeNode | null;
  block?: { children?: CssTreeNode[] } | null;
  children?: CssTreeNode[];
};

export function extractCssTreeStyleRules(input: {
  cssText: string;
  filePath?: string;
}): CssStyleRuleFact[] {
  return extractCssTreeStylesheetFacts(input).rules;
}

export function extractCssTreeStylesheetFacts(input: { cssText: string; filePath?: string }): {
  rules: CssStyleRuleFact[];
  layerOrderStatements: CssLayerOrderStatementFact[];
} {
  const ast = csstree.parse(input.cssText, {
    filename: input.filePath,
    positions: true,
    parseCustomProperty: false,
    parseValue: false,
  });
  const plainAst = csstree.toPlainObject(ast) as CssTreeNode;
  const rules = collectRules({
    nodes: plainAst.children ?? [],
    sourceText: input.cssText,
    filePath: input.filePath,
    atRuleContext: [],
    layerOrderByName: new Map(),
    currentLayerName: undefined,
    layerOrderStatements: [],
    layerStatementState: { nextSourceOrder: 0 },
  });
  return {
    rules,
    layerOrderStatements: rules.layerOrderStatements,
  };
}

type CollectedCssRules = CssStyleRuleFact[] & {
  layerOrderStatements: CssLayerOrderStatementFact[];
};

function collectRules(input: {
  nodes: CssTreeNode[];
  sourceText: string;
  filePath?: string;
  atRuleContext: CssAtRuleContextFact[];
  layerOrderByName: Map<string, number>;
  currentLayerName?: string;
  layerOrderStatements: CssLayerOrderStatementFact[];
  layerStatementState: { nextSourceOrder: number };
  parentSelectorPrelude?: string;
}): CollectedCssRules {
  const rules: CollectedCssRules = Object.assign([], {
    layerOrderStatements: input.layerOrderStatements,
  });

  for (const node of input.nodes) {
    if (node.type === "Atrule") {
      const atRule = cssTreeAtRuleContext({
        node,
        sourceText: input.sourceText,
        layerOrderByName: input.layerOrderByName,
        currentLayerName: input.currentLayerName,
        layerOrderStatements: input.layerOrderStatements,
        layerStatementState: input.layerStatementState,
      });
      if (atRule && !DECLARATION_ONLY_AT_RULES.has(atRule.name)) {
        if (atRule.name === "layer" && !node.block) {
          continue;
        }
        rules.push(
          ...collectRules({
            nodes: node.block?.children ?? [],
            sourceText: input.sourceText,
            filePath: input.filePath,
            atRuleContext: [...input.atRuleContext, atRule],
            layerOrderByName: input.layerOrderByName,
            currentLayerName: atRule.name === "layer" ? atRule.layerName : input.currentLayerName,
            layerOrderStatements: input.layerOrderStatements,
            layerStatementState: input.layerStatementState,
          }),
        );
      }
      continue;
    }

    if (node.type !== "Rule" || !node.prelude) {
      continue;
    }

    const rawSelectorPrelude = getNodeSourceText({
      node: node.prelude,
      sourceText: input.sourceText,
      fallback: generateCssTreeNode(node.prelude),
    }).trim();
    const selectorPrelude = input.parentSelectorPrelude
      ? expandNestedSelectorPrelude(input.parentSelectorPrelude, rawSelectorPrelude)
      : rawSelectorPrelude;
    const selectorStartOffset = node.prelude.loc?.start?.offset ?? node.loc?.start?.offset ?? 0;

    rules.push(
      buildCssStyleRuleFact({
        selectorPrelude,
        selectorStartOffset,
        sourceText: input.sourceText,
        filePath: input.filePath,
        declarations: extractDeclarations({
          ruleNode: node,
          sourceText: input.sourceText,
          filePath: input.filePath,
        }),
        atRuleContext: input.atRuleContext,
      }),
    );

    rules.push(
      ...collectRules({
        nodes: node.block?.children ?? [],
        sourceText: input.sourceText,
        filePath: input.filePath,
        atRuleContext: input.atRuleContext,
        layerOrderByName: input.layerOrderByName,
        currentLayerName: input.currentLayerName,
        layerOrderStatements: input.layerOrderStatements,
        layerStatementState: input.layerStatementState,
        parentSelectorPrelude: selectorPrelude,
      }),
    );
  }

  return rules;
}

function cssTreeAtRuleContext(input: {
  node: CssTreeNode;
  sourceText: string;
  layerOrderByName: Map<string, number>;
  currentLayerName?: string;
  layerOrderStatements: CssLayerOrderStatementFact[];
  layerStatementState: { nextSourceOrder: number };
}): CssAtRuleContextFact | undefined {
  if (!input.node.name) {
    return undefined;
  }

  const params = input.node.prelude
    ? getNodeSourceText({
        node: input.node.prelude,
        sourceText: input.sourceText,
        fallback: generateCssTreeNode(input.node.prelude),
      }).trim()
    : "";
  if (input.node.name.toLowerCase() === "layer") {
    const layerNames = splitLayerNameList(params).map((layerName) =>
      qualifyLayerName(input.currentLayerName, layerName),
    );
    if (layerNames.length > 0) {
      input.layerOrderStatements.push({
        layerNames,
        sourceOrder: input.layerStatementState.nextSourceOrder,
      });
      input.layerStatementState.nextSourceOrder += 1;
    }
    for (const layerName of layerNames) {
      registerLayerName(input.layerOrderByName, layerName);
    }
    const layerName = layerNames.length === 1 ? layerNames[0] : undefined;
    return {
      name: "layer",
      params,
      ...(layerName ? { layerName } : {}),
      ...(layerName ? { layerOrder: input.layerOrderByName.get(layerName) } : {}),
      layerOrderKnown: Boolean(layerName),
    };
  }

  if (input.node.name.toLowerCase() === "scope") {
    return {
      name: "scope",
      params,
      ...parseScopeParams(params),
    };
  }

  return {
    name: input.node.name.toLowerCase(),
    params,
  };
}

function qualifyLayerName(parentLayerName: string | undefined, layerName: string): string {
  return parentLayerName ? `${parentLayerName}.${layerName}` : layerName;
}

function parseScopeParams(
  params: string,
): Pick<
  CssAtRuleContextFact,
  | "scopeRootClassName"
  | "scopeLimitClassName"
  | "scopeRootRequirements"
  | "scopeLimitRequirements"
  | "scopeSupported"
> {
  const scopePrelude = parseScopePrelude(params);
  if (!scopePrelude) {
    return {
      scopeSupported: false,
    };
  }

  const rootRequirements = parseScopeSelectorRequirements(scopePrelude.rootSelectorList);
  const limitRequirements = scopePrelude.limitSelectorList
    ? parseScopeSelectorRequirements(scopePrelude.limitSelectorList)
    : undefined;
  if (!rootRequirements || (scopePrelude.limitSelectorList && !limitRequirements)) {
    return {
      scopeSupported: false,
    };
  }

  const legacyRootClassName =
    rootRequirements.length === 1 && rootRequirements[0].requiredClassNames.length === 1
      ? rootRequirements[0].requiredClassNames[0]
      : undefined;
  const legacyLimitClassName =
    limitRequirements?.length === 1 && limitRequirements[0].requiredClassNames.length === 1
      ? limitRequirements[0].requiredClassNames[0]
      : undefined;

  return {
    ...(legacyRootClassName ? { scopeRootClassName: legacyRootClassName } : {}),
    ...(legacyLimitClassName ? { scopeLimitClassName: legacyLimitClassName } : {}),
    scopeRootRequirements: rootRequirements,
    ...(limitRequirements ? { scopeLimitRequirements: limitRequirements } : {}),
    scopeSupported: true,
  };
}

function parseScopePrelude(
  params: string,
): { rootSelectorList: string; limitSelectorList?: string } | undefined {
  let index = skipWhitespace(params, 0);
  const root = readParenthesizedScopeContent(params, index);
  if (!root) {
    return undefined;
  }

  index = skipWhitespace(params, root.nextIndex);
  if (index >= params.length) {
    return {
      rootSelectorList: root.content,
    };
  }

  if (!params.slice(index).match(/^to\b/u)) {
    return undefined;
  }
  index = skipWhitespace(params, index + 2);
  const limit = readParenthesizedScopeContent(params, index);
  if (!limit) {
    return undefined;
  }
  index = skipWhitespace(params, limit.nextIndex);
  if (index !== params.length) {
    return undefined;
  }

  return {
    rootSelectorList: root.content,
    limitSelectorList: limit.content,
  };
}

function readParenthesizedScopeContent(
  value: string,
  startIndex: number,
): { content: string; nextIndex: number } | undefined {
  if (value[startIndex] !== "(") {
    return undefined;
  }

  let depth = 0;
  let stringQuote: string | undefined;
  let escaped = false;
  for (let index = startIndex; index < value.length; index += 1) {
    const character = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (stringQuote) {
      if (character === "\\") {
        escaped = true;
      } else if (character === stringQuote) {
        stringQuote = undefined;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      stringQuote = character;
      continue;
    }

    if (character === "(") {
      depth += 1;
      continue;
    }

    if (character !== ")") {
      continue;
    }

    depth -= 1;
    if (depth === 0) {
      return {
        content: value.slice(startIndex + 1, index).trim(),
        nextIndex: index + 1,
      };
    }
  }

  return undefined;
}

function parseScopeSelectorRequirements(
  selectorList: string,
): CssScopeSelectorRequirementFact[] | undefined {
  const selectors = splitTopLevelSelectorList(selectorList);
  if (selectors.length === 0) {
    return undefined;
  }

  const requirements: CssScopeSelectorRequirementFact[] = [];
  for (const selectorText of selectors) {
    const parsedBranch = parseSelectorBranch(selectorText);
    if (
      !parsedBranch ||
      parsedBranch.steps.length !== 1 ||
      parsedBranch.hasCombinators ||
      parsedBranch.hasUnknownSemantics ||
      parsedBranch.hasSubjectModifiers ||
      parsedBranch.subjectClassNames.length === 0 ||
      parsedBranch.classAttributePredicates.length > 0
    ) {
      return undefined;
    }

    requirements.push({
      selectorText,
      requiredClassNames: [...parsedBranch.subjectClassNames].sort((left, right) =>
        left.localeCompare(right),
      ),
      ...(parsedBranch.negativeClassNames.length > 0
        ? {
            forbiddenClassNames: [...parsedBranch.negativeClassNames].sort((left, right) =>
              left.localeCompare(right),
            ),
          }
        : {}),
    });
  }

  return requirements;
}

function skipWhitespace(value: string, startIndex: number): number {
  let index = startIndex;
  while (index < value.length && /\s/u.test(value[index])) {
    index += 1;
  }
  return index;
}

function registerLayerName(layerOrderByName: Map<string, number>, layerName: string): void {
  if (!layerOrderByName.has(layerName)) {
    layerOrderByName.set(layerName, layerOrderByName.size);
  }
}

function splitLayerNameList(params: string): string[] {
  return params
    .split(",")
    .map((layerName) => layerName.trim())
    .filter((layerName) => /^[a-zA-Z_][\w-]*(?:\.[a-zA-Z_][\w-]*)*$/.test(layerName));
}

function extractDeclarations(input: {
  ruleNode: CssTreeNode;
  sourceText: string;
  filePath?: string;
}): CssDeclarationFact[] {
  return (input.ruleNode.block?.children ?? [])
    .filter((child) => child.type === "Declaration")
    .map((declaration) => {
      const startOffset = declaration.loc?.start?.offset ?? 0;
      const endOffset = declaration.loc?.end?.offset ?? startOffset;
      return {
        property: declaration.property ?? "",
        value: declaration.value ? generateCssTreeNode(declaration.value).trim() : "",
        important: declaration.important ?? false,
        propertyEffects: getCssDeclarationPropertyEffects({
          property: declaration.property ?? "",
          value: declaration.value ? generateCssTreeNode(declaration.value).trim() : "",
        }),
        sourceAnchor: sourceAnchorFromOffsets({
          sourceText: input.sourceText,
          filePath: input.filePath,
          startOffset,
          endOffset,
        }),
      };
    })
    .filter((declaration) => declaration.property && declaration.value);
}

function getNodeSourceText(input: {
  node: CssTreeNode;
  sourceText: string;
  fallback: string;
}): string {
  const startOffset = input.node.loc?.start?.offset;
  const endOffset = input.node.loc?.end?.offset;
  if (startOffset === undefined || endOffset === undefined) {
    return input.fallback;
  }

  return input.sourceText.slice(startOffset, endOffset);
}

function generateCssTreeNode(node: unknown): string {
  return csstree.generate(csstree.fromPlainObject(node as never));
}
