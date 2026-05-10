import * as csstree from "css-tree";

import type { CssDeclarationPropertyEffect } from "../../types/css.js";

const BOX_SIDES = ["top", "right", "bottom", "left"] as const;
const BORDER_PARTS = ["width", "style", "color"] as const;
const BORDER_STYLES = new Set([
  "none",
  "hidden",
  "dotted",
  "dashed",
  "solid",
  "double",
  "groove",
  "ridge",
  "inset",
  "outset",
]);
const BORDER_WIDTH_KEYWORDS = new Set(["thin", "medium", "thick"]);
const UNSUPPORTED_SHORTHANDS = new Set([
  "all",
  "animation",
  "border-radius",
  "columns",
  "container",
  "flex",
  "font",
  "grid",
  "list-style",
  "outline",
  "place-content",
  "place-items",
  "place-self",
  "text-decoration",
  "transition",
]);

type CssTreeValueNode = {
  type: string;
  name?: string;
  value?: string;
  unit?: string;
  children?: CssTreeValueNode[];
};

type CssTreeValueAst = {
  type: "Value";
  children?: CssTreeValueNode[];
};

type ParsedBackgroundLayer = {
  attachment?: string;
  clip?: string;
  color?: string;
  image?: string;
  origin?: string;
  position?: string;
  repeat?: string;
  size?: string;
};

export function getCssDeclarationPropertyEffects(input: {
  property: string;
  value: string;
}): CssDeclarationPropertyEffect[] {
  const normalizedProperty = input.property.trim().toLowerCase();
  if (normalizedProperty === "margin" || normalizedProperty === "padding") {
    return expandFourSidedShorthand({
      propertyPrefix: normalizedProperty,
      value: input.value,
      unsupportedProperty: normalizedProperty,
    });
  }

  if (
    normalizedProperty === "margin-block" ||
    normalizedProperty === "margin-inline" ||
    normalizedProperty === "padding-block" ||
    normalizedProperty === "padding-inline" ||
    normalizedProperty === "inset-block" ||
    normalizedProperty === "inset-inline"
  ) {
    return expandTwoSidedLogicalShorthand({
      propertyPrefix: normalizedProperty,
      value: input.value,
      unsupportedProperty: normalizedProperty,
    });
  }

  if (normalizedProperty === "inset") {
    return expandFourSidedShorthand({
      propertyPrefix: normalizedProperty,
      value: input.value,
      unsupportedProperty: normalizedProperty,
      physicalProperties: ["top", "right", "bottom", "left"],
    });
  }

  if (normalizedProperty === "background") {
    return expandBackgroundShorthandWithCssTree({
      value: input.value,
      unsupportedProperty: normalizedProperty,
    });
  }

  if (BORDER_PARTS.some((part) => normalizedProperty === `border-${part}`)) {
    return expandFourSidedShorthand({
      propertyPrefix: "border",
      propertySuffix: normalizedProperty.replace("border-", ""),
      value: input.value,
      unsupportedProperty: normalizedProperty,
    });
  }

  if (normalizedProperty === "border") {
    return expandBorderBoxShorthand({
      value: input.value,
      unsupportedProperty: normalizedProperty,
      sides: BOX_SIDES,
    });
  }

  if (BOX_SIDES.some((side) => normalizedProperty === `border-${side}`)) {
    const side = BOX_SIDES.find((candidate) => normalizedProperty === `border-${candidate}`);
    return expandBorderBoxShorthand({
      value: input.value,
      unsupportedProperty: normalizedProperty,
      sides: side ? [side] : [],
    });
  }

  if (normalizedProperty === "border-block" || normalizedProperty === "border-inline") {
    return expandBorderLogicalShorthand({
      value: input.value,
      unsupportedProperty: normalizedProperty,
    });
  }

  if (
    BORDER_PARTS.some(
      (part) =>
        normalizedProperty === `border-block-${part}` ||
        normalizedProperty === `border-inline-${part}`,
    )
  ) {
    const [axis, part] = normalizedProperty.replace("border-", "").split("-");
    return expandBorderLogicalPartShorthand({
      propertyAxis: axis ?? "",
      propertyPart: part ?? "",
      value: input.value,
      unsupportedProperty: normalizedProperty,
    });
  }

  if (UNSUPPORTED_SHORTHANDS.has(normalizedProperty)) {
    return [
      {
        property: normalizedProperty,
        value: input.value,
        source: "exact",
        supported: false,
        reason: `The "${normalizedProperty}" shorthand is not expanded by cascade analysis yet.`,
      },
    ];
  }

  return [
    {
      property: normalizedProperty,
      value: input.value,
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
  physicalProperties?: readonly string[];
}): CssDeclarationPropertyEffect[] {
  const tokens = splitCssValueTokens(input.value);
  if (tokens.length < 1 || tokens.length > 4) {
    return unsupportedShorthandEffect(
      input.unsupportedProperty,
      input.value,
      "value could not be safely expanded",
    );
  }

  const [top, right = top, bottom = top, left = right] = tokens;
  const valuesBySide = { top, right, bottom, left };
  return BOX_SIDES.map((side, index) => ({
    property: input.physicalProperties
      ? input.physicalProperties[index]
      : input.propertySuffix
        ? `${input.propertyPrefix}-${side}-${input.propertySuffix}`
        : `${input.propertyPrefix}-${side}`,
    value: valuesBySide[side],
    source: "shorthand",
    supported: true,
  }));
}

function expandTwoSidedLogicalShorthand(input: {
  propertyPrefix: string;
  value: string;
  unsupportedProperty: string;
}): CssDeclarationPropertyEffect[] {
  const tokens = splitCssValueTokens(input.value);
  if (tokens.length < 1 || tokens.length > 2) {
    return unsupportedShorthandEffect(
      input.unsupportedProperty,
      input.value,
      "value could not be safely expanded",
    );
  }

  const [start, end = start] = tokens;
  return [
    {
      property: `${input.propertyPrefix}-start`,
      value: start,
      source: "shorthand",
      supported: true,
    },
    {
      property: `${input.propertyPrefix}-end`,
      value: end,
      source: "shorthand",
      supported: true,
    },
  ];
}

function expandBorderLogicalShorthand(input: {
  value: string;
  unsupportedProperty: string;
}): CssDeclarationPropertyEffect[] {
  const parsed = parseBorderShorthandValue(input.value);
  if (!parsed) {
    return unsupportedShorthandEffect(
      input.unsupportedProperty,
      input.value,
      "value could not be safely parsed into border width, style, and color",
    );
  }

  return ["start", "end"].flatMap((side) =>
    BORDER_PARTS.map((part) => ({
      property: `${input.unsupportedProperty}-${side}-${part}`,
      value: parsed[part],
      source: "shorthand" as const,
      supported: true,
    })),
  );
}

function expandBorderLogicalPartShorthand(input: {
  propertyAxis: string;
  propertyPart: string;
  value: string;
  unsupportedProperty: string;
}): CssDeclarationPropertyEffect[] {
  if (
    (input.propertyAxis !== "block" && input.propertyAxis !== "inline") ||
    !BORDER_PARTS.some((part) => part === input.propertyPart)
  ) {
    return unsupportedShorthandEffect(
      input.unsupportedProperty,
      input.value,
      "value could not be safely expanded",
    );
  }

  const tokens = splitCssValueTokens(input.value);
  if (tokens.length < 1 || tokens.length > 2) {
    return unsupportedShorthandEffect(
      input.unsupportedProperty,
      input.value,
      "value could not be safely expanded",
    );
  }

  const [start, end = start] = tokens;
  return [
    {
      property: `border-${input.propertyAxis}-start-${input.propertyPart}`,
      value: start,
      source: "shorthand",
      supported: true,
    },
    {
      property: `border-${input.propertyAxis}-end-${input.propertyPart}`,
      value: end,
      source: "shorthand",
      supported: true,
    },
  ];
}

function expandBorderBoxShorthand(input: {
  value: string;
  unsupportedProperty: string;
  sides: readonly (typeof BOX_SIDES)[number][];
}): CssDeclarationPropertyEffect[] {
  const parsed = parseBorderShorthandValue(input.value);
  if (!parsed || input.sides.length === 0) {
    return unsupportedShorthandEffect(
      input.unsupportedProperty,
      input.value,
      "value could not be safely parsed into border width, style, and color",
    );
  }

  return input.sides.flatMap((side) =>
    BORDER_PARTS.map((part) => ({
      property: `border-${side}-${part}`,
      value: parsed[part],
      source: "shorthand" as const,
      supported: true,
    })),
  );
}

function parseBorderShorthandValue(
  value: string,
): { width: string; style: string; color: string } | undefined {
  const tokens = splitCssValueTokens(value);
  if (tokens.length < 1 || tokens.length > 3) {
    return undefined;
  }

  let width: string | undefined;
  let style: string | undefined;
  let color: string | undefined;
  for (const token of tokens) {
    const normalizedToken = token.toLowerCase();
    if (!width && isBorderWidthToken(normalizedToken)) {
      width = token;
      continue;
    }
    if (!style && BORDER_STYLES.has(normalizedToken)) {
      style = token;
      continue;
    }
    if (!color && isCssColorToken(token, { allowVariable: tokens.length > 1 })) {
      color = token;
      continue;
    }
    return undefined;
  }

  return {
    width: width ?? "medium",
    style: style ?? "none",
    color: color ?? "currentcolor",
  };
}

function expandBackgroundShorthandWithCssTree(input: {
  value: string;
  unsupportedProperty: string;
}): CssDeclarationPropertyEffect[] {
  const ast = parseCssValue(input.value);
  if (!ast || !matchesCssProperty("background", ast)) {
    return unsupportedShorthandEffect(
      input.unsupportedProperty,
      input.value,
      "value could not be safely parsed",
    );
  }

  const children = ast.children ?? [];
  if (children.length === 1 && isCssWideKeyword(nodeName(children[0]))) {
    const value = generateCssValue(children);
    return backgroundEffects({
      color: value,
      images: [value],
      repeats: [value],
      attachments: [value],
      positions: [value],
      sizes: [value],
      origins: [value],
      clips: [value],
    });
  }

  const layerNodes = splitTopLevelCssValueLayers(children);
  if (layerNodes.length === 0) {
    return unsupportedShorthandEffect(
      input.unsupportedProperty,
      input.value,
      "value could not be safely parsed",
    );
  }

  const layers: ParsedBackgroundLayer[] = [];
  for (const [index, layer] of layerNodes.entries()) {
    const parsed = parseBackgroundLayerWithCssTree({
      nodes: layer,
      allowColor: index === layerNodes.length - 1,
    });
    if (!parsed) {
      return unsupportedShorthandEffect(
        input.unsupportedProperty,
        input.value,
        "value could not be safely parsed",
      );
    }
    layers.push(parsed);
  }

  return backgroundEffects({
    color: layers.at(-1)?.color ?? "transparent",
    images: layers.map((layer) => layer.image ?? "none"),
    repeats: layers.map((layer) => layer.repeat ?? "repeat"),
    attachments: layers.map((layer) => layer.attachment ?? "scroll"),
    positions: layers.map((layer) => layer.position ?? "0% 0%"),
    sizes: layers.map((layer) => layer.size ?? "auto auto"),
    origins: layers.map((layer) => layer.origin ?? "padding-box"),
    clips: layers.map((layer) => layer.clip ?? "border-box"),
  });
}

function parseBackgroundLayerWithCssTree(input: {
  nodes: CssTreeValueNode[];
  allowColor: boolean;
}): ParsedBackgroundLayer | undefined {
  const parsed: ParsedBackgroundLayer = {};
  const positionNodes: CssTreeValueNode[] = [];
  const sizeNodes: CssTreeValueNode[] = [];
  const boxValues: string[] = [];
  let index = 0;
  let afterSlash = false;

  while (index < input.nodes.length) {
    const node = input.nodes[index];
    if (isCssValueOperator(node, "/")) {
      if (afterSlash) {
        return undefined;
      }
      afterSlash = true;
      index += 1;
      continue;
    }

    const twoNodeRepeat = input.nodes[index + 1]
      ? generateCssValue([node, input.nodes[index + 1]])
      : undefined;
    if (
      !parsed.repeat &&
      twoNodeRepeat &&
      !isCssValueOperator(input.nodes[index + 1], "/") &&
      matchesCssType("repeat-style", [node, input.nodes[index + 1]])
    ) {
      parsed.repeat = twoNodeRepeat;
      index += 2;
      continue;
    }

    if (!parsed.repeat && matchesCssType("repeat-style", [node])) {
      parsed.repeat = generateCssValue([node]);
      index += 1;
      continue;
    }
    if (!parsed.image && matchesCssType("bg-image", [node])) {
      parsed.image = generateCssValue([node]);
      index += 1;
      continue;
    }
    if (!parsed.attachment && matchesCssType("attachment", [node])) {
      parsed.attachment = generateCssValue([node]);
      index += 1;
      continue;
    }
    if (!parsed.color && input.allowColor && matchesCssType("color", [node])) {
      parsed.color = generateCssValue([node]);
      index += 1;
      continue;
    }
    if (matchesCssType("visual-box", [node])) {
      boxValues.push(generateCssValue([node]));
      if (boxValues.length > 2) {
        return undefined;
      }
      index += 1;
      continue;
    }

    if (afterSlash) {
      sizeNodes.push(node);
    } else {
      positionNodes.push(node);
    }
    index += 1;
  }

  if (positionNodes.length > 0) {
    if (!matchesCssType("position", positionNodes)) {
      return undefined;
    }
    parsed.position = generateCssValue(positionNodes);
  }
  if (sizeNodes.length > 0) {
    if (!matchesCssType("bg-size", sizeNodes)) {
      return undefined;
    }
    parsed.size = generateCssValue(sizeNodes);
  }
  if (boxValues.length === 1) {
    parsed.origin = boxValues[0];
    parsed.clip = boxValues[0];
  } else if (boxValues.length === 2) {
    parsed.origin = boxValues[0];
    parsed.clip = boxValues[1];
  }

  return parsed;
}

function backgroundEffects(input: {
  color: string;
  images: string[];
  repeats: string[];
  attachments: string[];
  positions: string[];
  sizes: string[];
  origins: string[];
  clips: string[];
}): CssDeclarationPropertyEffect[] {
  return [
    {
      property: "background-color",
      value: input.color,
      source: "shorthand",
      supported: true,
    },
    {
      property: "background-image",
      value: input.images.join(", "),
      source: "shorthand",
      supported: true,
    },
    {
      property: "background-repeat",
      value: input.repeats.join(", "),
      source: "shorthand",
      supported: true,
    },
    {
      property: "background-attachment",
      value: input.attachments.join(", "),
      source: "shorthand",
      supported: true,
    },
    {
      property: "background-position",
      value: input.positions.join(", "),
      source: "shorthand",
      supported: true,
    },
    {
      property: "background-size",
      value: input.sizes.join(", "),
      source: "shorthand",
      supported: true,
    },
    {
      property: "background-origin",
      value: input.origins.join(", "),
      source: "shorthand",
      supported: true,
    },
    {
      property: "background-clip",
      value: input.clips.join(", "),
      source: "shorthand",
      supported: true,
    },
  ];
}

function parseCssValue(value: string): CssTreeValueAst | undefined {
  try {
    return csstree.toPlainObject(
      csstree.parse(value, {
        context: "value",
      }),
    ) as CssTreeValueAst;
  } catch {
    return undefined;
  }
}

function matchesCssProperty(property: string, ast: CssTreeValueAst): boolean {
  return (
    csstree.lexer.matchProperty(property, cssTreeValueFromNodes(ast.children ?? [])).error === null
  );
}

function matchesCssType(type: string, nodes: CssTreeValueNode[]): boolean {
  return csstree.lexer.matchType(type, cssTreeValueFromNodes(nodes)).error === null;
}

function generateCssValue(nodes: CssTreeValueNode[]): string {
  return csstree.generate(cssTreeValueFromNodes(nodes));
}

function cssTreeValueFromNodes(nodes: CssTreeValueNode[]): csstree.CssNode {
  return csstree.fromPlainObject({
    type: "Value",
    loc: null,
    children: nodes,
  } as never);
}

function splitTopLevelCssValueLayers(nodes: CssTreeValueNode[]): CssTreeValueNode[][] {
  const layers: CssTreeValueNode[][] = [];
  let current: CssTreeValueNode[] = [];
  for (const node of nodes) {
    if (isCssValueOperator(node, ",")) {
      if (current.length > 0) {
        layers.push(current);
      }
      current = [];
      continue;
    }
    current.push(node);
  }
  if (current.length > 0) {
    layers.push(current);
  }
  return layers;
}

function nodeName(node: CssTreeValueNode): string {
  if (node.type === "Identifier") {
    return (node.name ?? "").toLowerCase();
  }
  return "";
}

function isCssValueOperator(node: CssTreeValueNode, value: string): boolean {
  return node.type === "Operator" && node.value === value;
}

function isBorderWidthToken(token: string): boolean {
  return (
    BORDER_WIDTH_KEYWORDS.has(token) ||
    token === "0" ||
    /^-?(?:\d+|\d*\.\d+)(?:px|em|rem|ch|ex|lh|rlh|vw|vh|vi|vb|vmin|vmax|cm|mm|q|in|pt|pc|%)$/u.test(
      token,
    ) ||
    /^calc\(.+\)$/u.test(token)
  );
}

function isCssColorToken(token: string, options: { allowVariable: boolean }): boolean {
  const ast = parseCssValue(token);
  if (ast && matchesCssType("color", ast.children ?? [])) {
    return true;
  }
  return options.allowVariable && /^var\(.+\)$/iu.test(token);
}

function isCssWideKeyword(token: string): boolean {
  return (
    token === "inherit" ||
    token === "initial" ||
    token === "revert" ||
    token === "revert-layer" ||
    token === "unset"
  );
}

function unsupportedShorthandEffect(
  property: string,
  value: string,
  reason: string,
): CssDeclarationPropertyEffect[] {
  return [
    {
      property,
      value,
      source: "exact",
      supported: false,
      reason: `The "${property}" shorthand ${reason}.`,
    },
  ];
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
