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

test("missing-css-class reports provider classes without matching stylesheet evidence", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <i className="fa-solid fa-check" />; }\n',
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: [],
    });

    const classNames = result.findings
      .filter((finding) => finding.ruleId === "missing-css-class")
      .map((finding) => finding.data?.className)
      .sort();

    assert.deepEqual(classNames, ["fa-check", "fa-solid"]);
  } finally {
    await project.cleanup();
  }
});

test("missing-css-class accepts Font Awesome classes when HTML links a matching provider stylesheet", async () => {
  const project = await new TestProjectBuilder()
    .withFile(
      "index.html",
      '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">\n',
    )
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <i className="fa-solid fa-check" />; }\n',
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: [],
    });

    const classNames = result.findings
      .filter((finding) => finding.ruleId === "missing-css-class")
      .map((finding) => finding.data?.className)
      .sort();

    assert.deepEqual(classNames, []);
  } finally {
    await project.cleanup();
  }
});

test("missing-css-class accepts classes from local CSS linked by HTML", async () => {
  const project = await new TestProjectBuilder()
    .withFile("index.html", '<link rel="stylesheet" href="/public/app.css">\n')
    .withCssFile("public/app.css", ".linked { color: green; }\n")
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <main className="linked" />; }\n',
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
          finding.ruleId === "missing-css-class" || finding.ruleId === "css-class-unreachable",
      ),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("missing-css-class loads local HTML-linked CSS outside explicit CSS paths", async () => {
  const project = await new TestProjectBuilder()
    .withFile("public/index.html", '<link rel="stylesheet" href="./app.css?v=1">\n')
    .withCssFile("public/app.css", ".linked { color: green; }\n")
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <main className="linked" />; }\n',
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
          finding.ruleId === "missing-css-class" || finding.ruleId === "css-class-unreachable",
      ),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("missing-css-class ignores provider defaults when HTML links do not match them", async () => {
  const project = await new TestProjectBuilder()
    .withFile("index.html", '<link rel="stylesheet" href="https://cdn.example/assets/icons.css">\n')
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <i className="fa-solid fa-check" />; }\n',
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: [],
    });

    const classNames = result.findings
      .filter((finding) => finding.ruleId === "missing-css-class")
      .map((finding) => finding.data?.className)
      .sort();

    assert.deepEqual(classNames, ["fa-check", "fa-solid"]);
  } finally {
    await project.cleanup();
  }
});

test("missing-css-class reports configured provider classes without matching stylesheet evidence", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      externalCss: {
        modes: ["declared-globals"],
        globals: [
          {
            provider: "custom-icons",
            match: [],
            classPrefixes: ["ci-"],
            classNames: ["icon"],
          },
        ],
      },
    })
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <i className="icon ci-check" />; }\n',
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: [],
    });

    const classNames = result.findings
      .filter((finding) => finding.ruleId === "missing-css-class")
      .map((finding) => finding.data?.className)
      .sort();

    assert.deepEqual(classNames, ["ci-check", "icon"]);
  } finally {
    await project.cleanup();
  }
});

test("missing-css-class accepts configured provider classes when an HTML link matches provider evidence", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      externalCss: {
        modes: ["declared-globals", "html-links"],
        globals: [
          {
            provider: "custom-icons",
            match: ["https://cdn.example/*.css"],
            classPrefixes: ["ci-"],
            classNames: ["icon"],
          },
        ],
      },
    })
    .withFile(
      "index.html",
      '<link rel="stylesheet" href="https://cdn.example/custom-icons.css?v=1">\n',
    )
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <i className="icon ci-check" />; }\n',
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: [],
    });

    const classNames = result.findings
      .filter((finding) => finding.ruleId === "missing-css-class")
      .map((finding) => finding.data?.className)
      .sort();

    assert.deepEqual(classNames, []);
  } finally {
    await project.cleanup();
  }
});

test("missing-css-class reports provider classes when external CSS is disabled", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      externalCss: {
        enabled: false,
      },
    })
    .withSourceFile("src/App.tsx", 'export function App() { return <i className="fa-solid" />; }\n')
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: [],
    });

    const finding = result.findings.find(
      (candidate) =>
        candidate.ruleId === "missing-css-class" && candidate.data?.className === "fa-solid",
    );

    assert.ok(finding);
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
