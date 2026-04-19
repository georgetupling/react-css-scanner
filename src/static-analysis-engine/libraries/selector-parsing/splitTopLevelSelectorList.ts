export function splitTopLevelSelectorList(value: string): string[] {
  const selectors: string[] = [];
  let start = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let stringQuote: string | undefined;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
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

    if (character === "[") {
      bracketDepth += 1;
      continue;
    }

    if (character === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (character === "(") {
      parenDepth += 1;
      continue;
    }

    if (character === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }

    if (character === "," && bracketDepth === 0 && parenDepth === 0) {
      selectors.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }

  selectors.push(value.slice(start).trim());
  return selectors.filter((selector) => selector.length > 0);
}
