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

test("cascade analysis expands supported box-model shorthands into longhand effects", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./styles.css";\nexport function App() { return <button className="button primary">Save</button>; }\n',
    )
    .withCssFile(
      "src/styles.css",
      ".button.primary { margin: 1px 2px 3px 4px; margin-top: 8px; }\n",
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
    const marginTopOutcome = cascade.outcomes.find(
      (candidate) => candidate.property === "margin-top",
    );

    assert.ok(marginTopOutcome);
    assert.equal(marginTopOutcome.reason, "source-order");
    assert.equal(marginTopOutcome.certainty, "definite");
    assert.ok(marginTopOutcome.winningCandidateId);
    assert.equal(marginTopOutcome.unresolvedCandidateIds.length, 0);
    const winningCandidate = cascade.indexes.candidateById.get(marginTopOutcome.winningCandidateId);
    assert.ok(winningCandidate);
    assert.equal(winningCandidate.property, "margin-top");
    assert.equal(winningCandidate.value, "8px");
    assert.equal(winningCandidate.declaredProperty, "margin-top");

    const marginRightOutcome = cascade.outcomes.find(
      (candidate) => candidate.property === "margin-right",
    );
    assert.ok(marginRightOutcome?.winningCandidateId);
    const marginRightCandidate = cascade.indexes.candidateById.get(
      marginRightOutcome.winningCandidateId,
    );
    assert.equal(marginRightCandidate?.declaredProperty, "margin");
    assert.equal(marginRightCandidate?.declaredValue, "1px 2px 3px 4px");
    assert.equal(marginRightCandidate?.value, "2px");
    assert.equal(marginRightCandidate?.propertyEffectSource, "shorthand");

    const marginBottomOutcome = cascade.outcomes.find(
      (candidate) => candidate.property === "margin-bottom",
    );
    assert.ok(marginBottomOutcome?.winningCandidateId);
    const marginBottomCandidate = cascade.indexes.candidateById.get(
      marginBottomOutcome.winningCandidateId,
    );
    assert.equal(marginBottomCandidate?.value, "3px");
  } finally {
    await project.cleanup();
  }
});

test("cascade analysis expands border side shorthand values", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./styles.css";\nexport function App() { return <button className="button primary">Save</button>; }\n',
    )
    .withCssFile("src/styles.css", ".button.primary { border-color: red blue; }\n")
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
    const rightOutcome = cascade.outcomes.find(
      (candidate) => candidate.property === "border-right-color",
    );
    const bottomOutcome = cascade.outcomes.find(
      (candidate) => candidate.property === "border-bottom-color",
    );

    assert.ok(rightOutcome?.winningCandidateId);
    assert.ok(bottomOutcome?.winningCandidateId);
    assert.equal(cascade.indexes.candidateById.get(rightOutcome.winningCandidateId)?.value, "blue");
    assert.equal(cascade.indexes.candidateById.get(bottomOutcome.winningCandidateId)?.value, "red");
  } finally {
    await project.cleanup();
  }
});

test("cascade analysis reports unsupported shorthand property semantics", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./styles.css";\nexport function App() { return <button className="button primary">Save</button>; }\n',
    )
    .withCssFile("src/styles.css", ".button.primary { background: red; background-color: blue; }\n")
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

    assert.equal(
      cascade.diagnostics.some(
        (diagnostic) => diagnostic.code === "unsupported-property-semantics",
      ),
      true,
    );
  } finally {
    await project.cleanup();
  }
});

test("cascade analysis uses declared layer order before specificity", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./styles.css";\nexport function App() { return <button className="button primary active">Save</button>; }\n',
    )
    .withCssFile(
      "src/styles.css",
      "@layer reset, components;\n@layer components { .button.primary { color: blue; } }\n@layer reset { .button.primary.active { color: red; } }\n",
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
    assert.equal(outcome.reason, "layer-order");
    assert.ok(outcome.winningCandidateId);
    const winningCandidate = cascade.indexes.candidateById.get(outcome.winningCandidateId);
    assert.equal(winningCandidate?.value, "blue");
    assert.deepEqual(winningCandidate?.cascadeKey.layer, {
      name: "components",
      order: 1,
      known: true,
      unlayered: false,
    });
  } finally {
    await project.cleanup();
  }
});

test("cascade analysis gives unlayered normal declarations precedence over layered normal declarations", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./styles.css";\nexport function App() { return <button className="button primary active">Save</button>; }\n',
    )
    .withCssFile(
      "src/styles.css",
      "@layer components { .button.primary.active { color: red; } }\n.button.primary { color: blue; }\n",
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

    assert.ok(outcome?.winningCandidateId);
    assert.equal(outcome.reason, "layer-order");
    const winningCandidate = cascade.indexes.candidateById.get(outcome.winningCandidateId);
    assert.equal(winningCandidate?.value, "blue");
    assert.equal(winningCandidate?.cascadeKey.layer?.unlayered, true);
  } finally {
    await project.cleanup();
  }
});

test("cascade analysis reverses layer precedence for important declarations", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./styles.css";\nexport function App() { return <button className="button primary active">Save</button>; }\n',
    )
    .withCssFile(
      "src/styles.css",
      "@layer reset, components;\n@layer components { .button.primary.active { color: blue !important; } }\n@layer reset { .button.primary { color: red !important; } }\n.button.primary.active { color: green !important; }\n",
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

    assert.ok(outcome?.winningCandidateId);
    assert.equal(outcome.reason, "layer-order");
    const winningCandidate = cascade.indexes.candidateById.get(outcome.winningCandidateId);
    assert.equal(winningCandidate?.value, "red");
    assert.equal(winningCandidate?.cascadeKey.layer?.name, "reset");
  } finally {
    await project.cleanup();
  }
});

test("cascade analysis leaves anonymous layer order unresolved", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./styles.css";\nexport function App() { return <button className="button primary active">Save</button>; }\n',
    )
    .withCssFile(
      "src/styles.css",
      "@layer { .button.primary.active { color: red; } }\n.button.primary { color: blue; }\n",
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
    assert.equal(outcome.reason, "layer-order");
    assert.equal(outcome.certainty, "unknown");
    assert.equal(outcome.winningCandidateId, undefined);
    assert.equal(outcome.unresolvedCandidateIds.length, 2);
  } finally {
    await project.cleanup();
  }
});
