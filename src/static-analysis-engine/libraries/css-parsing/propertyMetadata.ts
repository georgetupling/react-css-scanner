const BOX_SIDES = ["top", "right", "bottom", "left"] as const;
const LOGICAL_SIDES = ["start", "end"] as const;
const BORDER_PARTS = ["width", "style", "color"] as const;

export type CssLonghandPropertyMetadata = {
  property: string;
  inherited: boolean;
  initialValue: string;
  logicalGroup?: string;
  physicalFallbacks?: string[];
};

export type CssShorthandPropertyMetadata = {
  property: string;
  longhands: string[];
  resetSupported: boolean;
};

const LONGHAND_METADATA = new Map<string, CssLonghandPropertyMetadata>(
  [
    longhand("color", true, "canvastext"),
    longhand("background-color", false, "transparent"),
    longhand("background-image", false, "none"),
    longhand("background-repeat", false, "repeat"),
    longhand("background-attachment", false, "scroll"),
    longhand("background-position", false, "0% 0%"),
    longhand("background-size", false, "auto auto"),
    longhand("background-origin", false, "padding-box"),
    longhand("background-clip", false, "border-box"),
    ...physicalBoxLonghands("margin").map((property) => longhand(property, false, "0")),
    ...physicalBoxLonghands("padding").map((property) => longhand(property, false, "0")),
    ...logicalAxisLonghands("margin-block", "margin-block").map((property) =>
      longhand(property, false, "0", {
        logicalGroup: "margin-block",
        physicalFallbacks: property.endsWith("-start") ? ["margin-top"] : ["margin-bottom"],
      }),
    ),
    ...logicalAxisLonghands("margin-inline", "margin-inline").map((property) =>
      longhand(property, false, "0", {
        logicalGroup: "margin-inline",
        physicalFallbacks: property.endsWith("-start") ? ["margin-left"] : ["margin-right"],
      }),
    ),
    ...logicalAxisLonghands("padding-block", "padding-block").map((property) =>
      longhand(property, false, "0", {
        logicalGroup: "padding-block",
        physicalFallbacks: property.endsWith("-start") ? ["padding-top"] : ["padding-bottom"],
      }),
    ),
    ...logicalAxisLonghands("padding-inline", "padding-inline").map((property) =>
      longhand(property, false, "0", {
        logicalGroup: "padding-inline",
        physicalFallbacks: property.endsWith("-start") ? ["padding-left"] : ["padding-right"],
      }),
    ),
    ...["top", "right", "bottom", "left"].map((property) => longhand(property, false, "auto")),
    ...logicalAxisLonghands("inset-block", "inset-block").map((property) =>
      longhand(property, false, "auto", {
        logicalGroup: "inset-block",
        physicalFallbacks: property.endsWith("-start") ? ["top"] : ["bottom"],
      }),
    ),
    ...logicalAxisLonghands("inset-inline", "inset-inline").map((property) =>
      longhand(property, false, "auto", {
        logicalGroup: "inset-inline",
        physicalFallbacks: property.endsWith("-start") ? ["left"] : ["right"],
      }),
    ),
    ...BOX_SIDES.flatMap((side) => [
      longhand(`border-${side}-width`, false, "medium"),
      longhand(`border-${side}-style`, false, "none"),
      longhand(`border-${side}-color`, false, "currentcolor"),
    ]),
    ...["block", "inline"].flatMap((axis) =>
      LOGICAL_SIDES.flatMap((side) =>
        BORDER_PARTS.map((part) =>
          longhand(`border-${axis}-${side}-${part}`, false, borderInitialValue(part), {
            logicalGroup: `border-${axis}`,
            physicalFallbacks: logicalBorderPhysicalFallbacks(axis, side, part),
          }),
        ),
      ),
    ),
    longhand("border-top-left-radius", false, "0"),
    longhand("border-top-right-radius", false, "0"),
    longhand("border-bottom-right-radius", false, "0"),
    longhand("border-bottom-left-radius", false, "0"),
    longhand("outline-color", false, "invert"),
    longhand("outline-style", false, "none"),
    longhand("outline-width", false, "medium"),
    longhand("list-style-position", true, "outside"),
    longhand("list-style-image", true, "none"),
    longhand("list-style-type", true, "disc"),
  ].map((metadata) => [metadata.property, metadata]),
);

const SHORTHAND_METADATA = new Map<string, CssShorthandPropertyMetadata>(
  [
    shorthand("all", getAllResetLonghands()),
    shorthand("margin", physicalBoxLonghands("margin")),
    shorthand("padding", physicalBoxLonghands("padding")),
    shorthand("margin-block", logicalAxisLonghands("margin-block", "margin-block")),
    shorthand("margin-inline", logicalAxisLonghands("margin-inline", "margin-inline")),
    shorthand("padding-block", logicalAxisLonghands("padding-block", "padding-block")),
    shorthand("padding-inline", logicalAxisLonghands("padding-inline", "padding-inline")),
    shorthand("inset", ["top", "right", "bottom", "left"]),
    shorthand("inset-block", logicalAxisLonghands("inset-block", "inset-block")),
    shorthand("inset-inline", logicalAxisLonghands("inset-inline", "inset-inline")),
    shorthand(
      "border",
      BOX_SIDES.flatMap((side) => BORDER_PARTS.map((part) => `border-${side}-${part}`)),
    ),
    ...BORDER_PARTS.map((part) =>
      shorthand(
        `border-${part}`,
        BOX_SIDES.map((side) => `border-${side}-${part}`),
      ),
    ),
    ...BOX_SIDES.map((side) =>
      shorthand(
        `border-${side}`,
        BORDER_PARTS.map((part) => `border-${side}-${part}`),
      ),
    ),
    shorthand("border-block", logicalBorderLonghands("block")),
    shorthand("border-inline", logicalBorderLonghands("inline")),
    ...["block", "inline"].flatMap((axis) =>
      BORDER_PARTS.map((part) =>
        shorthand(
          `border-${axis}-${part}`,
          LOGICAL_SIDES.map((side) => `border-${axis}-${side}-${part}`),
        ),
      ),
    ),
    shorthand("background", [
      "background-color",
      "background-image",
      "background-repeat",
      "background-attachment",
      "background-position",
      "background-size",
      "background-origin",
      "background-clip",
    ]),
    shorthand("border-radius", [
      "border-top-left-radius",
      "border-top-right-radius",
      "border-bottom-right-radius",
      "border-bottom-left-radius",
    ]),
    shorthand("outline", ["outline-color", "outline-style", "outline-width"]),
    shorthand("list-style", ["list-style-position", "list-style-image", "list-style-type"]),
  ].map((metadata) => [metadata.property, metadata]),
);

export function getLonghandMetadata(property: string): CssLonghandPropertyMetadata | undefined {
  const metadata = LONGHAND_METADATA.get(normalizeProperty(property));
  return metadata ? cloneLonghandMetadata(metadata) : undefined;
}

export function getKnownLonghandProperties(): string[] {
  return [...LONGHAND_METADATA.keys()].sort((left, right) => left.localeCompare(right));
}

export function getShorthandMetadata(property: string): CssShorthandPropertyMetadata | undefined {
  const metadata = SHORTHAND_METADATA.get(normalizeProperty(property));
  return metadata ? { ...metadata, longhands: [...metadata.longhands] } : undefined;
}

export function getShorthandLonghands(property: string): string[] | undefined {
  return getShorthandMetadata(property)?.longhands;
}

export function isKnownShorthandProperty(property: string): boolean {
  return SHORTHAND_METADATA.has(normalizeProperty(property));
}

export function isCssWideKeyword(token: string): boolean {
  const normalized = token.trim().toLowerCase();
  return (
    normalized === "inherit" ||
    normalized === "initial" ||
    normalized === "revert" ||
    normalized === "revert-layer" ||
    normalized === "unset"
  );
}

export function resolveCssWideKeywordForLonghand(input: {
  property: string;
  keyword: string;
}): string | undefined {
  const normalizedKeyword = input.keyword.trim().toLowerCase();
  if (!isCssWideKeyword(normalizedKeyword)) {
    return undefined;
  }

  const metadata = getLonghandMetadata(input.property);
  if (!metadata) {
    return normalizedKeyword;
  }

  if (normalizedKeyword === "initial") {
    return metadata.initialValue;
  }
  if (normalizedKeyword === "unset") {
    return metadata.inherited ? "inherit" : metadata.initialValue;
  }
  return normalizedKeyword;
}

function normalizeProperty(property: string): string {
  return property.trim().toLowerCase();
}

function longhand(
  property: string,
  inherited: boolean,
  initialValue: string,
  options: Pick<CssLonghandPropertyMetadata, "logicalGroup" | "physicalFallbacks"> = {},
): CssLonghandPropertyMetadata {
  return {
    property,
    inherited,
    initialValue,
    ...(options.logicalGroup ? { logicalGroup: options.logicalGroup } : {}),
    ...(options.physicalFallbacks ? { physicalFallbacks: [...options.physicalFallbacks] } : {}),
  };
}

function shorthand(property: string, longhands: string[]): CssShorthandPropertyMetadata {
  return {
    property,
    longhands,
    resetSupported: true,
  };
}

function cloneLonghandMetadata(metadata: CssLonghandPropertyMetadata): CssLonghandPropertyMetadata {
  return {
    ...metadata,
    ...(metadata.physicalFallbacks ? { physicalFallbacks: [...metadata.physicalFallbacks] } : {}),
  };
}

function getAllResetLonghands(): string[] {
  return [...LONGHAND_METADATA.keys()]
    .filter((property) => property !== "direction" && property !== "unicode-bidi")
    .sort((left, right) => left.localeCompare(right));
}

function physicalBoxLonghands(prefix: string): string[] {
  return BOX_SIDES.map((side) => `${prefix}-${side}`);
}

function logicalAxisLonghands(prefix: string, logicalGroup: string): string[] {
  return LOGICAL_SIDES.map((side) => `${logicalGroup}-${side}`).map((property) =>
    property.replace(logicalGroup, prefix),
  );
}

function logicalBorderLonghands(axis: string): string[] {
  return LOGICAL_SIDES.flatMap((side) =>
    BORDER_PARTS.map((part) => `border-${axis}-${side}-${part}`),
  );
}

function logicalBorderPhysicalFallbacks(axis: string, side: string, part: string): string[] {
  if (axis === "block") {
    return [`border-${side === "start" ? "top" : "bottom"}-${part}`];
  }
  return [`border-${side === "start" ? "left" : "right"}-${part}`];
}

function borderInitialValue(part: string): string {
  if (part === "width") {
    return "medium";
  }
  if (part === "style") {
    return "none";
  }
  return "currentcolor";
}
