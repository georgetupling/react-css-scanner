export function readCssIdentifier(
  value: string,
  startIndex: number,
): { value: string; nextIndex: number } | undefined {
  let index = startIndex;
  let identifier = "";

  while (index < value.length) {
    const character = value[index];
    if (character === "\\") {
      const escapedValue = readEscape(value, index);
      identifier += escapedValue.value;
      index = escapedValue.nextIndex;
      continue;
    }

    if (!isIdentifierCharacter(character)) {
      break;
    }

    identifier += character;
    index += 1;
  }

  if (!identifier) {
    return undefined;
  }

  return {
    value: identifier,
    nextIndex: index,
  };
}

export function skipTypeOrNamespaceToken(value: string, startIndex: number): number {
  let index = startIndex;
  while (index < value.length) {
    const character = value[index];
    if (character === "|" || isIdentifierCharacter(character) || character === "\\") {
      if (character === "\\") {
        index = skipEscape(value, index);
        continue;
      }

      index += 1;
      continue;
    }

    break;
  }

  return index === startIndex ? startIndex + 1 : index;
}

export function skipBalancedSection(
  value: string,
  startIndex: number,
  openCharacter: "[" | "(",
  closeCharacter: "]" | ")",
): number {
  let index = startIndex + 1;
  let depth = 1;
  let stringQuote: string | undefined;
  let escaped = false;

  while (index < value.length) {
    const character = value[index];

    if (escaped) {
      escaped = false;
      index += 1;
      continue;
    }

    if (stringQuote) {
      if (character === "\\") {
        escaped = true;
      } else if (character === stringQuote) {
        stringQuote = undefined;
      }
      index += 1;
      continue;
    }

    if (character === '"' || character === "'") {
      stringQuote = character;
      index += 1;
      continue;
    }

    if (character === openCharacter) {
      depth += 1;
      index += 1;
      continue;
    }

    if (character === closeCharacter) {
      depth -= 1;
      index += 1;
      if (depth === 0) {
        return index;
      }
      continue;
    }

    index += 1;
  }

  return value.length;
}

export function readParenthesizedContent(
  value: string,
  openParenIndex: number,
): { content: string; nextIndex: number } {
  let index = openParenIndex + 1;
  let depth = 1;
  let stringQuote: string | undefined;
  let escaped = false;

  while (index < value.length) {
    const character = value[index];

    if (escaped) {
      escaped = false;
      index += 1;
      continue;
    }

    if (stringQuote) {
      if (character === "\\") {
        escaped = true;
      } else if (character === stringQuote) {
        stringQuote = undefined;
      }
      index += 1;
      continue;
    }

    if (character === '"' || character === "'") {
      stringQuote = character;
      index += 1;
      continue;
    }

    if (character === "(") {
      depth += 1;
      index += 1;
      continue;
    }

    if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        return {
          content: value.slice(openParenIndex + 1, index),
          nextIndex: index + 1,
        };
      }
      index += 1;
      continue;
    }

    index += 1;
  }

  return {
    content: value.slice(openParenIndex + 1),
    nextIndex: value.length,
  };
}

function readEscape(value: string, startIndex: number): { value: string; nextIndex: number } {
  const nextCharacter = value[startIndex + 1];
  if (!nextCharacter) {
    return { value: "", nextIndex: startIndex + 1 };
  }

  if (isHexCharacter(nextCharacter)) {
    let index = startIndex + 1;
    let hexValue = "";
    while (index < value.length && hexValue.length < 6 && isHexCharacter(value[index])) {
      hexValue += value[index];
      index += 1;
    }

    if (/\s/.test(value[index] ?? "")) {
      index += 1;
    }

    const codePoint = Number.parseInt(hexValue, 16);
    return {
      value: Number.isNaN(codePoint) ? "" : String.fromCodePoint(codePoint),
      nextIndex: index,
    };
  }

  return {
    value: nextCharacter,
    nextIndex: startIndex + 2,
  };
}

function skipEscape(value: string, startIndex: number): number {
  return readEscape(value, startIndex).nextIndex;
}

function isIdentifierCharacter(character: string): boolean {
  return /[_a-zA-Z0-9-]/.test(character);
}

function isHexCharacter(character: string): boolean {
  return /[0-9a-fA-F]/.test(character);
}
