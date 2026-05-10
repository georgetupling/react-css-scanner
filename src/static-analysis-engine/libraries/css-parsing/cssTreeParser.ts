import * as csstree from "css-tree";

import type {
  CssAtRuleContextFact,
  CssDeclarationFact,
  CssStyleRuleFact,
} from "../../types/css.js";
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
  const ast = csstree.parse(input.cssText, {
    filename: input.filePath,
    positions: true,
    parseCustomProperty: false,
    parseValue: false,
  });
  const plainAst = csstree.toPlainObject(ast) as CssTreeNode;
  return collectRules({
    nodes: plainAst.children ?? [],
    sourceText: input.cssText,
    filePath: input.filePath,
    atRuleContext: [],
    layerOrderByName: new Map(),
  });
}

function collectRules(input: {
  nodes: CssTreeNode[];
  sourceText: string;
  filePath?: string;
  atRuleContext: CssAtRuleContextFact[];
  layerOrderByName: Map<string, number>;
  parentSelectorPrelude?: string;
}): CssStyleRuleFact[] {
  const rules: CssStyleRuleFact[] = [];

  for (const node of input.nodes) {
    if (node.type === "Atrule") {
      const atRule = cssTreeAtRuleContext(node, input.sourceText, input.layerOrderByName);
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
        parentSelectorPrelude: selectorPrelude,
      }),
    );
  }

  return rules;
}

function cssTreeAtRuleContext(
  node: CssTreeNode,
  sourceText: string,
  layerOrderByName: Map<string, number>,
): CssAtRuleContextFact | undefined {
  if (!node.name) {
    return undefined;
  }

  const params = node.prelude
    ? getNodeSourceText({
        node: node.prelude,
        sourceText,
        fallback: generateCssTreeNode(node.prelude),
      }).trim()
    : "";
  if (node.name.toLowerCase() === "layer") {
    const layerNames = splitLayerNameList(params);
    for (const layerName of layerNames) {
      registerLayerName(layerOrderByName, layerName);
    }
    const layerName = layerNames.length === 1 ? layerNames[0] : undefined;
    return {
      name: "layer",
      params,
      ...(layerName ? { layerName } : {}),
      ...(layerName ? { layerOrder: layerOrderByName.get(layerName) } : {}),
      layerOrderKnown: Boolean(layerName),
    };
  }

  return {
    name: node.name.toLowerCase(),
    params,
  };
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
