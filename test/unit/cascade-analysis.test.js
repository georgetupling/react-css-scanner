import assert from "node:assert/strict";
import test from "node:test";

import { runAnalysisPipeline } from "../../dist/static-analysis-engine.js";
import { TestProjectBuilder } from "../support/TestProjectBuilder.js";

test("cascade analysis builds declaration candidates and specificity outcomes", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./styles.css";\nexport function App() { return <button className="button primary active">Save</button>; }\n',
    )
    .withCssFile(
      "src/styles.css",
      ".button.primary { color: red; }\n.button.primary.active { color: blue; }\n",
    )
    .build();

  try {
    const result = await runAnalysisPipeline({
      scanInput: {
        rootDir: project.rootDir,
        sourceFilePaths: ["src/App.tsx"],
      },
      includeTraces: false,
    });
    const cascade = result.analysisEvidence.cascadeAnalysis;

    assert.equal(cascade.meta.declarationCount, 2);
    assert.equal(cascade.meta.candidateCount, 2);
    assert.equal(cascade.meta.outcomeCount, 1);

    const outcome = cascade.outcomes[0];
    assert.equal(outcome.property, "color");
    assert.equal(outcome.reason, "specificity");
    assert.equal(outcome.unresolvedCandidateIds.length, 0);
    assert.ok(outcome.winningCandidateId);

    const winningCandidate = cascade.indexes.candidateById.get(outcome.winningCandidateId);
    assert.ok(winningCandidate);
    const winningDeclaration =
      result.analysisEvidence.projectEvidence.indexes.cssDeclarationsById.get(
        winningCandidate.declarationId,
      );
    assert.equal(winningDeclaration?.value, "blue");
    assert.deepEqual(winningCandidate.cascadeKey.specificity, { a: 0, b: 3, c: 0 });
  } finally {
    await project.cleanup();
  }
});

test("cascade analysis resolves cross-stylesheet source order from runtime import order", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/main.tsx",
      'import "./a.css";\nimport "./b.css";\nexport function App() { return <button className="button primary">Save</button>; }\n',
    )
    .withCssFile("src/a.css", ".button.primary { color: red; }\n")
    .withCssFile("src/b.css", ".button.primary { color: blue; }\n")
    .build();

  try {
    const result = await runAnalysisPipeline({
      scanInput: {
        rootDir: project.rootDir,
        sourceFilePaths: ["src/main.tsx"],
      },
      includeTraces: false,
    });
    const cascade = result.analysisEvidence.cascadeAnalysis;
    const outcome = cascade.outcomes.find((candidate) => candidate.property === "color");

    assert.ok(outcome);
    assert.equal(outcome.reason, "source-order");
    assert.equal(outcome.certainty, "definite");
    assert.ok(outcome.winningCandidateId);
    assert.equal(outcome.unresolvedCandidateIds.length, 0);
    const winningCandidate = cascade.indexes.candidateById.get(outcome.winningCandidateId);
    assert.ok(winningCandidate);
    const winningDeclaration =
      result.analysisEvidence.projectEvidence.indexes.cssDeclarationsById.get(
        winningCandidate.declarationId,
      );
    assert.equal(winningDeclaration?.value, "blue");
    assert.equal(winningCandidate.cascadeKey.orderKnown, true);
  } finally {
    await project.cleanup();
  }
});

test("cascade analysis resolves candidates inside the same at-rule context as conditional", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./styles.css";\nexport function App() { return <button className="button primary active">Save</button>; }\n',
    )
    .withCssFile(
      "src/styles.css",
      "@media (min-width: 40rem) {\n.button.primary { color: red; }\n.button.primary.active { color: blue; }\n}\n",
    )
    .build();

  try {
    const result = await runAnalysisPipeline({
      scanInput: {
        rootDir: project.rootDir,
        sourceFilePaths: ["src/App.tsx"],
      },
      includeTraces: false,
    });
    const cascade = result.analysisEvidence.cascadeAnalysis;
    const outcome = cascade.outcomes.find((candidate) => candidate.property === "color");

    assert.ok(outcome);
    assert.equal(outcome.reason, "specificity");
    assert.equal(outcome.certainty, "possible");
    assert.ok(outcome.winningCandidateId);
    assert.equal(outcome.unresolvedCandidateIds.length, 0);
    const winningCandidate = cascade.indexes.candidateById.get(outcome.winningCandidateId);
    assert.ok(winningCandidate);
    const conditionSet = cascade.indexes.conditionSetById.get(winningCandidate.conditionSetId);
    assert.equal(conditionSet?.compatibility, "conditional");
    assert.deepEqual(conditionSet?.atRuleContext, [
      { name: "media", params: "(min-width: 40rem)" },
    ]);
  } finally {
    await project.cleanup();
  }
});

test("cascade analysis leaves different at-rule contexts unresolved", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./styles.css";\nexport function App() { return <button className="button primary">Save</button>; }\n',
    )
    .withCssFile(
      "src/styles.css",
      "@media (min-width: 40rem) { .button.primary { color: red; } }\n@media (prefers-color-scheme: dark) { .button.primary { color: blue; } }\n",
    )
    .build();

  try {
    const result = await runAnalysisPipeline({
      scanInput: {
        rootDir: project.rootDir,
        sourceFilePaths: ["src/App.tsx"],
      },
      includeTraces: false,
    });
    const cascade = result.analysisEvidence.cascadeAnalysis;
    const outcome = cascade.outcomes.find((candidate) => candidate.property === "color");

    assert.ok(outcome);
    assert.equal(outcome.reason, "condition-uncertain");
    assert.equal(outcome.certainty, "unknown");
    assert.equal(outcome.winningCandidateId, undefined);
    assert.equal(outcome.unresolvedCandidateIds.length, 2);
    assert.equal(
      cascade.diagnostics.some(
        (diagnostic) => diagnostic.code === "unknown-condition-compatibility",
      ),
      true,
    );
  } finally {
    await project.cleanup();
  }
});
