import assert from "node:assert/strict";
import test from "node:test";
import { scanProject } from "../../../dist/index.js";
import { TestProjectBuilder } from "../../support/TestProjectBuilder.js";

test("css-class-unreachable reports classes defined only in unavailable stylesheets", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <main className="ghost">Hello</main>; }\n',
    )
    .withCssFile("src/unused.css", ".ghost { color: red; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/unused.css"],
    });

    const finding = result.findings.find(
      (candidate) =>
        candidate.ruleId === "css-class-unreachable" && candidate.data?.className === "ghost",
    );

    assert.ok(finding);
    assert.equal(finding.severity, "error");
    assert.equal(finding.confidence, "high");
    assert.equal(finding.location?.filePath, "src/App.tsx");
    assert.equal(finding.subject.kind, "class-reference");
    assert.equal(
      finding.evidence.some((entry) => entry.kind === "stylesheet"),
      true,
    );
    assert.equal(finding.traces[0].category, "rule-evaluation");
    assert.equal(finding.traces[0].children[0].category, "render-expansion");
    assert.deepEqual(
      result.findings.filter((candidate) => candidate.ruleId === "missing-css-class"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("css-class-unreachable does not report reachable definitions", async () => {
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
      result.findings.filter((finding) => finding.ruleId === "css-class-unreachable"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("css-class-unreachable keeps app-entry CSS inside the HTML app boundary", async () => {
  const project = await new TestProjectBuilder()
    .withFile(
      "apps/admin/index.html",
      '<script type="module" src="/apps/admin/src/main.tsx"></script>\n',
    )
    .withFile(
      "apps/web/index.html",
      '<script type="module" src="/apps/web/src/main.tsx"></script>\n',
    )
    .withSourceFile(
      "apps/admin/src/main.tsx",
      'import "./admin.css";\nexport function AdminApp() { return <main className="admin-only">Admin</main>; }\n',
    )
    .withSourceFile(
      "apps/web/src/main.tsx",
      'import "./web.css";\nexport function WebApp() { return <main className="admin-only">Web</main>; }\n',
    )
    .withCssFile("apps/admin/src/admin.css", ".admin-only { color: red; }\n")
    .withCssFile("apps/web/src/web.css", ".web-only { color: blue; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
    });

    const finding = result.findings.find(
      (candidate) =>
        candidate.ruleId === "css-class-unreachable" &&
        candidate.location?.filePath === "apps/web/src/main.tsx" &&
        candidate.data?.className === "admin-only",
    );
    assert.ok(finding);
  } finally {
    await project.cleanup();
  }
});

test("css-class-unreachable treats app-entry imported CSS as reachable from routed components", async () => {
  const project = await new TestProjectBuilder()
    .withFile("index.html", '<script type="module" src="/src/main.tsx"></script>\n')
    .withSourceFile(
      "src/main.tsx",
      [
        'import "./index.css";',
        'import { HomePage } from "./pages/HomePage";',
        "export function App() { return <HomePage />; }",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/pages/HomePage.tsx",
      [
        "export function HomePage() {",
        '  return <main className="page-flow"><div className="flex gap-2">Home</div></main>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/index.css", '@import "./styles/layouts.css";\n')
    .withCssFile(
      "src/styles/layouts.css",
      ".page-flow { display: flex; }\n.flex { display: flex; }\n.gap-2 { gap: .5rem; }\n",
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "css-class-unreachable", ["page-flow", "flex", "gap-2"]);
  } finally {
    await project.cleanup();
  }
});

test("css-class-unreachable does not leak component CSS through shared dependencies", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/FeatureA.tsx",
      [
        'import { Button } from "./ui/Button";',
        'import "./FeatureA.css";',
        "export function FeatureA() {",
        '  return <Button className="feature-a__button" />;',
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/FeatureB.tsx",
      [
        'import { Button } from "./ui/Button";',
        "export function FeatureB() {",
        '  return <Button className="feature-a__button" />;',
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/ui/Button.tsx",
      "export function Button({ className }) { return <button className={className}>Click</button>; }\n",
    )
    .withCssFile("src/FeatureA.css", ".feature-a__button { color: red; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/FeatureA.tsx", "src/FeatureB.tsx", "src/ui/Button.tsx"],
      cssFilePaths: ["src/FeatureA.css"],
    });

    const finding = result.findings.find(
      (candidate) =>
        candidate.ruleId === "css-class-unreachable" &&
        candidate.location?.filePath === "src/FeatureB.tsx" &&
        candidate.data?.className === "feature-a__button",
    );

    assert.ok(finding);
  } finally {
    await project.cleanup();
  }
});

test("css-class-unreachable treats wrapper CSS as reachable from slotted children", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import { Field } from "./Field";',
        "export function App() {",
        "  return (",
        "    <Field>",
        '      <input className="field__input app__name-input" />',
        "    </Field>",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/Field.tsx",
      [
        'import "./Field.css";',
        "export function Field({ children }) {",
        '  return <label className="field">{children}</label>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/Field.css",
      [".field { display: block; }", ".field__input { display: block; }", ""].join("\n"),
    )
    .withCssFile("src/App.css", ".app__name-input { inline-size: 100%; }\n")
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "css-class-unreachable", ["field__input"]);
    assertNoClassFindings(result, "missing-css-class", ["field__input"]);
  } finally {
    await project.cleanup();
  }
});

test("css-class-unreachable treats wrapper CSS as reachable from named slot props", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import { Panel } from "./Panel";',
        "export function App() {",
        '  return <Panel body={<div className="panel__body app__panel-body" />} />;',
        "}",
        "",
      ].join("\n"),
    )
    .withSourceFile(
      "src/Panel.tsx",
      [
        'import "./Panel.css";',
        "export function Panel({ body }) {",
        '  return <section className="panel">{body}</section>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/Panel.css", ".panel__body { padding: 1rem; }\n")
    .withCssFile("src/App.css", ".app__panel-body { color: rebeccapurple; }\n")
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "css-class-unreachable", ["panel__body"]);
    assertNoClassFindings(result, "missing-css-class", ["panel__body"]);
  } finally {
    await project.cleanup();
  }
});

test("css-class-unreachable does not report when one matching definition is reachable", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./App.css";\nexport function App() { return <main className="mixed">Hello</main>; }\n',
    )
    .withCssFile("src/App.css", ".mixed { display: block; }\n")
    .withCssFile("src/unused.css", ".mixed { color: red; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "css-class-unreachable"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

function assertNoClassFindings(result, ruleId, classNames) {
  assert.deepEqual(
    result.findings
      .filter(
        (finding) => finding.ruleId === ruleId && classNames.includes(finding.data?.className),
      )
      .map((finding) => finding.data?.className),
    [],
  );
}

test("css-class-unreachable can be disabled from config", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      rules: {
        "css-class-unreachable": "off",
      },
    })
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <main className="ghost">Hello</main>; }\n',
    )
    .withCssFile("src/unused.css", ".ghost { color: red; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/unused.css"],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "css-class-unreachable"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});
