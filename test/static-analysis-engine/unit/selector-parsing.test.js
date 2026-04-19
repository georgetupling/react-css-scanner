import test from "node:test";
import assert from "node:assert/strict";

import { parseSelectorBranches } from "../../../dist/static-analysis-engine/libraries/selector-parsing/parseSelectorBranches.js";
import { projectToCssSelectorBranchFact } from "../../../dist/static-analysis-engine/libraries/selector-parsing/projectToCssSelectorBranchFact.js";
import {
  projectToNormalizedSelector,
  projectToSelectorConstraint,
} from "../../../dist/static-analysis-engine/libraries/selector-parsing/projectToSelectorAnalysis.js";
import { buildParsedSelectorQueries } from "../../../dist/static-analysis-engine/pipeline/selector-analysis/buildParsedSelectorQueries.js";

test("shared selector parser preserves contextual selector structure for css analysis", () => {
  const parsedBranches = parseSelectorBranches(".layout .card__title");
  assert.equal(parsedBranches.length, 1);
  assert.deepEqual(projectToCssSelectorBranchFact(parsedBranches[0]), {
    raw: ".layout .card__title",
    matchKind: "contextual",
    subjectClassNames: ["card__title"],
    requiredClassNames: ["card__title"],
    contextClassNames: ["layout"],
    negativeClassNames: [],
    hasCombinators: true,
    hasSubjectModifiers: false,
    hasUnknownSemantics: false,
  });
});

test("shared selector parser projects same-node compounds for selector analysis", () => {
  const parsedBranches = parseSelectorBranches(".panel.is-open");
  assert.equal(parsedBranches.length, 1);
  const normalizedSelector = projectToNormalizedSelector(parsedBranches[0]);
  assert.deepEqual(normalizedSelector, {
    kind: "selector-chain",
    steps: [
      {
        combinatorFromPrevious: null,
        selector: {
          kind: "class-only",
          requiredClasses: ["panel"],
        },
      },
      {
        combinatorFromPrevious: "same-node",
        selector: {
          kind: "class-only",
          requiredClasses: ["is-open"],
        },
      },
    ],
  });
  assert.deepEqual(projectToSelectorConstraint(normalizedSelector), {
    kind: "same-node-class-conjunction",
    classNames: ["panel", "is-open"],
  });
});

test("shared selector parser preserves negative classes for css analysis while remaining unsupported for selector analysis", () => {
  const parsedBranches = parseSelectorBranches(".button:not(.is-disabled)");
  assert.equal(parsedBranches.length, 1);
  assert.deepEqual(projectToCssSelectorBranchFact(parsedBranches[0]), {
    raw: ".button:not(.is-disabled)",
    matchKind: "standalone",
    subjectClassNames: ["button"],
    requiredClassNames: ["button"],
    contextClassNames: [],
    negativeClassNames: ["is-disabled"],
    hasCombinators: false,
    hasSubjectModifiers: true,
    hasUnknownSemantics: false,
  });
  assert.equal(projectToNormalizedSelector(parsedBranches[0]).kind, "unsupported");
});

test("shared selector parser emits producer-owned traces for unsupported selector analysis shapes", () => {
  const [parsedQuery] = buildParsedSelectorQueries([
    {
      selectorText: ".button:not(.is-disabled)",
      source: { kind: "direct-query" },
    },
  ]);

  assert.deepEqual(parsedQuery.parseTraces, [
    {
      traceId: "selector-parsing:normalized-selector:unsupported",
      category: "selector-parsing",
      summary:
        "could not normalize selector branch into the supported bounded selector shape subset",
      children: [],
      metadata: {
        hasUnknownSemantics: false,
        hasSubjectModifiers: true,
        negativeClassNames: ["is-disabled"],
      },
    },
  ]);
});
