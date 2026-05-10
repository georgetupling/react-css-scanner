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

test("cascade analysis gives inline styles precedence over normal author declarations", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./styles.css";\nexport function App() { return <button className="button primary" style={{ color: "red" }}>Save</button>; }\n',
    )
    .withCssFile("src/styles.css", ".button.primary { color: blue; }\n")
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
    const outcome = cascade.outcomes.find((candidate) => {
      if (candidate.property !== "color" || !candidate.winningCandidateId) {
        return false;
      }
      return (
        cascade.indexes.candidateById.get(candidate.winningCandidateId)?.cascadeKey.origin ===
        "inline"
      );
    });

    assert.ok(outcome?.winningCandidateId);
    assert.equal(outcome.reason, "higher-origin");
    const winningCandidate = cascade.indexes.candidateById.get(outcome.winningCandidateId);
    assert.equal(winningCandidate?.value, "red");
    assert.equal(winningCandidate?.cascadeKey.origin, "inline");
    assert.equal(winningCandidate?.inlineStyleId?.startsWith("inline-style:"), true);
  } finally {
    await project.cleanup();
  }
});

test("cascade analysis lets important author declarations override normal inline styles", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./styles.css";\nexport function App() { return <button className="button primary" style={{ color: "red" }}>Save</button>; }\n',
    )
    .withCssFile("src/styles.css", ".button.primary { color: blue !important; }\n")
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
    assert.equal(outcome.reason, "important");
    const winningCandidate = cascade.indexes.candidateById.get(outcome.winningCandidateId);
    assert.equal(winningCandidate?.value, "blue");
    assert.equal(winningCandidate?.cascadeKey.origin, "author");
    assert.equal(winningCandidate?.cascadeKey.important, true);
  } finally {
    await project.cleanup();
  }
});

test("cascade analysis expands inline shorthand styles into longhand effects", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <button style={{ margin: "1px 2px" }}>Save</button>; }\n',
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
    const rightOutcome = cascade.outcomes.find(
      (candidate) => candidate.property === "margin-right",
    );

    assert.ok(rightOutcome?.winningCandidateId);
    const winningCandidate = cascade.indexes.candidateById.get(rightOutcome.winningCandidateId);
    assert.equal(winningCandidate?.value, "2px");
    assert.equal(winningCandidate?.declaredProperty, "margin");
    assert.equal(winningCandidate?.propertyEffectSource, "shorthand");
    assert.equal(cascade.meta.declarationCount, 0);
    assert.equal(cascade.meta.candidateCount, 4);
  } finally {
    await project.cleanup();
  }
});

test("cascade analysis normalizes React numeric inline style values", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <button style={{ marginTop: 8, opacity: 0.5, zIndex: 2, "--density": 3, top: -4 }}>Save</button>; }\n',
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
    const winningValue = (property) => {
      const outcome = cascade.outcomes.find((candidate) => candidate.property === property);
      assert.ok(outcome?.winningCandidateId);
      return cascade.indexes.candidateById.get(outcome.winningCandidateId)?.value;
    };

    assert.equal(winningValue("margin-top"), "8px");
    assert.equal(winningValue("opacity"), "0.5");
    assert.equal(winningValue("z-index"), "2");
    assert.equal(winningValue("--density"), "3");
    assert.equal(winningValue("top"), "-4px");
  } finally {
    await project.cleanup();
  }
});

test("cascade analysis flattens static inline style object spreads in source order", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      "const base = { marginTop: 4, opacity: 0.4 };\nexport function App() { return <button style={{ ...base, marginTop: 8 }}>Save</button>; }\n",
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
    const winningValue = (property) => {
      const outcome = cascade.outcomes.find((candidate) => candidate.property === property);
      assert.ok(outcome?.winningCandidateId);
      return cascade.indexes.candidateById.get(outcome.winningCandidateId)?.value;
    };

    assert.equal(winningValue("margin-top"), "8px");
    assert.equal(winningValue("opacity"), "0.4");
    assert.equal(cascade.meta.diagnosticCount, 0);
  } finally {
    await project.cleanup();
  }
});

test("cascade analysis lets later static inline style spreads override earlier properties", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'const override = { color: "red" };\nexport function App() { return <button style={{ color: "blue", ...override }}>Save</button>; }\n',
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
    const winningCandidate = cascade.indexes.candidateById.get(outcome.winningCandidateId);
    assert.equal(winningCandidate?.value, "red");
    assert.equal(cascade.meta.candidateCount, 1);
  } finally {
    await project.cleanup();
  }
});

test("cascade analysis keeps unknown inline style spreads conservative", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'export function App({ style }) { return <button style={{ color: "red", ...style }}>Save</button>; }\n',
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

    assert.equal(cascade.meta.candidateCount, 0);
    assert.equal(
      cascade.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "unsupported-inline-style" &&
          diagnostic.message.includes("contains spread that could not be statically resolved"),
      ),
      true,
    );
  } finally {
    await project.cleanup();
  }
});

test("cascade analysis follows component-forwarded style props to intrinsic elements", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./styles.css";\nfunction Button({ style }) { return <button className="button primary" style={style}>Save</button>; }\nexport function App() { return <Button style={{ color: "red" }} />; }\n',
    )
    .withCssFile("src/styles.css", ".button.primary { color: blue; }\n")
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
    const outcome = cascade.outcomes.find((candidate) => {
      if (candidate.property !== "color" || !candidate.winningCandidateId) {
        return false;
      }
      return (
        cascade.indexes.candidateById.get(candidate.winningCandidateId)?.cascadeKey.origin ===
        "inline"
      );
    });

    assert.ok(outcome?.winningCandidateId);
    assert.equal(outcome.reason, "higher-origin");
    const winningCandidate = cascade.indexes.candidateById.get(outcome.winningCandidateId);
    assert.equal(winningCandidate?.value, "red");
    assert.equal(winningCandidate?.cascadeKey.origin, "inline");
  } finally {
    await project.cleanup();
  }
});

test("cascade analysis follows nested component-forwarded style props", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./styles.css";\nfunction Base({ style }) { return <button className="button primary" style={style}>Save</button>; }\nfunction Button({ style }) { return <Base style={style} />; }\nexport function App() { return <Button style={{ margin: "1px 2px" }} />; }\n',
    )
    .withCssFile("src/styles.css", ".button.primary { margin-right: 8px; }\n")
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
    const outcome = cascade.outcomes.find((candidate) => {
      if (candidate.property !== "margin-right" || !candidate.winningCandidateId) {
        return false;
      }
      return (
        cascade.indexes.candidateById.get(candidate.winningCandidateId)?.cascadeKey.origin ===
        "inline"
      );
    });

    assert.ok(outcome?.winningCandidateId);
    assert.equal(outcome.reason, "higher-origin");
    const winningCandidate = cascade.indexes.candidateById.get(outcome.winningCandidateId);
    assert.equal(winningCandidate?.value, "2px");
    assert.equal(winningCandidate?.declaredProperty, "margin");
    assert.equal(winningCandidate?.propertyEffectSource, "shorthand");
  } finally {
    await project.cleanup();
  }
});

test("cascade analysis normalizes numeric values from forwarded style props", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      "function Button({ style }) { return <button style={style}>Save</button>; }\nexport function App() { return <Button style={{ paddingTop: 12, lineHeight: 1.25 }} />; }\n",
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
    const winningValue = (property) => {
      const outcome = cascade.outcomes.find((candidate) => {
        if (candidate.property !== property || !candidate.winningCandidateId) {
          return false;
        }
        return (
          cascade.indexes.candidateById.get(candidate.winningCandidateId)?.cascadeKey.origin ===
          "inline"
        );
      });
      assert.ok(outcome?.winningCandidateId);
      return cascade.indexes.candidateById.get(outcome.winningCandidateId)?.value;
    };

    assert.equal(winningValue("padding-top"), "12px");
    assert.equal(winningValue("line-height"), "1.25");
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
