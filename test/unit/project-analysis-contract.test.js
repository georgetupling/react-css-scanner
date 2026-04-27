import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeProjectSourceTexts,
  serializeProjectAnalysis,
} from "../../dist/static-analysis-engine.js";

test("ProjectAnalysis exposes reference match semantics for reachable and unreachable definitions", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/App.tsx",
        sourceText:
          'export function App(props) { return <><main className="ghost" /><section className={props.active ? "maybe" : "other"} /></>; }\n',
      },
    ],
    selectorCssSources: [
      {
        filePath: "src/unused.css",
        cssText: ".ghost { color: red; }\n.maybe { color: blue; }\n",
      },
    ],
  });

  const analysis = result.projectAnalysis;
  const definiteReference = analysis.entities.classReferences.find((reference) =>
    reference.definiteClassNames.includes("ghost"),
  );
  const possibleReference = analysis.entities.classReferences.find((reference) =>
    reference.possibleClassNames.includes("maybe"),
  );
  assert.ok(definiteReference);
  assert.ok(possibleReference);
  const ghostMatchIds =
    analysis.indexes.referenceMatchesByReferenceAndClassName.get(`${definiteReference.id}:ghost`) ??
    [];
  const maybeMatchIds =
    analysis.indexes.referenceMatchesByReferenceAndClassName.get(`${possibleReference.id}:maybe`) ??
    [];
  const ghostMatch = analysis.indexes.referenceMatchesById.get(ghostMatchIds[0]);
  const maybeMatch = analysis.indexes.referenceMatchesById.get(maybeMatchIds[0]);

  assert.ok(ghostMatch);
  assert.equal(ghostMatch.className, "ghost");
  assert.equal(ghostMatch.referenceClassKind, "definite");
  assert.equal(ghostMatch.reachability, "unavailable");
  assert.equal(ghostMatch.matchKind, "unreachable-stylesheet");
  assert.ok(maybeMatch);
  assert.equal(maybeMatch.className, "maybe");
  assert.equal(maybeMatch.referenceClassKind, "possible");
});

test("ProjectAnalysis indexes declared-provider satisfaction edges by reference and class", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/App.tsx",
        sourceText: 'export function App() { return <i className="fa-user" />; }\n',
      },
    ],
    externalCss: {
      htmlStylesheetLinks: [
        {
          filePath: "index.html",
          href: "https://cdn.example/fontawesome.css",
          isRemote: true,
        },
      ],
      globalProviders: [
        {
          provider: "fontawesome",
          match: ["https://cdn.example/*.css"],
          classPrefixes: ["fa-"],
          classNames: [],
        },
      ],
    },
  });

  const analysis = result.projectAnalysis;
  const reference = analysis.entities.classReferences[0];
  const satisfactionIds =
    analysis.indexes.providerSatisfactionsByReferenceAndClassName.get(`${reference.id}:fa-user`) ??
    [];
  const satisfaction = analysis.indexes.providerSatisfactionsById.get(satisfactionIds[0]);

  assert.ok(satisfaction);
  assert.equal(satisfaction.className, "fa-user");
  assert.equal(satisfaction.referenceClassKind, "definite");
  assert.equal(satisfaction.provider, "fontawesome");
});

test("ProjectAnalysis can be serialized for debug output with populated indexes", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/App.tsx",
        sourceText:
          'import "./App.css";\nexport function App() { return <main className="shell" />; }\n',
      },
    ],
    selectorCssSources: [
      {
        filePath: "src/App.css",
        cssText: ".shell { display: block; }\n",
      },
    ],
  });

  const serialized = serializeProjectAnalysis(result.projectAnalysis);
  const json = JSON.stringify(serialized);

  assert.equal(Array.isArray(serialized.indexes.definitionsByClassName.shell), true);
  assert.equal(typeof serialized.indexes.stylesheetsById["stylesheet:src/App.css"], "object");
  assert.match(json, /definitionsByClassName/);
  assert.match(json, /stylesheet:src\/App.css/);
});

test("ProjectAnalysis exposes ownership evidence for class definitions", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/components/Button.tsx",
        sourceText:
          'import "../styles/button.css";\nexport function Button() { return <button className="button">Save</button>; }\n',
      },
    ],
    selectorCssSources: [
      {
        filePath: "src/styles/button.css",
        cssText: ".button { display: block; }\n",
      },
    ],
  });

  const analysis = result.projectAnalysis;
  const definition = analysis.entities.classDefinitions.find(
    (candidate) => candidate.className === "button",
  );
  assert.ok(definition);

  const ownershipId = analysis.indexes.classOwnershipByClassDefinitionId.get(definition.id);
  assert.ok(ownershipId);
  const ownership = analysis.indexes.classOwnershipById.get(ownershipId);
  assert.ok(ownership);
  assert.equal(ownership.className, "button");
  assert.equal(ownership.consumerSummary.consumerComponentIds.length, 1);
  assert.equal(ownership.ownerCandidates[0].kind, "component");
  assert.ok(ownership.ownerCandidates[0].reasons.includes("single-importing-component"));
  assert.ok(ownership.ownerCandidates[0].reasons.includes("single-consuming-component"));
});

test("ProjectAnalysis records supplier and emitter for forwarded class props", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/pages/MembersPage.tsx",
        sourceText: [
          'import { Select } from "../components/Select";',
          'export function MembersPage() { return <Select className="members-page__select" />; }',
          "",
        ].join("\n"),
      },
      {
        filePath: "src/components/Select.tsx",
        sourceText:
          "export function Select({ className }) { return <div className={className} />; }\n",
      },
    ],
    selectorCssSources: [
      {
        filePath: "src/pages/MembersPage.css",
        cssText: ".members-page__select { display: block; }\n",
      },
    ],
  });

  const reference = result.projectAnalysis.entities.classReferences.find((candidate) =>
    candidate.definiteClassNames.includes("members-page__select"),
  );

  assert.ok(reference);
  assert.equal(reference.componentId, "component:src/pages/MembersPage.tsx:MembersPage");
  assert.equal(reference.suppliedByComponentId, "component:src/pages/MembersPage.tsx:MembersPage");
  assert.equal(reference.emittedByComponentId, "component:src/components/Select.tsx:Select");
});

test("ProjectAnalysis records per-class suppliers for merged forwarded class props", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/pages/MembersPage.tsx",
        sourceText: [
          'import { Select } from "../components/Select";',
          'export function MembersPage() { return <Select className="members-page__select" />; }',
          "",
        ].join("\n"),
      },
      {
        filePath: "src/components/Select.tsx",
        sourceText:
          'export function Select({ className }) { return <div className={["select", className].join(" ")} />; }\n',
      },
    ],
    selectorCssSources: [
      {
        filePath: "src/pages/MembersPage.css",
        cssText: ".members-page__select { display: block; }\n",
      },
      {
        filePath: "src/components/Select.css",
        cssText: ".select { display: block; }\n",
      },
    ],
  });

  const reference = result.projectAnalysis.entities.classReferences.find((candidate) =>
    candidate.definiteClassNames.includes("members-page__select"),
  );

  assert.ok(reference);
  assert.equal(reference.componentId, "component:src/components/Select.tsx:Select");
  assert.equal(reference.suppliedByComponentId, "component:src/components/Select.tsx:Select");
  assert.equal(reference.emittedByComponentId, "component:src/components/Select.tsx:Select");
  assert.equal(
    reference.classNameComponentIds?.["members-page__select"],
    "component:src/pages/MembersPage.tsx:MembersPage",
  );
  assert.equal(
    reference.classNameComponentIds?.select,
    "component:src/components/Select.tsx:Select",
  );
});

test("ProjectAnalysis preserves caller class props through props-object destructuring", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/pages/BrowsePage.tsx",
        sourceText: [
          'import { Button } from "../ui/Button";',
          'export function BrowsePage() { return <Button className="browse-toolbar-button" />; }',
          "",
        ].join("\n"),
      },
      {
        filePath: "src/ui/Button.tsx",
        sourceText: [
          "function joinClasses(...classes) { return classes.filter(Boolean).join(' '); }",
          "export function Button(props) {",
          "  const { className, variant = 'primary' } = props;",
          "  const classes = joinClasses('button', `button--${variant}`, className);",
          "  return <button className={classes}>Save</button>;",
          "}",
          "",
        ].join("\n"),
      },
    ],
    selectorCssSources: [
      {
        filePath: "src/pages/BrowseControls.css",
        cssText: ".browse-toolbar-button { width: 100%; }\n",
      },
      {
        filePath: "src/ui/Button.css",
        cssText: ".button { display: inline-flex; }\n",
      },
    ],
  });

  const reference = result.projectAnalysis.entities.classReferences.find((candidate) =>
    candidate.definiteClassNames.includes("browse-toolbar-button"),
  );

  assert.ok(reference);
  assert.equal(
    reference.classNameComponentIds?.["browse-toolbar-button"],
    "component:src/pages/BrowsePage.tsx:BrowsePage",
  );
  assert.equal(reference.classNameComponentIds?.button, "component:src/ui/Button.tsx:Button");
});

test("ProjectAnalysis preserves finite switch helper classes in filtered class arrays", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/TriStateFilterChip.tsx",
        sourceText: [
          "function getTriStateFilterChipClassName(state) {",
          "  switch (state) {",
          '    case "require": return "browse-filter-chip browse-filter-chip--require";',
          '    case "exclude": return "browse-filter-chip browse-filter-chip--exclude";',
          '    default: return "browse-filter-chip";',
          "  }",
          "}",
          "export function TriStateFilterChip({ state, className }) {",
          '  return <button className={[getTriStateFilterChipClassName(state), className].filter(Boolean).join(" ")} />;',
          "}",
          "",
        ].join("\n"),
      },
    ],
    selectorCssSources: [
      {
        filePath: "src/BrowseControls.css",
        cssText: [
          ".browse-filter-chip { display: inline-flex; }",
          ".browse-filter-chip--require { color: green; }",
          ".browse-filter-chip--exclude { color: red; }",
          "",
        ].join("\n"),
      },
    ],
  });

  assertIndexedClassReferences(result.projectAnalysis, [
    "browse-filter-chip",
    "browse-filter-chip--require",
    "browse-filter-chip--exclude",
  ]);
});

test("ProjectAnalysis indexes React child transform references by class name", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/FieldList.tsx",
        sourceText: [
          'import { Children, cloneElement } from "react";',
          "function joinClasses(...classes) { return classes.filter(Boolean).join(' '); }",
          "export function FieldList({ children }) {",
          "  return Children.map(children, (child) =>",
          "    cloneElement(child, {",
          '      className: joinClasses(child.props.className, "field-list__control"),',
          "    }),",
          "  );",
          "}",
          "export function App() {",
          "  return (",
          "    <FieldList>",
          '      <input className="invite-form__email" />',
          '      <textarea className="invite-form__message" />',
          "    </FieldList>",
          "  );",
          "}",
          "",
        ].join("\n"),
      },
    ],
    selectorCssSources: [
      {
        filePath: "src/FieldList.css",
        cssText: [
          ".field-list__control { display: block; }",
          ".invite-form__email { inline-size: 100%; }",
          ".invite-form__message { min-height: 8rem; }",
          "",
        ].join("\n"),
      },
    ],
  });

  assertIndexedClassReferences(result.projectAnalysis, [
    "field-list__control",
    "invite-form__email",
    "invite-form__message",
  ]);
});

test("ProjectAnalysis treats React child guard APIs as non-rendering", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/GuardOnly.tsx",
        sourceText: [
          'import { Children, isValidElement } from "react";',
          "export function GuardOnly({ children }) {",
          "  const count = Children.count(children);",
          "  Children.forEach(children, () => undefined);",
          "  if (!isValidElement(children)) {",
          "    return null;",
          "  }",
          '  return <div className="guard-only">{count}</div>;',
          "}",
          "export function App() {",
          '  return <GuardOnly><span className="child-only" /></GuardOnly>;',
          "}",
          "",
        ].join("\n"),
      },
    ],
    selectorCssSources: [
      {
        filePath: "src/GuardOnly.css",
        cssText: ".guard-only { display: block; }\n.child-only { display: block; }\n",
      },
    ],
  });

  assertIndexedClassReferences(result.projectAnalysis, ["guard-only"]);
  assertNoIndexedClassReferences(result.projectAnalysis, ["child-only"]);
});

test("ProjectAnalysis keeps unbounded cloneElement className values uncertain", () => {
  const result = analyzeProjectSourceTexts({
    sourceFiles: [
      {
        filePath: "src/DynamicClone.tsx",
        sourceText: [
          'import { Children, cloneElement } from "react";',
          "export function DynamicClone({ children, tone }) {",
          "  const child = Children.only(children);",
          "  return cloneElement(child, {",
          "    className: `field-list__${tone}`,",
          "  });",
          "}",
          "export function App() {",
          '  return <DynamicClone tone={window.location.hash}><input className="stable-child" /></DynamicClone>;',
          "}",
          "",
        ].join("\n"),
      },
    ],
    selectorCssSources: [
      {
        filePath: "src/DynamicClone.css",
        cssText: ".stable-child { display: block; }\n.field-list__control { display: block; }\n",
      },
    ],
  });

  assertNoIndexedClassReferences(result.projectAnalysis, ["field-list__control"]);
  assert.ok(
    result.projectAnalysis.entities.classReferences.some(
      (reference) =>
        reference.unknownDynamic &&
        reference.definiteClassNames.length === 0 &&
        reference.possibleClassNames.length === 0,
    ),
  );
});

function assertIndexedClassReferences(analysis, classNames) {
  for (const className of classNames) {
    assert.ok(
      (analysis.indexes.referencesByClassName.get(className) ?? []).length > 0,
      `expected referencesByClassName to contain ${className}`,
    );
  }
}

function assertNoIndexedClassReferences(analysis, classNames) {
  for (const className of classNames) {
    assert.deepEqual(
      analysis.indexes.referencesByClassName.get(className) ?? [],
      [],
      `expected referencesByClassName not to contain ${className}`,
    );
  }
}
