import { extractCssStyleRules } from "../../libraries/css-parsing/index.js";
import type { SelectorSourceInput } from "../../libraries/selector-parsing/queryTypes.js";
import type { CssAtRuleContextFact, CssStyleRuleFact } from "../../types/css.js";
import type { ExperimentalCssFileAnalysis } from "./types.js";

export function analyzeCssRuleFiles(
  cssFiles: Array<{ filePath?: string; rules: CssStyleRuleFact[] }>,
): ExperimentalCssFileAnalysis[] {
  return cssFiles.map((cssFile) => buildCssFileAnalysis(cssFile.filePath, cssFile.rules));
}

export function analyzeCssSources(
  cssSources: SelectorSourceInput[],
): ExperimentalCssFileAnalysis[] {
  return cssSources.map((cssSource) => {
    const styleRules = extractCssStyleRules({
      cssText: cssSource.cssText,
      filePath: cssSource.filePath,
    });

    return buildCssFileAnalysis(cssSource.filePath, styleRules);
  });
}

function buildCssFileAnalysis(
  filePath: string | undefined,
  styleRules: CssStyleRuleFact[],
): ExperimentalCssFileAnalysis {
  return {
    filePath,
    styleRules,
    classDefinitions: extractClassDefinitions(styleRules),
    classContexts: extractClassContexts(styleRules),
    atRuleContexts: styleRules.map((styleRule) => styleRule.atRuleContext),
  };
}

function extractClassDefinitions(
  styleRules: CssStyleRuleFact[],
): ExperimentalCssFileAnalysis["classDefinitions"] {
  const definitions = new Map<string, ExperimentalCssFileAnalysis["classDefinitions"][number]>();

  for (const styleRule of styleRules) {
    const declarations = extractDeclarationNames(styleRule.declarations);

    for (const selectorBranch of styleRule.selectorBranches) {
      for (const className of selectorBranch.subjectClassNames) {
        const definitionKey = `${selectorBranch.raw}::${className}::${serializeAtRuleContext(styleRule.atRuleContext)}`;
        if (definitions.has(definitionKey)) {
          continue;
        }

        definitions.set(definitionKey, {
          className,
          selector: selectorBranch.raw,
          selectorBranch,
          declarations,
          declarationDetails: [...styleRule.declarations],
          line: styleRule.line,
          atRuleContext: [...styleRule.atRuleContext],
        });
      }
    }
  }

  return [...definitions.values()].sort((left, right) => {
    if (left.className === right.className) {
      if (left.line === right.line) {
        return left.selector.localeCompare(right.selector);
      }

      return left.line - right.line;
    }

    return left.className.localeCompare(right.className);
  });
}

function extractClassContexts(
  styleRules: CssStyleRuleFact[],
): ExperimentalCssFileAnalysis["classContexts"] {
  const contexts = new Map<string, ExperimentalCssFileAnalysis["classContexts"][number]>();

  for (const styleRule of styleRules) {
    for (const selectorBranch of styleRule.selectorBranches) {
      for (const className of selectorBranch.contextClassNames) {
        const contextKey = `${selectorBranch.raw}::${className}::${serializeAtRuleContext(styleRule.atRuleContext)}`;
        if (contexts.has(contextKey)) {
          continue;
        }

        contexts.set(contextKey, {
          className,
          selector: selectorBranch.raw,
          selectorBranch,
          line: styleRule.line,
          atRuleContext: [...styleRule.atRuleContext],
        });
      }
    }
  }

  return [...contexts.values()].sort((left, right) => {
    if (left.className === right.className) {
      if (left.line === right.line) {
        return left.selector.localeCompare(right.selector);
      }

      return left.line - right.line;
    }

    return left.className.localeCompare(right.className);
  });
}

function extractDeclarationNames(blockBody: Array<{ property: string }>): string[] {
  const declarationNames = new Set<string>();
  for (const declaration of blockBody) {
    declarationNames.add(declaration.property);
  }

  return [...declarationNames].sort((left, right) => left.localeCompare(right));
}

function serializeAtRuleContext(atRuleContext: CssAtRuleContextFact[]): string {
  return atRuleContext.map((entry) => `${entry.name}:${entry.params}`).join("|");
}
