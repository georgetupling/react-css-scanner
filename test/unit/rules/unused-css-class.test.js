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

test("unused-css-class reports unreferenced local CSS linked by HTML", async () => {
  const project = await new TestProjectBuilder()
    .withFile("index.html", '<link rel="stylesheet" href="/public/app.css">\n')
    .withSourceFile("src/App.tsx", "export function App() { return <main>Hello</main>; }\n")
    .withCssFile("public/app.css", ".unused { display: block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
    });

    const finding = result.findings.find(
      (candidate) =>
        candidate.ruleId === "unused-css-class" && candidate.data?.className === "unused",
    );
    assert.ok(finding);
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class ignores local HTML-linked CSS that matches an external provider", async () => {
  const project = await new TestProjectBuilder()
    .withFile("index.html", '<link rel="stylesheet" href="/vendor/font-awesome/6/css/all.css">\n')
    .withSourceFile("src/App.tsx", 'export function App() { return <i className="fa-check" />; }\n')
    .withCssFile(
      "vendor/font-awesome/6/css/all.css",
      ".fa-check { display: inline-block; }\n.fa-unused { display: inline-block; }\n",
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
    });

    assert.deepEqual(
      result.findings.filter(
        (finding) =>
          finding.ruleId === "unused-css-class" && finding.data?.className === "fa-unused",
      ),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class ignores unreferenced imported package CSS classes", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "library/styles.css";\nexport function App() { return <main className="library-btn">Hello</main>; }\n',
    )
    .withNodeModuleFile(
      "library/styles.css",
      ".library-btn { display: inline-flex; }\n.library-unused { display: none; }\n",
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
        (finding) =>
          finding.ruleId === "unused-css-class" && finding.data?.className === "library-unused",
      ),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("unused-css-class ignores unreferenced CSS-imported package classes", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./App.css";\nexport function App() { return <main className="library-btn">Hello</main>; }\n',
    )
    .withCssFile("src/App.css", '@import "library/styles.css";\n')
    .withNodeModuleFile(
      "library/styles.css",
      ".library-btn { display: inline-flex; }\n.library-unused { display: none; }\n",
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    assert.deepEqual(
      result.findings.filter(
        (finding) =>
          finding.ruleId === "unused-css-class" && finding.data?.className === "library-unused",
      ),
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
