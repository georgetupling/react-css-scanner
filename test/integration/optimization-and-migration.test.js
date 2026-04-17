import test from "node:test";
import assert from "node:assert/strict";

import { scanReactCss } from "../../dist/index.js";
import { TestProjectBuilder } from "../support/TestProjectBuilder.js";
import { withBuiltProject } from "../support/integrationTestUtils.js";

test("integration scans report utility replacement opportunities", async () => {
  await withBuiltProject(
    new TestProjectBuilder()
      .withTemplate("basic-react-app")
      .withSourceFile(
        "src/Card.tsx",
        [
          'import "./components/Card.css";',
          'export function Card() { return <div className="cardStack" />; }',
        ].join("\n"),
      )
      .withCssFile("src/styles/utilities.css", ".flex { display: flex; }\n.gap-2 { gap: 8px; }\n")
      .withCssFile("src/components/Card.css", ".cardStack { display: flex; gap: 8px; }\n")
      .withConfig({
        css: {
          utilities: ["src/styles/utilities.css"],
        },
      }),
    async (project) => {
      const result = await scanReactCss({ targetPath: project.rootDir });

      assert.ok(
        result.findings.some(
          (finding) =>
            finding.ruleId === "utility-class-replacement" &&
            finding.subject?.className === "cardStack",
        ),
      );
    },
  );
});

test("integration scans report duplicate css class definitions", async () => {
  await withBuiltProject(
    new TestProjectBuilder()
      .withTemplate("basic-react-app")
      .withCssFile("src/A.css", ".shared {}\n")
      .withCssFile("src/B.css", ".shared {}\n"),
    async (project) => {
      const result = await scanReactCss({ targetPath: project.rootDir });

      assert.ok(
        result.findings.some(
          (finding) =>
            finding.ruleId === "duplicate-css-class-definition" &&
            finding.subject?.className === "shared",
        ),
      );
    },
  );
});
