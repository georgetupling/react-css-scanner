import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";

import {
  buildProjectModel,
  extractProjectFacts,
  normalizeReactCssScannerConfig,
  runRules,
} from "../../dist/index.js";

export async function withRuleTempDir(run, prefix = "react-css-scanner-rule-test-") {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), prefix));

  try {
    await writeProjectFile(
      tempDir,
      "package.json",
      '{\n  "name": "rule-test",\n  "dependencies": {\n    "react": "^18.0.0"\n  }\n}\n',
    );
    await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function writeProjectFile(rootDir, relativePath, content) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

export async function runRuleScenario(tempDir, configOverride = {}) {
  const config = normalizeReactCssScannerConfig(configOverride);
  const facts = await extractProjectFacts(config, tempDir);
  const model = buildProjectModel({ config, facts });
  return runRules(model).findings;
}
