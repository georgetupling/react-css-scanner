import assert from "node:assert/strict";
import test from "node:test";
import { scanProject } from "../../../dist/index.js";
import { TestProjectBuilder } from "../../support/TestProjectBuilder.js";

test("dynamic-class-reference reports class references that cannot be reduced statically", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      "export function App(props) { return <main className={props.className}>Hello</main>; }\n",
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: [],
    });

    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].ruleId, "dynamic-class-reference");
    assert.equal(result.findings[0].severity, "info");
    assert.equal(result.findings[0].confidence, "high");
    assert.equal(result.findings[0].subject.kind, "class-reference");
    assert.equal(result.findings[0].evidence[0].kind, "source-file");
    assert.equal(result.findings[0].traces[0].category, "rule-evaluation");
    assert.equal(result.findings[0].traces[0].children[0].category, "render-expansion");
    assert.equal(result.findings[0].traces[0].children[0].children[0].category, "value-evaluation");
    assert.equal(result.findings[0].data?.rawExpressionText, "props.className");
  } finally {
    await project.cleanup();
  }
});

test("dynamic-class-reference does not report static class references", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <main className="static-class">Hello</main>; }\n',
    )
    .withCssFile("src/App.css", ".static-class { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "dynamic-class-reference"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("dynamic-class-reference does not report bounded clsx and classnames references", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        "import clsx from 'clsx';",
        "import classnames from 'classnames';",
        "export function App(props) {",
        "  return <main className={clsx('root', props.active && 'active', { selected: props.selected }, classnames('nested'))}>Hello</main>;",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/App.css",
      ".root { display: block; }\n.active { color: red; }\n.selected { color: blue; }\n.nested { color: green; }\n",
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "dynamic-class-reference"),
      [],
    );
    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "missing-css-class"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("dynamic-class-reference does not report bounded array joins, concatenation, and templates", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        "export function App(props) {",
        "  return <main className={['root', props.active && 'active', `tone-${props.danger ? 'danger' : 'safe'}`, 'icon-' + (props.small ? 'sm' : 'lg')].join(' ')}>Hello</main>;",
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/App.css",
      [
        ".root { display: block; }",
        ".active { color: red; }",
        ".tone-danger { color: red; }",
        ".tone-safe { color: green; }",
        ".icon-sm { width: 1rem; }",
        ".icon-lg { width: 2rem; }",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "dynamic-class-reference"),
      [],
    );
    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "missing-css-class"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("dynamic-class-reference can be disabled from config", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      rules: {
        "dynamic-class-reference": "off",
      },
    })
    .withSourceFile(
      "src/App.tsx",
      "export function App(props) { return <main className={props.className}>Hello</main>; }\n",
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: [],
    });

    assert.deepEqual(result.findings, []);
  } finally {
    await project.cleanup();
  }
});
