import assert from "node:assert/strict";
import test from "node:test";
import { scanProject } from "../../../dist/index.js";
import { TestProjectBuilder } from "../../support/TestProjectBuilder.js";

test("missing-css-class reports definite class references without definitions", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <main className="missing">Hello</main>; }\n',
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: [],
    });

    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].ruleId, "missing-css-class");
    assert.equal(result.findings[0].severity, "error");
    assert.equal(result.findings[0].confidence, "high");
    assert.equal(result.findings[0].data?.className, "missing");
    assert.equal(result.findings[0].location?.filePath, "src/App.tsx");
    assert.equal(result.findings[0].subject.kind, "class-reference");
    assert.equal(result.findings[0].evidence[0].kind, "source-file");
    assert.equal(result.findings[0].traces.length, 1);
    assert.equal(result.findings[0].traces[0].category, "rule-evaluation");
    assert.match(result.findings[0].traces[0].summary, /no definition or provider/);
    assert.equal(result.findings[0].traces[0].children[0].category, "render-expansion");
    assert.equal(result.findings[0].traces[0].children[0].children[0].category, "value-evaluation");
  } finally {
    await project.cleanup();
  }
});

test("missing-css-class does not report defined classes", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./App.css";\nexport function App() { return <main className="shell">Hello</main>; }\n',
    )
    .withCssFile("src/App.css", ".shell { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "missing-css-class"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("missing-css-class reports prop-passed classes from the call site", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import { Button } from "./Button";\nexport function App() { return <Button className="primary" />; }\n',
    )
    .withSourceFile(
      "src/Button.tsx",
      "export function Button(props) { return <button className={props.className}>Button</button>; }\n",
    )
    .withConfig({
      rules: {
        "dynamic-class-reference": "off",
      },
    })
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx", "src/Button.tsx"],
      cssFilePaths: [],
    });

    const finding = result.findings.find(
      (candidate) =>
        candidate.ruleId === "missing-css-class" && candidate.data?.className === "primary",
    );

    assert.ok(finding);
    assert.equal(finding.location?.filePath, "src/App.tsx");
    assert.equal(finding.data?.rawExpressionText, '"primary"');
  } finally {
    await project.cleanup();
  }
});

test("missing-css-class reports renderable prop classes from the call site", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import { Slot } from "./Slot";\nexport function App() { return <Slot content={<div className="slot-class" />} />; }\n',
    )
    .withSourceFile(
      "src/Slot.tsx",
      "export function Slot(props) { return <section>{props.content}</section>; }\n",
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx", "src/Slot.tsx"],
      cssFilePaths: [],
    });

    const finding = result.findings.find(
      (candidate) =>
        candidate.ruleId === "missing-css-class" && candidate.data?.className === "slot-class",
    );

    assert.ok(finding);
    assert.equal(finding.location?.filePath, "src/App.tsx");
    assert.equal(finding.data?.rawExpressionText, '"slot-class"');
    assert.equal(finding.traces[0].children[0].category, "render-expansion");
  } finally {
    await project.cleanup();
  }
});

test("missing-css-class does not use raw JSX fallback for unsupported render shapes", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <Unknown render={() => <div className="hidden" />} />; }\n',
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: [],
    });

    assert.deepEqual(
      result.findings.filter(
        (finding) => finding.ruleId === "missing-css-class" && finding.data?.className === "hidden",
      ),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("missing-css-class deduplicates repeated render IR class references", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'const items = ["one", "two"];\nexport function App() { return items.map(() => <div className="repeated" />); }\n',
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: [],
    });

    assert.equal(
      result.findings.filter(
        (finding) =>
          finding.ruleId === "missing-css-class" && finding.data?.className === "repeated",
      ).length,
      1,
    );
  } finally {
    await project.cleanup();
  }
});
