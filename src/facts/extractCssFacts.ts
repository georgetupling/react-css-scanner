import { readFile } from "node:fs/promises";
import type { DiscoveredProjectFile } from "../files/types.js";
import type { CssFileFact, CssImportFact, ExternalCssFact } from "./types.js";

const CSS_CLASS_NAME_PATTERN = /\.([_a-zA-Z]+[\w-]*)/g;
const CSS_IMPORT_PATTERN = /@import\s+(?:url\()?["']([^"']+)["']\)?/g;

export async function extractCssFileFacts(cssFile: DiscoveredProjectFile): Promise<CssFileFact> {
  const content = await readFile(cssFile.absolutePath, "utf8");

  return {
    filePath: cssFile.relativePath,
    classDefinitions: extractClassDefinitions(content),
    imports: extractCssImports(content),
  };
}

export async function extractExternalCssFacts(input: {
  specifier: string;
  resolvedPath: string;
}): Promise<ExternalCssFact> {
  const content = await readFile(input.resolvedPath, "utf8");

  return {
    specifier: input.specifier,
    resolvedPath: input.resolvedPath,
    classDefinitions: extractClassDefinitions(content),
    imports: extractCssImports(content),
  };
}

function extractClassDefinitions(content: string): CssFileFact["classDefinitions"] {
  const definitions = new Map<
    string,
    { className: string; selector: string; declarations: string[] }
  >();
  const blockPattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = blockPattern.exec(content)) !== null) {
    const selectorText = match[1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("@import"))
      .join(" ")
      .trim();

    if (!selectorText || selectorText.startsWith("@")) {
      continue;
    }

    const declarations = extractDeclarationNames(match[2]);
    let classMatch: RegExpExecArray | null;
    CSS_CLASS_NAME_PATTERN.lastIndex = 0;

    while ((classMatch = CSS_CLASS_NAME_PATTERN.exec(selectorText)) !== null) {
      const className = classMatch[1];

      if (!definitions.has(`${selectorText}::${className}`)) {
        definitions.set(`${selectorText}::${className}`, {
          className,
          selector: selectorText,
          declarations,
        });
      }
    }
  }

  return [...definitions.values()].sort((left, right) => {
    if (left.className === right.className) {
      return left.selector.localeCompare(right.selector);
    }

    return left.className.localeCompare(right.className);
  });
}

function extractDeclarationNames(blockBody: string): string[] {
  const declarationNames = new Set<string>();
  const declarationPattern = /([a-zA-Z-]+)\s*:/g;
  let match: RegExpExecArray | null;

  while ((match = declarationPattern.exec(blockBody)) !== null) {
    declarationNames.add(match[1]);
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
