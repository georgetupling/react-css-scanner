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
    assert.equal(result.config.rules["dynamic-class-reference"], "info");
    assert.equal(result.config.rules["unsupported-syntax-affecting-analysis"], "debug");
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
