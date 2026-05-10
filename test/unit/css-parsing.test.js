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
