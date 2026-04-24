import { readFile } from "node:fs/promises";
import type { DiscoveredProjectFile } from "../files/types.js";
import { extractCssStyleRules } from "../parser/parseCssStyleRules.js";
import type { CssFileFact, CssImportFact, ExternalCssFact } from "./types.js";

const CSS_IMPORT_PATTERN = /@import\s+(?:url\()?["']([^"']+)["']\)?/g;

export async function extractCssFileFacts(cssFile: DiscoveredProjectFile): Promise<CssFileFact> {
  const content = await readFile(cssFile.absolutePath, "utf8");
  const styleRules = extractCssStyleRules(content);

  return {
    filePath: cssFile.relativePath,
    styleRules,
    classDefinitions: extractClassDefinitions(styleRules),
    imports: extractCssImports(content),
  };
}

export async function extractExternalCssFacts(input: {
  specifier: string;
  resolvedPath: string;
}): Promise<ExternalCssFact> {
  const content = await readFile(input.resolvedPath, "utf8");

  return buildExternalCssFact(input, content);
}

export function extractExternalCssFactsFromContent(input: {
  specifier: string;
  resolvedPath: string;
  content: string;
}): ExternalCssFact {
  return buildExternalCssFact(input, input.content);
}

function buildExternalCssFact(
  input: {
    specifier: string;
    resolvedPath: string;
  },
  content: string,
): ExternalCssFact {
  const styleRules = extractCssStyleRules(content);
  return {
    specifier: input.specifier,
    resolvedPath: input.resolvedPath,
    content,
    styleRules,
    classDefinitions: extractClassDefinitions(styleRules),
    imports: extractCssImports(content),
  };
}

function extractClassDefinitions(
  styleRules: CssFileFact["styleRules"],
): CssFileFact["classDefinitions"] {
  const definitions = new Map<string, CssFileFact["classDefinitions"][number]>();

  for (const styleRule of styleRules) {
    const declarations = extractDeclarationNames(styleRule.declarations);

    for (const selectorBranch of styleRule.selectorBranches) {
      for (const className of selectorBranch.subjectClassNames) {
        const definitionKey = `${selectorBranch.raw}::${className}::${serializeAtRuleContext(styleRule.atRuleContext)}`;
        if (!definitions.has(definitionKey)) {
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

function extractDeclarationNames(blockBody: Array<{ property: string }>): string[] {
  const declarationNames = new Set<string>();
  for (const declaration of blockBody) {
    declarationNames.add(declaration.property);
  }

  return [...declarationNames].sort((left, right) => left.localeCompare(right));
}

function extractCssImports(content: string): CssImportFact[] {
  const imports: CssImportFact[] = [];
  let match: RegExpExecArray | null;

  CSS_IMPORT_PATTERN.lastIndex = 0;

  while ((match = CSS_IMPORT_PATTERN.exec(content)) !== null) {
    const specifier = match[1];
    imports.push({
      specifier,
      isExternal: !specifier.startsWith(".") && !specifier.startsWith("/"),
    });
  }

  return imports;
}

function serializeAtRuleContext(atRuleContext: Array<{ name: string; params: string }>): string {
  return atRuleContext.map((entry) => `${entry.name}:${entry.params}`).join("|");
}
