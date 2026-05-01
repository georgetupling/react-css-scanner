import assert from "node:assert/strict";
import test from "node:test";
import { analyzeProjectSourceTexts } from "../../dist/static-analysis-engine.js";
import {
  getClassDefinitionsByClassName,
  getClassOwnershipEvidence,
  getClassReferencesByClassName,
  getProjectSelectorBranchForReachability,
  getProjectSelectorQueryForReachability,
  getReferenceMatchesByReferenceAndClassName,
  getSelectorReachabilityBranches,
  getStylesheetById,
} from "../../dist/index.js";

test("rule analysis queries expose project evidence, selector reachability, and ownership evidence", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/Button.tsx",
        sourceText: [
          'import "./Button.css";',
          'export function Button() { return <button className="button button__label" />; }',
          "",
        ].join("\n"),
      },
    ],
    selectorCssSources: [
      {
        filePath: "src/Button.css",
        cssText: ".button { color: red; }\n.button .button__label { color: blue; }\n",
      },
    ],
  });
  const analysis = result.analysisEvidence;

  const definitions = getClassDefinitionsByClassName(analysis, "button");
  const references = getClassReferencesByClassName(analysis, "button");
  assert.equal(definitions.length, 1);
  assert.equal(references.length, 1);

  const matches = getReferenceMatchesByReferenceAndClassName(analysis, references[0].id, "button");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].definitionId, definitions[0].id);

  const stylesheet = getStylesheetById(analysis, definitions[0].stylesheetId);
  assert.equal(stylesheet?.filePath, "src/Button.css");

  const reachableBranches = getSelectorReachabilityBranches(analysis);
  assert.ok(reachableBranches.length >= 2);
  const contextualBranch = reachableBranches.find(
    (branch) => branch.branchText === ".button .button__label",
  );
  assert.ok(contextualBranch);
  assert.equal(
    getProjectSelectorBranchForReachability(analysis, contextualBranch)?.selectorText,
    ".button .button__label",
  );
  assert.equal(
    getProjectSelectorQueryForReachability(analysis, contextualBranch)?.selectorText,
    ".button .button__label",
  );

  const ownership = getClassOwnershipEvidence(analysis);
  assert.ok(ownership.some((entry) => entry.className === "button"));
  assert.ok(ownership.every((entry) => Array.isArray(entry.ownerCandidates)));
});
