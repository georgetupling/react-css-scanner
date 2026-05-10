export type CssPropertyEffect = {
  property: string;
  value: string;
  source: "exact" | "shorthand";
  supported: boolean;
  reason?: string;
};

const BOX_SIDES = ["top", "right", "bottom", "left"] as const;
const BORDER_PARTS = ["width", "style", "color"] as const;
const UNSUPPORTED_SHORTHANDS = new Set([
  "all",
  "animation",
  "background",
  "border",
  "border-block",
  "border-inline",
  "border-radius",
  "columns",
  "container",
  "flex",
  "font",
  "grid",
  "inset",
  "list-style",
  "outline",
  "place-content",
  "place-items",
  "place-self",
  "text-decoration",
  "transition",
]);

export function getCssPropertyEffects(property: string, value: string): CssPropertyEffect[] {
  const normalizedProperty = property.trim().toLowerCase();
  if (normalizedProperty === "margin" || normalizedProperty === "padding") {
    return expandFourSidedShorthand({
      propertyPrefix: normalizedProperty,
      value,
      unsupportedProperty: normalizedProperty,
    });
  }

  if (BORDER_PARTS.some((part) => normalizedProperty === `border-${part}`)) {
    return expandFourSidedShorthand({
      propertyPrefix: "border",
      propertySuffix: normalizedProperty.replace("border-", ""),
      value,
      unsupportedProperty: normalizedProperty,
    });
  }

  if (UNSUPPORTED_SHORTHANDS.has(normalizedProperty)) {
    return [
      {
        property: normalizedProperty,
        value,
        source: "exact",
        supported: false,
        reason: `The "${normalizedProperty}" shorthand is not expanded by cascade analysis yet.`,
      },
    ];
  }

  return [
    {
      property: normalizedProperty,
      value,
      source: "exact",
      supported: true,
    },
  ];
}

function expandFourSidedShorthand(input: {
  propertyPrefix: string;
  propertySuffix?: string;
  value: string;
  unsupportedProperty: string;
}): CssPropertyEffect[] {
  const tokens = splitCssValueTokens(input.value);
  if (tokens.length < 1 || tokens.length > 4) {
    return [
      {
        property: input.unsupportedProperty,
        value: input.value,
        source: "exact",
        supported: false,
        reason: `The "${input.unsupportedProperty}" shorthand value could not be safely expanded.`,
      },
    ];
  }

  const [top, right = top, bottom = top, left = right] = tokens;
  const valuesBySide = { top, right, bottom, left };
  return BOX_SIDES.map((side) => ({
    property: input.propertySuffix
      ? `${input.propertyPrefix}-${side}-${input.propertySuffix}`
      : `${input.propertyPrefix}-${side}`,
    value: valuesBySide[side],
    source: "shorthand",
    supported: true,
  }));
}

function splitCssValueTokens(value: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let depth = 0;
  let quote: string | undefined;
  let escaped = false;

  for (const character of value.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (character === "\\") {
      current += character;
      escaped = true;
      continue;
    }

    if (quote) {
      current += character;
      if (character === quote) {
        quote = undefined;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      current += character;
      quote = character;
      continue;
    }

    if (character === "(" || character === "[") {
      current += character;
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]") {
      current += character;
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (/\s/.test(character) && depth === 0) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}
