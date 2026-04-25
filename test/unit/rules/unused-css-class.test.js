import assert from "node:assert/strict";
import test from "node:test";
import { scanProject } from "../../../dist/index.js";
import { TestProjectBuilder } from "../../support/TestProjectBuilder.js";

test("unused-css-class reports unreferenced local CSS classes", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile("src/App.tsx", "export function App() { return <main>Hello</main>; }\n")
    .withCssFile("src/App.css", ".unused { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].ruleId, "unused-css-class");
    assert.equal(result.findings[0].severity, "warn");
    assert.equal(result.findings[0].confidence, "high");
    assert.equal(result.findings[0].data?.className, "unused");
    assert.equal(result.findings[0].subject.kind, "class-definition");
    assert.equal(result.findings[0].evidence[0].kind, "stylesheet");
    assert.equal(result.findings[0].traces[0].category, "rule-evaluation");
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class does not report referenced classes", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./App.css";\nexport function App() { return <main className="used">Hello</main>; }\n',
    )
    .withCssFile("src/App.css", ".used { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "unused-css-class"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class lowers confidence when dynamic class references exist", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      "export function App(props) { return <main className={props.className}>Hello</main>; }\n",
    )
    .withCssFile("src/App.css", ".maybe-used { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    const finding = result.findings.find((candidate) => candidate.ruleId === "unused-css-class");
    assert.equal(finding?.confidence, "medium");
  } finally {
    await project.cleanup();
  }
});
