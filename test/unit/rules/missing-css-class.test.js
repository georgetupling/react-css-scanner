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

test("missing-css-class ignores object-valued JSX className maps outside class helpers", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <article className={{ display: "flex" }}>Hello</article>; }\n',
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: [],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "missing-css-class"),
      [],
    );
    assert.ok(
      result.findings.some(
        (finding) =>
          finding.ruleId === "dynamic-class-reference" &&
          finding.location?.filePath === "src/App.tsx",
      ),
    );
  } finally {
    await project.cleanup();
  }
});

test("missing-css-class still evaluates object maps inside class helpers", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import classNames from "classnames";',
        "export function App() { return <article className={classNames({ active: true })}>Hello</article>; }",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: [],
    });

    const missingFindings = result.findings.filter(
      (finding) => finding.ruleId === "missing-css-class",
    );
    assert.equal(missingFindings.length, 1);
    assert.equal(missingFindings[0].data?.className, "active");
  } finally {
    await project.cleanup();
  }
});

test("missing-css-class normalizes selector-like component ClassName prop values", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./App.css";',
        'export function App() { return <Switch focusVisibleClassName=".Mui-focusVisible" />; }',
      ].join("\n"),
    )
    .withCssFile("src/App.css", ".Mui-focusVisible { outline: 1px solid currentColor; }\n")
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

test("missing-css-class accepts classes mentioned in JSX sx selector contexts", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        "export function App() {",
        '  return <Box className="no-results-container" sx={{ "& + .no-results-container": { display: "none" } }} />;',
        "}",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: [],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "missing-css-class"),
      [],
    );
    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "unused-css-class"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("missing-css-class accepts classes mentioned in MUI styled selector contexts", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'export function App() { return <Switch focusVisibleClassName=".Mui-focusVisible" />; }',
        "const IOSSwitch = styled((props) => <Switch {...props} />)(({ theme }) => ({",
        '  "&.Mui-focusVisible .MuiSwitch-thumb": { border: "6px solid #fff" },',
        "}));",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: [],
    });

    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "missing-css-class"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("missing-css-class accepts classes from imported package CSS", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "library/styles.css";\nexport function App() { return <main className="library-btn">Hello</main>; }\n',
    )
    .withNodeModuleFile("library/styles.css", ".library-btn { display: inline-flex; }\n")
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

test("missing-css-class resolves package CSS from ancestor node_modules", async () => {
  const project = await new TestProjectBuilder()
    .withFile("package.json", '{ "name": "workspace-root" }\n')
    .withSourceFile(
      "app/src/App.tsx",
      'import "library/styles.css";\nexport function App() { return <main className="library-btn">Hello</main>; }\n',
    )
    .withNodeModuleFile("library/styles.css", ".library-btn { display: inline-flex; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.filePath("app"),
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

test("missing-css-class emits diagnostics for missing imported package CSS", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "library/missing.css";\nexport function App() { return <main className="library-btn">Hello</main>; }\n',
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: [],
    });

    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].code, "loading.package-css-import-read-failed");
    assert.equal(result.diagnostics[0].severity, "warning");
    assert.equal(result.diagnostics[0].filePath, "src/App.tsx");
    assert.match(result.diagnostics[0].message, /library\/missing\.css/);
    assert.ok(
      result.findings.some(
        (finding) =>
          finding.ruleId === "missing-css-class" && finding.data?.className === "library-btn",
      ),
    );
  } finally {
    await project.cleanup();
  }
});

test("missing-css-class accepts classes from CSS package imports", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./App.css";\nexport function App() { return <main className="library-btn">Hello</main>; }\n',
    )
    .withCssFile("src/App.css", '@import "library/styles.css";\n.local { display: block; }\n')
    .withNodeModuleFile("library/styles.css", ".library-btn { display: inline-flex; }\n")
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
          finding.ruleId === "missing-css-class" || finding.ruleId === "css-class-unreachable",
      ),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("missing-css-class adds runtime library hints for JS-only ProseMirror imports", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/RichTextEditor.tsx",
      [
        'import { EditorView } from "prosemirror-view";',
        "export function mountEditor(mount, state) {",
        "  new EditorView(",
        "    { mount },",
        "    {",
        "      state,",
        "      attributes: {",
        '        class: "ProseMirror",',
        "      },",
        "    },",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/RichTextEditor.tsx"],
      cssFilePaths: [],
    });

    const finding = result.findings.find(
      (candidate) =>
        candidate.ruleId === "missing-css-class" && candidate.data?.className === "ProseMirror",
    );

    assert.ok(finding);
    assert.deepEqual(finding.data?.runtimeLibraryHint, {
      packageName: "prosemirror-view",
      importedName: "EditorView",
      localName: "EditorView",
      cssImportFound: false,
      importedPackageCssSpecifiers: [],
      message:
        'Class "ProseMirror" is referenced by runtime DOM code from "prosemirror-view", but no package CSS import was found. If this class is library-styled, import the package CSS or define it locally.',
    });
    assert.match(
      finding.traces[0].children.at(-1)?.summary ?? "",
      /associated with "prosemirror-view"/,
    );
  } finally {
    await project.cleanup();
  }
});

test("missing-css-class accepts runtime classes from imported ProseMirror package CSS", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/RichTextEditor.tsx",
      [
        'import { EditorView } from "prosemirror-view";',
        'import "prosemirror-view/style/prosemirror.css";',
        "export function mountEditor(mount, state) {",
        "  new EditorView({ mount }, { state, attributes: { class: 'ProseMirror' } });",
        "}",
        "",
      ].join("\n"),
    )
    .withNodeModuleFile(
      "prosemirror-view/style/prosemirror.css",
      ".ProseMirror { white-space: pre-wrap; }\n",
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/RichTextEditor.tsx"],
      cssFilePaths: [],
    });

    assertNoClassFindings(result, "missing-css-class", ["ProseMirror"]);
    assertNoClassFindings(result, "css-class-unreachable", ["ProseMirror"]);
  } finally {
    await project.cleanup();
  }
});

test("missing-css-class emits diagnostics for missing CSS package imports", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./App.css";\nexport function App() { return <main className="library-btn">Hello</main>; }\n',
    )
    .withCssFile("src/App.css", '@import "library/missing.css";\n')
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].code, "loading.package-css-import-read-failed");
    assert.equal(result.diagnostics[0].severity, "warning");
    assert.equal(result.diagnostics[0].filePath, "src/App.css");
    assert.match(result.diagnostics[0].message, /library\/missing\.css/);
    assert.ok(
      result.findings.some(
        (finding) =>
          finding.ruleId === "missing-css-class" && finding.data?.className === "library-btn",
      ),
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

test("missing-css-class only accepts parsed Font Awesome classes when package CSS is imported", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "@fortawesome/fontawesome-free/css/all.css";\nexport function App() { return <i className="fa-solid fa-check" />; }\n',
    )
    .withNodeModuleFile(
      "@fortawesome/fontawesome-free/css/all.css",
      ".fa-check { display: inline-block; }\n",
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

    assert.deepEqual(classNames, ["fa-solid"]);
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

test("missing-css-class accepts classes from fetched remote CSS when fetchRemote is enabled", async () => {
  const originalFetch = globalThis.fetch;
  const fetchCalls = [];
  globalThis.fetch = async (url) => {
    fetchCalls.push(String(url));
    return new Response(".remote-btn { display: block; }\n", { status: 200 });
  };
  const project = await new TestProjectBuilder()
    .withConfig({
      externalCss: {
        fetchRemote: true,
      },
    })
    .withFile("index.html", '<link rel="stylesheet" href="https://cdn.example/app.css">\n')
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <main className="remote-btn" />; }\n',
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: [],
    });

    assert.deepEqual(fetchCalls, ["https://cdn.example/app.css"]);
    assert.deepEqual(
      result.findings.filter(
        (finding) =>
          finding.ruleId === "missing-css-class" || finding.ruleId === "css-class-unreachable",
      ),
      [],
    );
  } finally {
    globalThis.fetch = originalFetch;
    await project.cleanup();
  }
});

test("missing-css-class emits diagnostics for remote CSS fetch failures", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("not found", { status: 404 });
  const project = await new TestProjectBuilder()
    .withConfig({
      externalCss: {
        fetchRemote: true,
      },
    })
    .withFile("index.html", '<link rel="stylesheet" href="https://cdn.example/missing.css">\n')
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <main className="remote-btn" />; }\n',
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: [],
    });

    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].code, "loading.remote-css-fetch-failed");
    assert.equal(result.diagnostics[0].severity, "warning");
    assert.equal(result.diagnostics[0].filePath, "index.html");
    assert.match(result.diagnostics[0].message, /HTTP 404/);
    assert.ok(
      result.findings.some(
        (finding) =>
          finding.ruleId === "missing-css-class" && finding.data?.className === "remote-btn",
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
    await project.cleanup();
  }
});

test("missing-css-class does not fetch remote CSS by default", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response(".remote-btn { display: block; }\n", { status: 200 });
  };
  const project = await new TestProjectBuilder()
    .withFile("index.html", '<link rel="stylesheet" href="https://cdn.example/app.css">\n')
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <main className="remote-btn" />; }\n',
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: [],
    });

    assert.equal(fetchCount, 0);
    assert.ok(
      result.findings.some(
        (finding) =>
          finding.ruleId === "missing-css-class" && finding.data?.className === "remote-btn",
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
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

test("missing-css-class rejects legacy externalCss enabled config", async () => {
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

    assert.equal(result.failed, true);
    assert.equal(result.diagnostics[0].code, "config.unknown-external-css-key");
    assert.match(result.diagnostics[0].message, /unknown externalCss key "enabled"/);
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

test("missing-css-class accepts context-only classes from compound selectors", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/SiteHeaderSkeleton.tsx",
      [
        'import "./SiteHeader.css";',
        "export function SiteHeaderSkeleton() {",
        '  return <header className="site-header site-header--skeleton"><nav className="site-header__nav" /></header>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile(
      "src/SiteHeader.css",
      ".site-header { display: block; }\n.site-header--skeleton .site-header__nav { justify-content: flex-end; }\n",
    )
    .build();

  try {
    const result = await scanProject({ rootDir: project.rootDir });

    assertNoClassFindings(result, "missing-css-class", ["site-header--skeleton"]);
  } finally {
    await project.cleanup();
  }
});

test("missing-css-class resolves package CSS from ancestor node_modules in nested roots", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "apps/loremaster/client/src/App.tsx",
      'import "./index.css";\nexport function App() { return <main className="brand-token">Hello</main>; }\n',
    )
    .withCssFile(
      "apps/loremaster/client/src/index.css",
      '@import "@loremaster/branding/tokens.css";\n',
    )
    .withFile("apps/loremaster/client/package.json", '{ "name": "client" }\n')
    .withFile("apps/loremaster/client/node_modules/.keep", "\n")
    .withNodeModuleFile("@loremaster/branding/tokens.css", ".brand-token { color: red; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.filePath("apps/loremaster/client/src"),
    });

    assert.deepEqual(
      result.diagnostics.filter(
        (diagnostic) => diagnostic.code === "loading.package-css-import-read-failed",
      ),
      [],
    );
    assertNoClassFindings(result, "missing-css-class", ["brand-token"]);
    assertNoClassFindings(result, "css-class-unreachable", ["brand-token"]);
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

    const findings = result.findings.filter(
      (finding) => finding.ruleId === "missing-css-class" && finding.data?.className === "repeated",
    );

    assert.equal(findings.length, 1);
    assert.equal(findings[0].data?.usageCount, 1);
    assert.deepEqual(findings[0].data?.usageLocations, [
      {
        filePath: "src/App.tsx",
        startLine: 2,
        startColumn: 63,
        rawExpressionText: '"repeated"',
      },
    ]);
  } finally {
    await project.cleanup();
  }
});

test("missing-css-class aggregates multiple references for the same missing class", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        "export function App() {",
        "  return (",
        "    <>",
        '      <div className="skeleton skeleton--block" />',
        '      <span className="skeleton skeleton--block" />',
        '      <section className="skeleton skeleton--block" />',
        "    </>",
        "  );",
        "}",
        "",
      ].join("\n"),
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: [],
    });
    const findings = result.findings.filter(
      (finding) =>
        finding.ruleId === "missing-css-class" && finding.data?.className === "skeleton--block",
    );

    assert.equal(findings.length, 1);
    assert.equal(findings[0].data?.usageCount, 3);
    assert.deepEqual(findings[0].data?.usageLocations, [
      {
        filePath: "src/App.tsx",
        startLine: 4,
        startColumn: 22,
        rawExpressionText: '"skeleton skeleton--block"',
      },
      {
        filePath: "src/App.tsx",
        startLine: 5,
        startColumn: 23,
        rawExpressionText: '"skeleton skeleton--block"',
      },
      {
        filePath: "src/App.tsx",
        startLine: 6,
        startColumn: 26,
        rawExpressionText: '"skeleton skeleton--block"',
      },
    ]);
    assert.match(findings[0].message, /referenced 3 times/);
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
