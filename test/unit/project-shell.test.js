import assert from "node:assert/strict";
import test from "node:test";
import * as publicApi from "../../dist/index.js";
import { discoverProjectFiles } from "../../dist/project/discovery.js";
import { TestProjectBuilder } from "../support/TestProjectBuilder.js";

const { scanProject } = publicApi;

test("root package export exposes the stable product contract", () => {
  assert.equal(typeof publicApi.scanProject, "function");
  assert.equal("analyzeProject" in publicApi, false);
  assert.equal("discoverProjectFiles" in publicApi, false);
  assert.equal("runRules" in publicApi, false);
});

test("scanProject reports scan progress events", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import "./App.css";\nexport function App() { return <main className="shell">Hello</main>; }\n',
    )
    .withCssFile("src/App.css", ".shell { display: block; }\n")
    .build();
  const events = [];

  try {
    await scanProject({
      rootDir: project.rootDir,
      onProgress(event) {
        events.push(event);
      },
    });

    assert.ok(
      events.some(
        (event) =>
          event.stage === "discover-files" &&
          event.status === "started" &&
          event.message === "Discovering project files",
      ),
    );
    assert.ok(
      events.some(
        (event) =>
          event.stage === "reachability" &&
          event.status === "started" &&
          event.message === "Building reachability graph",
      ),
    );
    assert.ok(events.some((event) => event.stage === "run-rules" && event.status === "completed"));
    assert.ok(
      events.some((event) => event.stage === "run-rules" && typeof event.durationMs === "number"),
    );
  } finally {
    await project.cleanup();
  }
});

test("scanProject can collect performance timings", async () => {
  const project = await new TestProjectBuilder().build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      collectPerformance: true,
    });

    assert.equal(typeof result.performance?.totalMs, "number");
    assert.ok(result.performance.totalMs >= 0);
    assert.ok(
      result.performance.stages.some(
        (stage) => stage.stage === "reachability" && stage.durationMs >= 0,
      ),
    );
  } finally {
    await project.cleanup();
  }
});

test("scanProject can omit analysis traces", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <main className="missing" />; }\n',
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      includeTraces: false,
    });

    assert.ok(result.findings.length > 0);
    assert.ok(result.findings.every((finding) => finding.traces.length === 0));
  } finally {
    await project.cleanup();
  }
});

test("discoverProjectFiles scans source and CSS under a root directory", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile("src/components/Card.tsx", "export function Card() { return <div />; }\n")
    .withCssFile("src/components/Card.css", ".card {}\n")
    .withSourceFile("dist/generated.tsx", "export const ignored = true;\n")
    .withNodeModuleFile("library/index.tsx", "export const ignored = true;\n")
    .build();

  try {
    const discovered = await discoverProjectFiles({
      rootDir: project.rootDir,
    });

    assert.deepEqual(
      discovered.sourceFiles.map((file) => file.filePath),
      ["src/App.tsx", "src/components/Card.tsx"],
    );
    assert.deepEqual(
      discovered.cssFiles.map((file) => file.filePath),
      ["src/components/Card.css"],
    );
    assert.deepEqual(discovered.htmlFiles, []);
    assert.deepEqual(discovered.diagnostics, []);
  } finally {
    await project.cleanup();
  }
});

test("explicit file paths override default discovery for that file kind", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile("src/components/Card.tsx", "export function Card() { return <div />; }\n")
    .withCssFile("src/components/Card.css", ".card {}\n")
    .build();

  try {
    const discovered = await discoverProjectFiles({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/components/Card.tsx"],
    });

    assert.deepEqual(
      discovered.sourceFiles.map((file) => file.filePath),
      ["src/components/Card.tsx"],
    );
    assert.deepEqual(
      discovered.cssFiles.map((file) => file.filePath),
      ["src/components/Card.css"],
    );
    assert.deepEqual(discovered.htmlFiles, []);
  } finally {
    await project.cleanup();
  }
});

test("discoverProjectFiles discovers HTML files for stylesheet link analysis", async () => {
  const project = await new TestProjectBuilder()
    .withFile("index.html", '<link rel="stylesheet" href="/assets/app.css">\n')
    .withFile("public/nested/page.html", "<main></main>\n")
    .withNodeModuleFile("library/ignored.html", "<html></html>\n")
    .build();

  try {
    const discovered = await discoverProjectFiles({
      rootDir: project.rootDir,
    });

    assert.deepEqual(
      discovered.htmlFiles.map((file) => file.filePath),
      ["index.html", "public/nested/page.html"],
    );
  } finally {
    await project.cleanup();
  }
});

test("discoverProjectFiles reports file roots without traversing them", async () => {
  const project = await new TestProjectBuilder().build();

  try {
    const discovered = await discoverProjectFiles({
      rootDir: project.filePath("src/App.tsx"),
    });

    assert.deepEqual(discovered.sourceFiles, []);
    assert.deepEqual(discovered.cssFiles, []);
    assert.deepEqual(discovered.htmlFiles, []);
    assert.equal(discovered.diagnostics.length, 1);
    assert.equal(discovered.diagnostics[0].code, "discovery.root-not-directory");
    assert.equal(discovered.diagnostics[0].severity, "error");
    assert.match(discovered.diagnostics[0].message, /scan root must be a directory/);
  } finally {
    await project.cleanup();
  }
});

test("scanProject reports missing roots as deterministic diagnostics", async () => {
  const project = await new TestProjectBuilder().build();

  try {
    const result = await scanProject({
      rootDir: project.filePath("missing-root"),
    });

    assert.equal(result.failed, true);
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].code, "discovery.root-not-found");
    assert.equal(result.diagnostics[0].severity, "error");
    assert.deepEqual(result.files.sourceFiles, []);
    assert.deepEqual(result.files.cssFiles, []);
    assert.deepEqual(result.files.htmlFiles, []);
    assert.equal(result.summary.sourceFileCount, 0);
    assert.equal(result.summary.cssFileCount, 0);
    assert.equal(result.summary.diagnosticsBySeverity.error, 1);
  } finally {
    await project.cleanup();
  }
});

test("scanProject returns deterministic public summary from discovered files", async () => {
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

    assert.equal(result.diagnostics.length, 0);
    assert.equal(result.config.source.kind, "default");
    assert.equal(result.config.failOnSeverity, "error");
    assert.equal(result.config.rules["missing-css-class"], "error");
    assert.equal(result.config.rules["css-class-unreachable"], "error");
    assert.equal(result.config.rules["unused-css-class"], "warn");
    assert.equal(result.config.rules["missing-css-module-class"], "error");
    assert.equal(result.config.rules["unused-css-module-class"], "warn");
    assert.equal(result.config.rules["dynamic-class-reference"], "debug");
    assert.equal(result.config.rules["unsupported-syntax-affecting-analysis"], "debug");
    assert.equal(result.config.externalCss.fetchRemote, false);
    assert.equal(result.config.externalCss.remoteTimeoutMs, 5000);
    assert.ok(
      result.config.externalCss.globals.some((provider) => provider.provider === "font-awesome"),
    );
    assert.equal(result.failed, false);
    assert.deepEqual(result.findings, []);
    assert.equal("analysis" in result, false);
    assert.deepEqual(result.summary, {
      sourceFileCount: 1,
      cssFileCount: 1,
      findingCount: 0,
      findingsBySeverity: {
        debug: 0,
        info: 0,
        warn: 0,
        error: 0,
      },
      diagnosticCount: 0,
      diagnosticsBySeverity: {
        debug: 0,
        info: 0,
        warning: 0,
        error: 0,
      },
      classReferenceCount: 1,
      classDefinitionCount: 1,
      selectorQueryCount: 1,
      failed: false,
    });
  } finally {
    await project.cleanup();
  }
});

test("scanProject degrades recursive array render sources without overflowing the stack", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        'import "./App.css";',
        "export function App() {",
        "  const items = items.filter(Boolean);",
        '  return <>{items.map((item) => <span className="item">{item}</span>)}</>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/App.css", ".item { display: inline-block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    assert.equal(result.summary.sourceFileCount, 1);
    assert.equal(result.summary.cssFileCount, 1);
    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "missing-css-class"),
      [],
    );
  } finally {
    await project.cleanup();
  }
});

test("scanProject degrades recursive exact-array predicates without overflowing the stack", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      [
        "export function App() {",
        "  const items = items.filter(Boolean);",
        '  return items.some(Boolean) && <span className="item">Item</span>;',
        "}",
        "",
      ].join("\n"),
    )
    .withCssFile("src/App.css", ".item { display: inline-block; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: ["src/App.css"],
    });

    assert.equal(result.summary.sourceFileCount, 1);
    assert.equal(result.summary.cssFileCount, 1);
  } finally {
    await project.cleanup();
  }
});

test("scanProject reports unreachable matching classes without exposing ProjectAnalysis", async () => {
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
    });

    assert.equal("analysis" in result, false);
    assert.deepEqual(
      result.findings.filter((finding) => finding.ruleId === "missing-css-class"),
      [],
    );
    assert.equal(
      result.findings.some((finding) => finding.ruleId === "css-class-unreachable"),
      true,
    );
    assert.equal(result.summary.findingsBySeverity.error, 1);
    assert.equal(result.failed, true);
  } finally {
    await project.cleanup();
  }
});

test("scanProject summarizes component render analysis without exposing engine internals", async () => {
  const project = await new TestProjectBuilder()
    .withSourceFile(
      "src/App.tsx",
      'import { Button } from "./Button";\nexport function App() { return <Button className="primary" />; }\n',
    )
    .withSourceFile(
      "src/Button.tsx",
      "export function Button(props) { return <button className={props.className}>Button</button>; }\n",
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      sourceFilePaths: ["src/App.tsx", "src/Button.tsx"],
      cssFilePaths: [],
    });

    assert.equal("analysis" in result, false);
    assert.equal(result.summary.sourceFileCount, 2);
    assert.equal(result.summary.classReferenceCount > 0, true);
    assert.equal(
      result.findings.some(
        (finding) =>
          finding.ruleId === "missing-css-class" && finding.location?.filePath === "src/App.tsx",
      ),
      true,
    );
  } finally {
    await project.cleanup();
  }
});

test("scanProject applies project config rule severity overrides", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      failOnSeverity: "error",
      rules: {
        "missing-css-class": "warn",
      },
    })
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

    assert.equal(result.config.source.kind, "project");
    assert.equal(result.config.source.path, "scan-react-css.json");
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].severity, "warn");
    assert.equal(result.failed, false);
  } finally {
    await project.cleanup();
  }
});

test("scanProject fails on unknown top-level config keys", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      css: {
        global: ["src/global.css"],
      },
    })
    .withSourceFile("src/App.tsx", "export function App() { return null; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
    });

    assert.equal(result.failed, true);
    assert.equal(result.diagnostics[0].code, "config.unknown-key");
    assert.match(result.diagnostics[0].message, /unknown config key "css"/);
  } finally {
    await project.cleanup();
  }
});

test("scanProject fails on unknown rule ids in config", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      rules: {
        "legacy-rule-id": "off",
      },
    })
    .withSourceFile("src/App.tsx", "export function App() { return null; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
    });

    assert.equal(result.failed, true);
    assert.equal(result.diagnostics[0].code, "config.unknown-rule");
    assert.match(result.diagnostics[0].message, /unknown rule "legacy-rule-id"/);
  } finally {
    await project.cleanup();
  }
});

test("scanProject fails on unknown cssModules config keys", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      cssModules: {
        localsConvention: "camelCase",
        namedExports: true,
      },
    })
    .withSourceFile("src/App.tsx", "export function App() { return null; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
    });

    assert.equal(result.failed, true);
    assert.equal(result.diagnostics[0].code, "config.unknown-css-modules-key");
    assert.match(result.diagnostics[0].message, /unknown cssModules key "namedExports"/);
  } finally {
    await project.cleanup();
  }
});

test("scanProject accepts external CSS provider config and appends built-ins", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      externalCss: {
        fetchRemote: true,
        remoteTimeoutMs: 2500,
        globals: [
          {
            provider: "custom-icons",
            match: ["**/custom-icons.css"],
            classPrefixes: ["ci-"],
            classNames: ["ci"],
          },
        ],
      },
    })
    .withSourceFile("src/App.tsx", "export function App() { return null; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
    });

    assert.equal(result.failed, false);
    assert.equal(result.config.externalCss.fetchRemote, true);
    assert.equal(result.config.externalCss.remoteTimeoutMs, 2500);
    assert.ok(
      result.config.externalCss.globals.some((provider) => provider.provider === "font-awesome"),
    );
    assert.ok(
      result.config.externalCss.globals.some((provider) => provider.provider === "custom-icons"),
    );
  } finally {
    await project.cleanup();
  }
});

test("scanProject fails on unknown externalCss config keys", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      externalCss: {
        providers: [],
      },
    })
    .withSourceFile("src/App.tsx", "export function App() { return null; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
    });

    assert.equal(result.failed, true);
    assert.equal(result.diagnostics[0].code, "config.unknown-external-css-key");
    assert.match(result.diagnostics[0].message, /unknown externalCss key "providers"/);
  } finally {
    await project.cleanup();
  }
});

test("scanProject rejects legacy externalCss mode config", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      externalCss: {
        modes: ["fetch-remote"],
      },
    })
    .withSourceFile("src/App.tsx", "export function App() { return null; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
    });

    assert.equal(result.failed, true);
    assert.equal(result.diagnostics[0].code, "config.unknown-external-css-key");
    assert.match(result.diagnostics[0].message, /unknown externalCss key "modes"/);
  } finally {
    await project.cleanup();
  }
});

test("scanProject fails on malformed externalCss provider globals", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      externalCss: {
        globals: [
          {
            provider: "custom-icons",
            match: ["**/custom-icons.css"],
            classPrefixes: "ci-",
            classNames: [],
          },
        ],
      },
    })
    .withSourceFile("src/App.tsx", "export function App() { return null; }\n")
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
    });

    assert.equal(result.failed, true);
    assert.equal(result.diagnostics[0].code, "config.invalid-external-css-provider-prefixes");
    assert.match(
      result.diagnostics[0].message,
      /externalCss\.globals\[0\]\.classPrefixes must be an array of strings/,
    );
  } finally {
    await project.cleanup();
  }
});

test("scanProject can discover project config from an explicit config base directory", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      rules: {
        "missing-css-class": "off",
      },
    })
    .withSourceFile(
      "app/src/App.tsx",
      'export function App() { return <main className="missing">Hello</main>; }\n',
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.filePath("app"),
      configBaseDir: project.rootDir,
    });

    assert.equal(result.config.source.kind, "project");
    assert.deepEqual(result.findings, []);
  } finally {
    await project.cleanup();
  }
});

test("scanProject discovers config from SCAN_REACT_CSS_CONFIG_DIR", async () => {
  const project = await new TestProjectBuilder()
    .withFile(
      "env-config/scan-react-css.json",
      JSON.stringify({
        rules: {
          "missing-css-class": "off",
        },
      }),
    )
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <main className="missing">Hello</main>; }\n',
    )
    .build();

  try {
    await withEnv(
      {
        SCAN_REACT_CSS_CONFIG_DIR: project.filePath("env-config"),
        PATH: "",
      },
      async () => {
        const result = await scanProject({
          rootDir: project.rootDir,
          sourceFilePaths: ["src/App.tsx"],
          cssFilePaths: [],
        });

        assert.equal(result.config.source.kind, "env");
        assert.deepEqual(result.findings, []);
      },
    );
  } finally {
    await project.cleanup();
  }
});

test("scanProject discovers config from the OS PATH", async () => {
  const project = await new TestProjectBuilder()
    .withFile(
      "path-config/scan-react-css.json",
      JSON.stringify({
        rules: {
          "missing-css-class": "warn",
        },
      }),
    )
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <main className="missing">Hello</main>; }\n',
    )
    .build();

  try {
    await withEnv(
      {
        SCAN_REACT_CSS_CONFIG_DIR: undefined,
        PATH: project.filePath("path-config"),
      },
      async () => {
        const result = await scanProject({
          rootDir: project.rootDir,
          sourceFilePaths: ["src/App.tsx"],
          cssFilePaths: [],
        });

        assert.equal(result.config.source.kind, "path");
        assert.equal(result.findings[0].severity, "warn");
      },
    );
  } finally {
    await project.cleanup();
  }
});

test("project config takes precedence over env and PATH config", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      rules: {
        "missing-css-class": "warn",
      },
    })
    .withFile(
      "env-config/scan-react-css.json",
      JSON.stringify({
        rules: {
          "missing-css-class": "off",
        },
      }),
    )
    .withFile(
      "path-config/scan-react-css.json",
      JSON.stringify({
        rules: {
          "missing-css-class": "info",
        },
      }),
    )
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <main className="missing">Hello</main>; }\n',
    )
    .build();

  try {
    await withEnv(
      {
        SCAN_REACT_CSS_CONFIG_DIR: project.filePath("env-config"),
        PATH: project.filePath("path-config"),
      },
      async () => {
        const result = await scanProject({
          rootDir: project.rootDir,
          sourceFilePaths: ["src/App.tsx"],
          cssFilePaths: [],
        });

        assert.equal(result.config.source.kind, "project");
        assert.equal(result.findings[0].severity, "warn");
      },
    );
  } finally {
    await project.cleanup();
  }
});

test("explicit config takes precedence over project config", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      rules: {
        "missing-css-class": "off",
      },
    })
    .withFile(
      "config/custom.scan-react-css.json",
      JSON.stringify({
        rules: {
          "missing-css-class": "warn",
        },
      }),
    )
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <main className="missing">Hello</main>; }\n',
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      configPath: "config/custom.scan-react-css.json",
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: [],
    });

    assert.equal(result.config.source.kind, "explicit");
    assert.equal(result.findings[0].severity, "warn");
  } finally {
    await project.cleanup();
  }
});

async function withEnv(overrides, callback) {
  const original = new Map(Object.keys(overrides).map((key) => [key, process.env[key]]));

  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    await callback();
  } finally {
    for (const [key, value] of original.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("scanProject disables rules from config", async () => {
  const project = await new TestProjectBuilder()
    .withConfig({
      rules: {
        "missing-css-class": "off",
      },
    })
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

    assert.deepEqual(result.findings, []);
    assert.equal(result.failed, false);
  } finally {
    await project.cleanup();
  }
});

test("scanProject supports explicit config paths and fail thresholds", async () => {
  const project = await new TestProjectBuilder()
    .withFile(
      "config/custom.scan-react-css.json",
      JSON.stringify(
        {
          failOnSeverity: "warn",
          rules: {
            "missing-css-class": "warn",
          },
        },
        null,
        2,
      ),
    )
    .withSourceFile(
      "src/App.tsx",
      'export function App() { return <main className="missing">Hello</main>; }\n',
    )
    .build();

  try {
    const result = await scanProject({
      rootDir: project.rootDir,
      configPath: "config/custom.scan-react-css.json",
      sourceFilePaths: ["src/App.tsx"],
      cssFilePaths: [],
    });

    assert.deepEqual(result.config.source, {
      kind: "explicit",
      path: "config/custom.scan-react-css.json",
    });
    assert.equal(result.findings[0].severity, "warn");
    assert.equal(result.failed, true);
  } finally {
    await project.cleanup();
  }
});
