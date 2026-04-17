import { performance } from "node:perf_hooks";

import {
  buildProjectModel,
  buildScanSummary,
  extractProjectFacts,
  normalizeReactCssScannerConfig,
  runRules,
} from "../../dist/index.js";
import { TestProjectBuilder } from "../support/TestProjectBuilder.js";

const SCENARIOS = [
  { name: "small", componentCount: 5 },
  { name: "medium", componentCount: 25 },
  { name: "large", componentCount: 75 },
];

for (const scenario of SCENARIOS) {
  const builder = new TestProjectBuilder().withTemplate("basic-react-app");
  const imports = [];
  const usages = [];

  for (let index = 0; index < scenario.componentCount; index += 1) {
    const componentName = `Item${index}`;
    imports.push(`import "./components/${componentName}.css";`);
    usages.push(`<div className="${componentName.toLowerCase()}">${componentName}</div>`);
    builder.withCssFile(
      `src/components/${componentName}.css`,
      `.${componentName.toLowerCase()} { color: red; }\n`,
    );
  }

  builder.withSourceFile(
    "src/App.tsx",
    [...imports, "export function App() {", `  return <>${usages.join("")}</>;`, "}"].join("\n"),
  );

  const project = await builder.build();

  try {
    const config = normalizeReactCssScannerConfig({});

    const factsStart = performance.now();
    const facts = await extractProjectFacts(config, project.rootDir);
    const factsMs = performance.now() - factsStart;

    const modelStart = performance.now();
    const model = buildProjectModel({ config, facts });
    const modelMs = performance.now() - modelStart;

    const rulesStart = performance.now();
    const ruleResult = runRules(model);
    const rulesMs = performance.now() - rulesStart;

    const summary = buildScanSummary({
      sourceFileCount: model.graph.sourceFiles.length,
      cssFileCount: model.graph.cssFiles.length,
      findings: ruleResult.findings,
    });

    console.log(
      JSON.stringify(
        {
          scenario: scenario.name,
          files: summary.fileCount,
          classReferences: model.graph.sourceFiles.reduce(
            (count, sourceFile) => count + sourceFile.classReferences.length,
            0,
          ),
          classDefinitions: model.graph.cssFiles.reduce(
            (count, cssFile) => count + cssFile.classDefinitions.length,
            0,
          ),
          timingsMs: {
            facts: Number(factsMs.toFixed(2)),
            model: Number(modelMs.toFixed(2)),
            rules: Number(rulesMs.toFixed(2)),
            total: Number((factsMs + modelMs + rulesMs).toFixed(2)),
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await project.cleanup();
  }
}
