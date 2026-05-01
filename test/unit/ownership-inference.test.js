import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOwnershipInference,
  buildProjectEvidence,
} from "../../dist/static-analysis-engine.js";

test("ownership inference returns deterministic empty facts from Stage 7A and Stage 6 evidence", () => {
  const result = buildOwnershipInference({
    projectEvidence: buildProjectEvidence(),
    selectorReachability: emptySelectorReachability(),
    options: {
      sharedCssPatterns: [],
      includeTraces: false,
    },
  });

  assert.deepEqual(result.meta, {
    generatedAtStage: "ownership-inference",
    classOwnershipCount: 0,
    definitionConsumerCount: 0,
    ownerCandidateCount: 0,
    stylesheetOwnershipCount: 0,
    classificationCount: 0,
    diagnosticCount: 0,
  });
  assert.deepEqual(result.classOwnership, []);
  assert.deepEqual(result.definitionConsumers, []);
  assert.deepEqual(result.ownerCandidates, []);
  assert.deepEqual(result.stylesheetOwnership, []);
  assert.deepEqual(result.classifications, []);
  assert.deepEqual(result.diagnostics, []);

  assert.equal(result.indexes.classOwnershipById.size, 0);
  assert.equal(result.indexes.classOwnershipIdsByClassDefinitionId.size, 0);
  assert.equal(result.indexes.classOwnershipIdsByStylesheetId.size, 0);
  assert.equal(result.indexes.classOwnershipIdsByClassName.size, 0);
  assert.equal(result.indexes.consumerEvidenceById.size, 0);
  assert.equal(result.indexes.consumerEvidenceIdsByClassDefinitionId.size, 0);
  assert.equal(result.indexes.consumerEvidenceIdsByComponentId.size, 0);
  assert.equal(result.indexes.ownerCandidateById.size, 0);
  assert.equal(result.indexes.ownerCandidateIdsByOwnerComponentId.size, 0);
  assert.equal(result.indexes.ownerCandidateIdsByStylesheetId.size, 0);
  assert.equal(result.indexes.stylesheetOwnershipById.size, 0);
  assert.equal(result.indexes.stylesheetOwnershipByStylesheetId.size, 0);
  assert.equal(result.indexes.classificationById.size, 0);
  assert.equal(result.indexes.classificationIdsByTargetId.size, 0);
  assert.equal(result.indexes.diagnosticById.size, 0);
  assert.equal(result.indexes.diagnosticsByTargetId.size, 0);
});

function emptySelectorReachability() {
  return {
    meta: {
      generatedAtStage: "selector-reachability",
      selectorBranchCount: 0,
      elementMatchCount: 0,
      branchMatchCount: 0,
      diagnosticCount: 0,
    },
    selectorBranches: [],
    elementMatches: [],
    branchMatches: [],
    diagnostics: [],
    indexes: {
      branchReachabilityBySelectorBranchNodeId: new Map(),
      branchReachabilityBySourceKey: new Map(),
      matchById: new Map(),
      elementMatchById: new Map(),
      renderElementById: new Map(),
      emissionSiteById: new Map(),
      renderPathById: new Map(),
      unknownRegionById: new Map(),
      matchIdsBySelectorBranchNodeId: new Map(),
      matchIdsByElementId: new Map(),
      matchIdsByClassName: new Map(),
      matchIdsByEmissionSiteId: new Map(),
      matchIdsByRenderPathId: new Map(),
      matchIdsByPlacementConditionId: new Map(),
      renderPathIdsByElementId: new Map(),
      renderPathIdsByEmissionSiteId: new Map(),
      placementConditionIdsByElementId: new Map(),
      placementConditionIdsByEmissionSiteId: new Map(),
      emissionSiteIdsByElementId: new Map(),
      emissionSiteIdsByToken: new Map(),
      unknownClassElementIds: [],
      unknownClassEmissionSiteIds: [],
      unknownClassEmissionSiteIdsByElementId: new Map(),
      unknownRegionIdsByComponentNodeId: new Map(),
      unknownRegionIdsByRenderPathId: new Map(),
      branchIdsByRequiredClassName: new Map(),
      branchIdsByStylesheetNodeId: new Map(),
      diagnosticIdsBySelectorBranchNodeId: new Map(),
    },
  };
}
