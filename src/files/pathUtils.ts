import path from "node:path";

export const SOURCE_FILE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
export const CSS_FILE_EXTENSIONS = new Set([".css"]);

export function normalizePathForMatch(value: string): string {
  return value.split(path.sep).join("/");
}

export function isSourceFilePath(filePath: string): boolean {
  return SOURCE_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function isCssFilePath(filePath: string): boolean {
  return CSS_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function globToRegExp(globPattern: string): RegExp {
  const normalizedPattern = normalizePathForMatch(globPattern);
  let pattern = "^";

  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const char = normalizedPattern[index];
    const nextChar = normalizedPattern[index + 1];
    const nextNextChar = normalizedPattern[index + 2];

    if (char === "*") {
      if (nextChar === "*") {
        if (nextNextChar === "/") {
          pattern += "(?:.*/)?";
          index += 2;
        } else {
          pattern += ".*";
          index += 1;
        }
      } else {
        pattern += "[^/]*";
      }
      continue;
    }

    if (char === "?") {
      pattern += ".";
      continue;
    }

    if ("/.+^${}()|[]\\".includes(char)) {
      pattern += `\\${char}`;
      continue;
    }

    pattern += char;
  }

  pattern += "$";
  return new RegExp(pattern);
}

export function matchesAnyGlob(value: string, patterns: readonly string[]): boolean {
  const normalizedValue = normalizePathForMatch(value);
  return patterns.some((pattern) => globToRegExp(pattern).test(normalizedValue));
}
