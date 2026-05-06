import assert from "node:assert/strict";
import test from "node:test";
import { scanProject } from "../../dist/index.js";
import { TestProjectBuilder } from "../support/TestProjectBuilder.js";

const TODO = "Verified from docs/temp/adversarial-scanner-qa-report-0.3.4.md.";

test("modern selector wrappers satisfy referenced class definitions", async () => {
  const cases = [
    {
      name: ":is()",
      className: "btn",
      source:
        'import "./App.css";\nexport function App() { return <button className="btn">Save</button>; }\n',
      cssPath: "src/App.css",
      css: ":is(.btn) { color: green; }\n",
    },
    {
      name: ":where()",
      className: "btn",
      source:
        'import "./App.css";\nexport function App() { return <button className="btn">Save</button>; }\n',
      cssPath: "src/App.css",
      css: ":where(.btn) { color: green; }\n",
    },
    {
      name: "[class~=token]",
      className: "token",
      source:
        'import "./App.css";\nexport function App() { return <div className="token">Hello</div>; }\n',
      cssPath: "src/App.css",
      css: '[class~="token"] { color: green; }\n',
    },
    {
      name: "CSS Module :global()",
      className: "global-token",
      source:
        'import "./App.module.css";\nexport function App() { return <div className="global-token">Hello</div>; }\n',
      cssPath: "src/App.module.css",
      css: ":global(.global-token) { color: green; }\n",
    },
  ];

  const failures = [];
  for (const currentCase of cases) {
    const result = await scan({
      source: currentCase.source,
      cssPath: currentCase.cssPath,
      css: currentCase.css,
    });
    const missing = classFindings(result, "missing-css-class", [currentCase.className]);
    if (missing.length > 0) {
      failures.push(`${currentCase.name} reported ${currentCase.className} as missing`);
    }
  }

  assert.deepEqual(failures, []);
});

test(":has() selectors model argument classes and reachability", async () => {
  const matchingResult = await scan({
    source:
      'import "./App.css";\nexport function App() { return <section className="card"><h2 className="title">Title</h2></section>; }\n',
    css: ".card:has(.title) { border: 1px solid; }\n",
  });
  const impossibleResult = await scan({
    source:
      'import "./App.css";\nexport function App() { return <section className="card"><p>No title</p></section>; }\n',
    css: ".card:has(.title) { border: 1px solid; }\n",
  });

  assert.deepEqual(classFindings(matchingResult, "missing-css-class", ["title"]), []);
  assert.ok(hasSelectorFinding(impossibleResult, "unsatisfiable-selector", ".card:has(.title)"));
});

test(":not() selectors do not treat negated classes as definitions and can be unsatisfiable", async () => {
  const result = await scan({
    source:
      'import "./App.css";\nexport function App() { return <button className="btn disabled">Save</button>; }\n',
    css: ".btn:not(.disabled) { color: green; }\n",
  });

  assert.deepEqual(classFindings(result, "missing-css-class", ["disabled"]), []);
  assert.ok(hasSelectorFinding(result, "unsatisfiable-selector", ".btn:not(.disabled)"));
});

test(
  "adjacent sibling selectors match across component expansion boundaries",
  { todo: TODO },
  async () => {
    const result = await scan({
      source: [
        'import "./App.css";',
        'function Second() { return <span className="second">Two</span>; }',
        'export function App() { return <><span className="first">One</span><Second /></>; }',
        "",
      ].join("\n"),
      css: ".first + .second { margin-left: 0.5rem; }\n",
    });

    assert.deepEqual(
      result.findings.filter(
        (finding) =>
          finding.ruleId === "unsatisfiable-selector" &&
          finding.data?.selectorText === ".first + .second",
      ),
      [],
    );
  },
);

test("JSX spread className object literals create class references", async () => {
  const usedResult = await scan({
    source:
      'import "./App.css";\nconst props = { className: "spread" };\nexport function App() { return <div {...props}>Hello</div>; }\n',
    css: ".spread { color: green; }\n",
  });
  const missingResult = await scan({
    source:
      'import "./App.css";\nconst props = { className: "missing" };\nexport function App() { return <div {...props}>Hello</div>; }\n',
    css: "/* empty */\n",
  });

  assert.deepEqual(classFindings(usedResult, "unused-css-class", ["spread"]), []);
  assert.ok(classFindings(missingResult, "missing-css-class", ["missing"]).length > 0);
});

test("JSX spread className respects prop override order", async () => {
  const result = await scan({
    source:
      'import "./App.css";\nconst props = { className: "actual" };\nexport function App() { return <div className="overridden" {...props}>Hello</div>; }\n',
    css: ".actual { color: green; }\n.overridden { color: red; }\n",
  });

  assert.deepEqual(classFindings(result, "unused-css-class", ["actual"]), []);
  assert.ok(classFindings(result, "unused-css-class", ["overridden"]).length > 0);
});

test("React.createElement className props create class references", async () => {
  const usedResult = await scan({
    source:
      'import React from "react";\nimport "./App.css";\nexport function App() { return React.createElement("div", { className: "created" }, "Hello"); }\n',
    css: ".created { color: green; }\n",
  });
  const missingResult = await scan({
    source:
      'import React from "react";\nimport "./App.css";\nexport function App() { return React.createElement("div", { className: "missing" }, "Hello"); }\n',
    css: "/* empty */\n",
  });

  assert.deepEqual(classFindings(usedResult, "unused-css-class", ["created"]), []);
  assert.ok(classFindings(missingResult, "missing-css-class", ["missing"]).length > 0);
});

test("imported local class constants are finite class references", { todo: TODO }, async () => {
  const constantResult = await scan({
    source:
      'import "./App.css";\nimport { rootClass } from "./classes";\nexport function App() { return <main className={rootClass}>Hello</main>; }\n',
    css: ".root { color: green; }\n",
    extraSourceFiles: [["src/classes.ts", 'export const rootClass = "root";\n']],
  });
  const lookupResult = await scan({
    source:
      'import "./App.css";\nimport { toneClass } from "./classes";\nexport function App({ tone }: { tone: keyof typeof toneClass }) { return <button className={toneClass[tone]}>Save</button>; }\n',
    css: ".btn-primary { color: blue; }\n.btn-secondary { color: purple; }\n",
    extraSourceFiles: [
      [
        "src/classes.ts",
        'export const toneClass = { primary: "btn-primary", secondary: "btn-secondary" } as const;\n',
      ],
    ],
  });

  assert.deepEqual(classFindings(constantResult, "unused-css-class", ["root"]), []);
  assert.deepEqual(
    classFindings(lookupResult, "unused-css-class", ["btn-primary", "btn-secondary"]),
    [],
  );
});

test(
  "finite Object.values(...).join class composition does not produce dead CSS warnings",
  {
    todo: TODO,
  },
  async () => {
    const result = await scan({
      source:
        'import "./App.css";\nconst classes = { root: "root", elevated: "elevated" };\nexport function App() { return <div className={Object.values(classes).join(" ")}>Hello</div>; }\n',
      css: ".root { color: green; }\n.elevated { box-shadow: 0 0 2px black; }\n",
    });

    assert.deepEqual(classFindings(result, "unused-css-class", ["root", "elevated"]), []);
  },
);

test("forwardRef wrappers preserve forwarded className flow", { todo: TODO }, async () => {
  const result = await scan({
    source: [
      'import { forwardRef } from "react";',
      'import "./App.css";',
      "const Box = forwardRef<HTMLDivElement, { className?: string }>(function Box(props, ref) {",
      "  return <div ref={ref} className={props.className} />;",
      "});",
      'export function App() { return <Box className="forwarded" />; }',
      "",
    ].join("\n"),
    css: ".forwarded { color: green; }\n",
  });

  assert.deepEqual(classFindings(result, "unused-css-class", ["forwarded"]), []);
});

test(
  "literal unreachable render branches do not count class references as live",
  {
    todo: TODO,
  },
  async () => {
    const result = await scan({
      source:
        'import "./App.css";\nexport function App() { return <>{false && <div className="never">Never</div>}</>; }\n',
      css: ".never { color: red; }\n",
    });

    assert.ok(classFindings(result, "unused-css-class", ["never"]).length > 0);
  },
);

async function scan({ source, css, cssPath = "src/App.css", extraSourceFiles = [] }) {
  let builder = new TestProjectBuilder()
    .withSourceFile("src/App.tsx", source)
    .withCssFile(cssPath, css);

  for (const [filePath, content] of extraSourceFiles) {
    builder = builder.withSourceFile(filePath, content);
  }

  const project = await builder.build();
  try {
    return await scanProject({ rootDir: project.rootDir });
  } finally {
    await project.cleanup();
  }
}

function classFindings(result, ruleId, classNames) {
  return result.findings.filter(
    (finding) => finding.ruleId === ruleId && classNames.includes(finding.data?.className),
  );
}

function hasSelectorFinding(result, ruleId, selectorText) {
  return result.findings.some(
    (finding) => finding.ruleId === ruleId && finding.data?.selectorText === selectorText,
  );
}
