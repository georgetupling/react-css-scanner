import assert from "node:assert/strict";
import test from "node:test";

import { extractCssStyleRules } from "../../dist/static-analysis-engine.js";

const CSS_FIXTURE = `
.button,
.link {
  color: red !important;
  margin: calc(1rem + 2px);
}

@media (min-width: 700px) {
  .button {
    color: blue;

    & .icon {
      display: inline-block;
    }
  }
}

@supports (display: grid) {
  .grid[data-ready="true"] > .cell:is(.active, .selected) {
    display: grid;
  }
}
`;

test("CSS parser extracts style rules with css-tree declaration metadata", () => {
  const rules = summarizeRules(
    extractCssStyleRules({ cssText: CSS_FIXTURE, filePath: "src/App.css" }),
  );

  assert.deepEqual(
    rules.map((rule) => ({
      selector: normalizeSelector(rule.selector),
      atRules: rule.atRules,
      declarations: rule.declarations.map(({ property, value, important }) => ({
        property,
        value: compactCssValue(value),
        important,
      })),
    })),
    [
      {
        selector: ".button,.link",
        atRules: [],
        declarations: [
          { property: "color", value: "red", important: true },
          { property: "margin", value: "calc(1rem+2px)", important: false },
        ],
      },
      {
        selector: ".button",
        atRules: ["media:(min-width: 700px)"],
        declarations: [{ property: "color", value: "blue", important: false }],
      },
      {
        selector: ".button .icon",
        atRules: ["media:(min-width: 700px)"],
        declarations: [{ property: "display", value: "inline-block", important: false }],
      },
      {
        selector: '.grid[data-ready="true"]>.cell:is(.active,.selected)',
        atRules: ["supports:(display: grid)"],
        declarations: [{ property: "display", value: "grid", important: false }],
      },
    ],
  );
  assert.deepEqual(
    rules.flatMap((rule) => rule.declarations.map((declaration) => declaration.hasLocation)),
    [true, true, true, true, true],
  );
});

test("CSS parser attaches declaration property effects for cascade consumers", () => {
  const [rule] = extractCssStyleRules({
    cssText:
      '.button { background: linear-gradient(red, blue), url("/hero.png") no-repeat fixed center / cover pink; }',
    filePath: "src/App.css",
  });
  const declaration = rule.declarations[0];

  assert.deepEqual(
    declaration.propertyEffects.map(({ property, value, source, supported }) => ({
      property,
      value,
      source,
      supported,
    })),
    [
      {
        property: "background-color",
        value: "pink",
        source: "shorthand",
        supported: true,
      },
      {
        property: "background-image",
        value: "linear-gradient(red,blue), url(/hero.png)",
        source: "shorthand",
        supported: true,
      },
      {
        property: "background-repeat",
        value: "repeat, no-repeat",
        source: "shorthand",
        supported: true,
      },
      {
        property: "background-attachment",
        value: "scroll, fixed",
        source: "shorthand",
        supported: true,
      },
      {
        property: "background-position",
        value: "0% 0%, center",
        source: "shorthand",
        supported: true,
      },
      {
        property: "background-size",
        value: "auto auto, cover",
        source: "shorthand",
        supported: true,
      },
      {
        property: "background-origin",
        value: "padding-box, padding-box",
        source: "shorthand",
        supported: true,
      },
      {
        property: "background-clip",
        value: "border-box, border-box",
        source: "shorthand",
        supported: true,
      },
    ],
  );
});

test("CSS parser records custom property dependencies in declaration property effects", () => {
  const [rule] = extractCssStyleRules({
    cssText:
      ".button { --surface: blue; color: var(--surface, red); background: var(--button-bg); }",
    filePath: "src/App.css",
  });

  const customProperty = rule.declarations.find(
    (declaration) => declaration.property === "--surface",
  );
  const color = rule.declarations.find((declaration) => declaration.property === "color");
  const background = rule.declarations.find((declaration) => declaration.property === "background");

  assert.deepEqual(customProperty.propertyEffects, [
    {
      property: "--surface",
      value: "blue",
      source: "exact",
      supported: true,
    },
  ]);
  assert.deepEqual(color.propertyEffects, [
    {
      property: "color",
      value: "var(--surface, red)",
      source: "exact",
      supported: true,
      customPropertyDependencies: ["--surface"],
    },
  ]);
  assert.deepEqual(background.propertyEffects, [
    {
      property: "background",
      value: "var(--button-bg)",
      source: "exact",
      supported: false,
      customPropertyDependencies: ["--button-bg"],
      reason: 'The "background" shorthand value depends on unresolved custom property --button-bg.',
    },
  ]);
});

test("CSS parser expands CSS-wide shorthand keywords through property metadata", () => {
  const [rule] = extractCssStyleRules({
    cssText: ".button { border: inherit; border-radius: unset; }",
    filePath: "src/App.css",
  });

  const border = rule.declarations.find((declaration) => declaration.property === "border");
  const borderRadius = rule.declarations.find(
    (declaration) => declaration.property === "border-radius",
  );

  assert.deepEqual(
    border.propertyEffects.map(({ property, value, source, supported }) => ({
      property,
      value,
      source,
      supported,
    })),
    [
      { property: "border-top-width", value: "inherit", source: "shorthand", supported: true },
      { property: "border-top-style", value: "inherit", source: "shorthand", supported: true },
      { property: "border-top-color", value: "inherit", source: "shorthand", supported: true },
      { property: "border-right-width", value: "inherit", source: "shorthand", supported: true },
      { property: "border-right-style", value: "inherit", source: "shorthand", supported: true },
      { property: "border-right-color", value: "inherit", source: "shorthand", supported: true },
      { property: "border-bottom-width", value: "inherit", source: "shorthand", supported: true },
      { property: "border-bottom-style", value: "inherit", source: "shorthand", supported: true },
      { property: "border-bottom-color", value: "inherit", source: "shorthand", supported: true },
      { property: "border-left-width", value: "inherit", source: "shorthand", supported: true },
      { property: "border-left-style", value: "inherit", source: "shorthand", supported: true },
      { property: "border-left-color", value: "inherit", source: "shorthand", supported: true },
    ],
  );
  assert.deepEqual(
    borderRadius.propertyEffects.map(({ property, value, source, supported }) => ({
      property,
      value,
      source,
      supported,
    })),
    [
      {
        property: "border-top-left-radius",
        value: "0",
        source: "shorthand",
        supported: true,
      },
      {
        property: "border-top-right-radius",
        value: "0",
        source: "shorthand",
        supported: true,
      },
      {
        property: "border-bottom-right-radius",
        value: "0",
        source: "shorthand",
        supported: true,
      },
      {
        property: "border-bottom-left-radius",
        value: "0",
        source: "shorthand",
        supported: true,
      },
    ],
  );
});

test("CSS parser resolves CSS-wide longhand and all resets through property metadata", () => {
  const [rule] = extractCssStyleRules({
    cssText: ".button { color: unset; margin-top: initial; all: unset; }",
    filePath: "src/App.css",
  });

  const color = rule.declarations.find((declaration) => declaration.property === "color");
  const marginTop = rule.declarations.find((declaration) => declaration.property === "margin-top");
  const all = rule.declarations.find((declaration) => declaration.property === "all");

  assert.deepEqual(color.propertyEffects, [
    {
      property: "color",
      value: "inherit",
      source: "exact",
      supported: true,
    },
  ]);
  assert.deepEqual(marginTop.propertyEffects, [
    {
      property: "margin-top",
      value: "0",
      source: "exact",
      supported: true,
    },
  ]);
  assert.equal(
    all.propertyEffects.some((effect) => effect.property === "color"),
    true,
  );
  assert.equal(all.propertyEffects.find((effect) => effect.property === "color")?.value, "inherit");
  assert.equal(
    all.propertyEffects.find((effect) => effect.property === "background-color")?.value,
    "transparent",
  );
});

test("CSS parser keeps metadata-only non-keyword shorthands unsupported", () => {
  const [rule] = extractCssStyleRules({
    cssText: ".button { all: red; border-radius: 4px; }",
    filePath: "src/App.css",
  });

  for (const declaration of rule.declarations) {
    assert.deepEqual(
      declaration.propertyEffects.map(({ property, value, source, supported, reason }) => ({
        property,
        value,
        source,
        supported,
        reason,
      })),
      [
        {
          property: declaration.property,
          value: declaration.value,
          source: "exact",
          supported: false,
          reason: `The "${declaration.property}" shorthand is only metadata-backed for CSS-wide reset values.`,
        },
      ],
    );
  }
});

function summarizeRules(rules) {
  return rules.map((rule) => ({
    selector: rule.selector,
    atRules: rule.atRuleContext.map((atRule) => `${atRule.name}:${atRule.params}`),
    declarations: rule.declarations.map((declaration) => ({
      property: declaration.property,
      value: declaration.value,
      important: declaration.important ?? false,
      hasLocation: declaration.sourceAnchor !== undefined,
    })),
  }));
}

function normalizeSelector(value) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*([,>+~:()])\s*/g, "$1");
}

function compactCssValue(value) {
  return value.replace(/\s+/g, "");
}
