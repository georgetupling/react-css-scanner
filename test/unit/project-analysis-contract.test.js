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
      enabled: true,
      modes: ["declared-globals", "html-links"],
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
