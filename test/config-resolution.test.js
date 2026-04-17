import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";

import {
  DEFAULT_CONFIG,
  ReactCssScannerConfigError,
  loadReactCssScannerConfig,
  normalizeReactCssScannerConfig,
} from "../dist/index.js";

async function withTempDir(run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "react-css-scanner-config-test-"));

  try {
    await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

test("explicit config path overrides project-root discovery", async () => {
  await withTempDir(async (tempDir) => {
    await writeJson(path.join(tempDir, "react-css-scanner.json"), {
      rootDir: "project-root",
    });
    await writeJson(path.join(tempDir, "custom.json"), {
      rootDir: "explicit",
    });

    const result = await loadReactCssScannerConfig({
      cwd: tempDir,
      configPath: "./custom.json",
    });

    assert.equal(result.source.kind, "explicit-path");
    assert.equal(result.config.rootDir, "explicit");
  });
});

test("project-root config wins over env-dir and PATH configs", async () => {
  await withTempDir(async (tempDir) => {
    const envDir = path.join(tempDir, "env-config");
    const pathDir = path.join(tempDir, "path-config");

    await writeJson(path.join(tempDir, "react-css-scanner.json"), {
      rootDir: "project-root",
    });
    await writeJson(path.join(envDir, "react-css-scanner.json"), {
      rootDir: "env-dir",
    });
    await writeJson(path.join(pathDir, "react-css-scanner.json"), {
      rootDir: "path-dir",
    });

    const result = await loadReactCssScannerConfig({
      cwd: tempDir,
      env: {
        REACT_CSS_SCANNER_CONFIG_DIR: envDir,
        PATH: pathDir,
      },
    });

    assert.equal(result.source.kind, "project-root");
    assert.equal(result.config.rootDir, "project-root");
  });
});

test("env-dir config wins over PATH config", async () => {
  await withTempDir(async (tempDir) => {
    const envDir = path.join(tempDir, "env-config");
    const pathDir = path.join(tempDir, "path-config");

    await writeJson(path.join(envDir, "react-css-scanner.json"), {
      rootDir: "env-dir",
    });
    await writeJson(path.join(pathDir, "react-css-scanner.json"), {
      rootDir: "path-dir",
    });

    const result = await loadReactCssScannerConfig({
      cwd: tempDir,
      env: {
        REACT_CSS_SCANNER_CONFIG_DIR: envDir,
        PATH: pathDir,
      },
    });

    assert.equal(result.source.kind, "env-dir");
    assert.equal(result.config.rootDir, "env-dir");
  });
});

test("PATH discovery uses the first matching config file", async () => {
  await withTempDir(async (tempDir) => {
    const firstPathDir = path.join(tempDir, "path-config-1");
    const secondPathDir = path.join(tempDir, "path-config-2");

    await writeJson(path.join(firstPathDir, "react-css-scanner.json"), {
      rootDir: "first-path",
    });
    await writeJson(path.join(secondPathDir, "react-css-scanner.json"), {
      rootDir: "second-path",
    });

    const result = await loadReactCssScannerConfig({
      cwd: tempDir,
      env: {
        PATH: [firstPathDir, secondPathDir].join(path.delimiter),
      },
    });

    assert.equal(result.source.kind, "path");
    assert.equal(result.config.rootDir, "first-path");
  });
});

test("falls back to built-in defaults with a warning when no config is found", async () => {
  await withTempDir(async (tempDir) => {
    const result = await loadReactCssScannerConfig({
      cwd: tempDir,
      env: {},
    });

    assert.equal(result.source.kind, "built-in-defaults");
    assert.deepEqual(result.config, DEFAULT_CONFIG);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /built-in defaults were used/i);
  });
});

test("supports direct inline config input", async () => {
  const result = await loadReactCssScannerConfig({
    config: {
      rootDir: "inline-root",
      policy: {
        failOnSeverity: "warning",
      },
    },
  });

  assert.equal(result.source.kind, "inline");
  assert.equal(result.config.rootDir, "inline-root");
  assert.equal(result.config.policy.failOnSeverity, "warning");
  assert.equal(result.warnings.length, 0);
});

test("normalization fills defaults for omitted sections", () => {
  const result = normalizeReactCssScannerConfig({
    css: {
      global: ["src/styles/global.css"],
    },
  });

  assert.deepEqual(result.css.global, ["src/styles/global.css"]);
  assert.deepEqual(result.source.include, DEFAULT_CONFIG.source.include);
  assert.deepEqual(result.classComposition.helpers, DEFAULT_CONFIG.classComposition.helpers);
  assert.equal(result.externalCss.mode, "declared-globals");
  assert.ok(result.externalCss.globals.some((entry) => entry.provider === "font-awesome"));
  assert.ok(result.externalCss.globals.some((entry) => entry.provider === "bootstrap-icons"));
  assert.ok(result.externalCss.globals.some((entry) => entry.provider === "material-design-icons"));
  assert.ok(result.externalCss.globals.some((entry) => entry.provider === "animate.css"));
});

test("invalid config values fail clearly", async () => {
  await withTempDir(async (tempDir) => {
    const configPath = path.join(tempDir, "react-css-scanner.json");
    await writeJson(configPath, {
      ownership: {
        namingConvention: "bad-mode",
      },
    });

    await assert.rejects(loadReactCssScannerConfig({ cwd: tempDir }), (error) => {
      assert.ok(error instanceof ReactCssScannerConfigError);
      assert.match(error.message, /config\.ownership\.namingConvention/);
      return true;
    });
  });
});

test("unknown config keys are rejected", () => {
  assert.throws(
    () =>
      normalizeReactCssScannerConfig({
        unexpected: true,
      }),
    (error) => {
      assert.ok(error instanceof ReactCssScannerConfigError);
      assert.match(error.message, /Unknown config key "unexpected"/);
      return true;
    },
  );
});
