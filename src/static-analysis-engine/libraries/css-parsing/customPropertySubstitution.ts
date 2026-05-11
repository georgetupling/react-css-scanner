export type CssCustomPropertyLookupResult =
  | {
      status: "resolved";
      value: string;
    }
  | {
      status: "missing";
    }
  | {
      status: "unresolved";
      reason: string;
    };

export type CssCustomPropertySubstitutionResult =
  | {
      status: "resolved";
      value: string;
    }
  | {
      status: "unresolved";
      reason: string;
    };

export function substituteCssCustomProperties(input: {
  value: string;
  resolveCustomProperty: (name: string) => CssCustomPropertyLookupResult;
}): CssCustomPropertySubstitutionResult {
  return substituteCssCustomPropertiesInValue(input.value, input.resolveCustomProperty);
}

function substituteCssCustomPropertiesInValue(
  value: string,
  resolveCustomProperty: (name: string) => CssCustomPropertyLookupResult,
): CssCustomPropertySubstitutionResult {
  let output = "";
  let index = 0;

  while (index < value.length) {
    const nextVar = findNextVarFunction(value, index);
    if (!nextVar) {
      output += value.slice(index);
      break;
    }

    output += value.slice(index, nextVar.start);
    const parsed = parseVarFunction(value, nextVar.start);
    if (!parsed) {
      return {
        status: "unresolved",
        reason: "var() function could not be parsed",
      };
    }

    const customPropertyName = parsed.name.trim();
    if (!/^--[A-Za-z0-9_-]+$/u.test(customPropertyName)) {
      return {
        status: "unresolved",
        reason: `var() references unsupported custom property name "${customPropertyName}"`,
      };
    }

    const resolved = resolveCustomProperty(customPropertyName);
    if (resolved.status === "resolved") {
      output += resolved.value;
      index = parsed.end;
      continue;
    }
    if (resolved.status === "unresolved") {
      return resolved;
    }
    if (parsed.fallback === undefined) {
      return {
        status: "unresolved",
        reason: `custom property ${customPropertyName} has no known cascade winner or fallback`,
      };
    }

    const fallback = substituteCssCustomPropertiesInValue(parsed.fallback, resolveCustomProperty);
    if (fallback.status === "unresolved") {
      return fallback;
    }
    output += fallback.value;
    index = parsed.end;
  }

  if (output === value) {
    return {
      status: "resolved",
      value,
    };
  }
  return substituteCssCustomPropertiesInValue(output, resolveCustomProperty);
}

function findNextVarFunction(value: string, startIndex: number): { start: number } | undefined {
  let index = startIndex;
  let quote: string | undefined;
  let escaped = false;

  while (index < value.length) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      index += 1;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = undefined;
      }
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      index += 1;
      continue;
    }
    if (
      value.slice(index, index + 3).toLowerCase() === "var" &&
      !isCssIdentifierCharacter(value[index - 1]) &&
      !isCssIdentifierCharacter(value[index + 3])
    ) {
      let openIndex = index + 3;
      while (/\s/u.test(value[openIndex] ?? "")) {
        openIndex += 1;
      }
      if (value[openIndex] === "(") {
        return { start: index };
      }
    }
    index += 1;
  }

  return undefined;
}

function parseVarFunction(
  value: string,
  startIndex: number,
): { name: string; fallback?: string; end: number } | undefined {
  let openIndex = startIndex + 3;
  while (/\s/u.test(value[openIndex] ?? "")) {
    openIndex += 1;
  }
  if (value[openIndex] !== "(") {
    return undefined;
  }

  const closeIndex = findBalancedClose(value, openIndex);
  if (closeIndex === undefined) {
    return undefined;
  }

  const body = value.slice(openIndex + 1, closeIndex);
  const commaIndex = findTopLevelComma(body);
  if (commaIndex === undefined) {
    return {
      name: body,
      end: closeIndex + 1,
    };
  }

  return {
    name: body.slice(0, commaIndex),
    fallback: body.slice(commaIndex + 1).trim(),
    end: closeIndex + 1,
  };
}

function findBalancedClose(value: string, openIndex: number): number | undefined {
  let depth = 0;
  let index = openIndex;
  let quote: string | undefined;
  let escaped = false;

  while (index < value.length) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      index += 1;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = undefined;
      }
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      index += 1;
      continue;
    }
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
    index += 1;
  }

  return undefined;
}

function findTopLevelComma(value: string): number | undefined {
  let depth = 0;
  let quote: string | undefined;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") {
      depth += 1;
      continue;
    }
    if (character === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (character === "," && depth === 0) {
      return index;
    }
  }

  return undefined;
}

function isCssIdentifierCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_-]/u.test(character);
}
