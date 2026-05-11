import assert from "node:assert/strict";
import test from "node:test";

import { componentStyleOverriddenExternallyRule } from "../../../dist/rules/rules/componentStyleOverriddenExternally.js";

test("component-style-overridden-externally reports private component styles beaten by another component", () => {
  const context = buildComponentOverrideContext();
  const findings = componentStyleOverriddenExternallyRule.run(context);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].ruleId, "component-style-overridden-externally");
  assert.equal(findings[0].subject.kind, "css-declaration");
  assert.equal(findings[0].data?.ownerComponentName, "Button");
  assert.equal(findings[0].data?.overridingComponentName, "App");
  assert.equal(findings[0].data?.property, "color");
  assert.equal(findings[0].data?.losingValue, "red");
  assert.equal(findings[0].data?.winningValue, "blue");
});

function buildComponentOverrideContext() {
  const losingDeclaration = {
    id: "decl:button",
    stylesheetId: "stylesheet:src/Button.css",
    ruleDefinitionNodeId: "rule:button",
    selectorBranchIds: ["branch:button"],
    selectorText: ".button",
    declarationIndex: 0,
    ruleSourceOrder: 0,
    property: "color",
    value: "red",
    important: false,
    atRuleContext: [],
    sourceDeclaration: { property: "color", value: "red" },
  };
  const winningDeclaration = {
    id: "decl:app",
    stylesheetId: "stylesheet:src/App.css",
    ruleDefinitionNodeId: "rule:app",
    selectorBranchIds: ["branch:app"],
    selectorText: ".button.primary",
    declarationIndex: 0,
    ruleSourceOrder: 0,
    property: "color",
    value: "blue",
    important: false,
    atRuleContext: [],
    sourceDeclaration: { property: "color", value: "blue" },
  };
  const losingCandidate = {
    id: "candidate:button",
    declarationId: losingDeclaration.id,
    elementId: "element:button",
    selectorBranchId: "branch:button",
    property: "color",
    value: "red",
    declaredProperty: "color",
    declaredValue: "red",
    propertyEffectSource: "exact",
    propertyEffectSupported: true,
    cascadeKey: {
      origin: "author",
      important: false,
      specificity: { a: 0, b: 1, c: 0 },
      orderKnown: true,
    },
    matchCertainty: "definite",
    reasons: [],
    traces: [],
  };
  const winningCandidate = {
    id: "candidate:app",
    declarationId: winningDeclaration.id,
    elementId: "element:button",
    selectorBranchId: "branch:app",
    property: "color",
    value: "blue",
    declaredProperty: "color",
    declaredValue: "blue",
    propertyEffectSource: "exact",
    propertyEffectSupported: true,
    cascadeKey: {
      origin: "author",
      important: false,
      specificity: { a: 0, b: 2, c: 0 },
      orderKnown: true,
    },
    matchCertainty: "definite",
    reasons: [],
    traces: [],
  };
  const ownerCandidates = new Map([
    [
      "owner:button",
      {
        id: "owner:button",
        targetKind: "stylesheet",
        targetId: "stylesheet:src/Button.css",
        ownerKind: "component",
        ownerId: "component:src/Button.tsx:Button",
        confidence: "high",
        actable: true,
        reasons: ["sibling-basename-convention"],
        traces: [],
      },
    ],
    [
      "owner:app",
      {
        id: "owner:app",
        targetKind: "stylesheet",
        targetId: "stylesheet:src/App.css",
        ownerKind: "component",
        ownerId: "component:src/App.tsx:App",
        confidence: "high",
        actable: true,
        reasons: ["sibling-basename-convention"],
        traces: [],
      },
    ],
  ]);

  return {
    includeTraces: false,
    config: {},
    analysisEvidence: {
      projectEvidence: {
        entities: {
          components: [
            {
              id: "component:src/Button.tsx:Button",
              componentKey: "src/Button.tsx::Button",
              filePath: "src/Button.tsx",
              componentName: "Button",
              exported: true,
              location: { filePath: "src/Button.tsx", startLine: 1, startColumn: 1 },
            },
            {
              id: "component:src/App.tsx:App",
              componentKey: "src/App.tsx::App",
              filePath: "src/App.tsx",
              componentName: "App",
              exported: true,
              location: { filePath: "src/App.tsx", startLine: 1, startColumn: 1 },
            },
          ],
        },
        indexes: {
          componentsById: new Map([
            [
              "component:src/Button.tsx:Button",
              {
                id: "component:src/Button.tsx:Button",
                componentKey: "src/Button.tsx::Button",
                filePath: "src/Button.tsx",
                componentName: "Button",
                exported: true,
                location: { filePath: "src/Button.tsx", startLine: 1, startColumn: 1 },
              },
            ],
            [
              "component:src/App.tsx:App",
              {
                id: "component:src/App.tsx:App",
                componentKey: "src/App.tsx::App",
                filePath: "src/App.tsx",
                componentName: "App",
                exported: true,
                location: { filePath: "src/App.tsx", startLine: 1, startColumn: 1 },
              },
            ],
          ]),
          stylesheetsById: new Map([
            [
              "stylesheet:src/Button.css",
              {
                id: "stylesheet:src/Button.css",
                filePath: "src/Button.css",
                origin: "project-css",
                definitions: [],
                selectors: [],
              },
            ],
            [
              "stylesheet:src/App.css",
              {
                id: "stylesheet:src/App.css",
                filePath: "src/App.css",
                origin: "project-css",
                definitions: [],
                selectors: [],
              },
            ],
          ]),
          cssDeclarationsById: new Map([
            [losingDeclaration.id, losingDeclaration],
            [winningDeclaration.id, winningDeclaration],
          ]),
        },
      },
      cascadeAnalysis: {
        outcomes: [
          {
            id: "outcome:color",
            elementId: "element:button",
            property: "color",
            winningCandidateId: winningCandidate.id,
            losingCandidateIds: [losingCandidate.id],
            unresolvedCandidateIds: [],
            certainty: "definite",
            reason: "specificity",
            comparisonTrace: [],
            traces: [],
          },
        ],
        indexes: {
          candidateById: new Map([
            [losingCandidate.id, losingCandidate],
            [winningCandidate.id, winningCandidate],
          ]),
          diagnosticIdsByDeclarationId: new Map(),
          diagnosticIdsBySelectorBranchId: new Map(),
        },
      },
      ownershipInference: {
        indexes: {
          ownerCandidateById: ownerCandidates,
          stylesheetOwnershipByStylesheetId: new Map([
            [
              "stylesheet:src/Button.css",
              {
                id: "stylesheet-ownership:button",
                stylesheetId: "stylesheet:src/Button.css",
                ownerCandidateIds: ["owner:button"],
              },
            ],
            [
              "stylesheet:src/App.css",
              {
                id: "stylesheet-ownership:app",
                stylesheetId: "stylesheet:src/App.css",
                ownerCandidateIds: ["owner:app"],
              },
            ],
          ]),
        },
      },
    },
  };
}
