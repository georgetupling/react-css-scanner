import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { scanReactCss } from "../../dist/index.js";
import { TestProjectBuilder, loadTestResource } from "../support/TestProjectBuilder.js";
import { withBuiltProject } from "../support/integrationTestUtils.js";

async function withHttpServer(handler, run) {
  const server = http.createServer(handler);

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to start test HTTP server.");
  }

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(undefined);
      });
    });
  }
}

test("integration scans parse imported external CSS from node_modules", async () => {
  await withBuiltProject(
    new TestProjectBuilder()
      .withTemplate("react-app-with-external-css")
      .withNodeModuleFile("library/styles.css", await loadTestResource("external/library.css")),
    async (project) => {
      const result = await scanReactCss({ targetPath: project.rootDir });

      assert.ok(
        !result.findings.some(
          (finding) =>
            finding.ruleId === "missing-css-class" && finding.subject?.className === "library-btn",
        ),
      );
    },
  );
});

test("integration fetch-remote mode parses html-linked remote css", async () => {
  await withHttpServer(
    (request, response) => {
      if (request.url === "/remote.css") {
        response.writeHead(200, { "content-type": "text/css" });
        response.end(".library-btn { display: inline-block; }");
        return;
      }

      response.writeHead(404);
      response.end("not found");
    },
    async (serverBaseUrl) => {
      await withBuiltProject(
        new TestProjectBuilder()
          .withTemplate("basic-react-app")
          .withFile(
            "index.html",
            [
              "<!doctype html>",
              "<html><head>",
              `<link rel="stylesheet" href="${serverBaseUrl}/remote.css" />`,
              '</head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
            ].join("\n"),
          )
          .withSourceFile(
            "src/App.tsx",
            'export function App() { return <div className="library-btn" />; }\n',
          )
          .withConfig({
            externalCss: {
              mode: "fetch-remote",
            },
          }),
        async (project) => {
          const result = await scanReactCss({ targetPath: project.rootDir });

          assert.ok(
            !result.findings.some(
              (finding) =>
                finding.ruleId === "missing-css-class" &&
                finding.subject?.className === "library-btn",
            ),
          );
          assert.equal(result.operationalWarnings?.length ?? 0, 0);
        },
      );
    },
  );
});

test("integration fetch-remote mode warns and falls back when remote css cannot be fetched", async () => {
  await withHttpServer(
    (request, response) => {
      if (request.url === "/missing.css") {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("not found");
        return;
      }

      response.writeHead(404);
      response.end("not found");
    },
    async (serverBaseUrl) => {
      await withBuiltProject(
        new TestProjectBuilder()
          .withTemplate("basic-react-app")
          .withFile(
            "index.html",
            [
              "<!doctype html>",
              "<html><head>",
              `<link rel="stylesheet" href="${serverBaseUrl}/missing.css" />`,
              '</head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
            ].join("\n"),
          )
          .withSourceFile(
            "src/App.tsx",
            'export function App() { return <div className="library-btn" />; }\n',
          )
          .withConfig({
            externalCss: {
              mode: "fetch-remote",
            },
          }),
        async (project) => {
          const result = await scanReactCss({ targetPath: project.rootDir });

          assert.ok(
            result.operationalWarnings?.some((warning) =>
              warning.includes(
                `Could not fetch remote external CSS "${serverBaseUrl}/missing.css"`,
              ),
            ),
          );
          assert.ok(
            result.findings.some(
              (finding) =>
                finding.ruleId === "missing-external-css-class" &&
                finding.subject?.className === "library-btn",
            ),
          );
          assert.ok(
            !result.findings.some(
              (finding) =>
                finding.ruleId === "missing-css-class" &&
                finding.subject?.className === "library-btn",
            ),
          );
        },
      );
    },
  );
});

test("integration scans ignore dependency css that is present but never imported", async () => {
  await withBuiltProject(
    new TestProjectBuilder()
      .withTemplate("basic-react-app")
      .withSourceFile(
        "src/App.tsx",
        'export function App() { return <div className="library-btn" />; }\n',
      )
      .withNodeModuleFile("library/styles.css", await loadTestResource("external/library.css")),
    async (project) => {
      const result = await scanReactCss({ targetPath: project.rootDir });

      assert.ok(
        result.findings.some(
          (finding) =>
            finding.ruleId === "missing-css-class" && finding.subject?.className === "library-btn",
        ),
      );
    },
  );
});

test("integration scans report missing external css classes when imports do not provide them", async () => {
  await withBuiltProject(
    new TestProjectBuilder()
      .withTemplate("basic-react-app")
      .withSourceFile(
        "src/App.tsx",
        [
          'import "bootstrap/dist/css/bootstrap.css";',
          'export function App() { return <div className="btn ghost-btn" />; }',
        ].join("\n"),
      )
      .withNodeModuleFile(
        "bootstrap/dist/css/bootstrap.css",
        await loadTestResource("external/library.css"),
      ),
    async (project) => {
      const result = await scanReactCss({ targetPath: project.rootDir });

      assert.ok(
        result.findings.some(
          (finding) =>
            finding.ruleId === "missing-external-css-class" &&
            finding.subject?.className === "ghost-btn",
        ),
      );
    },
  );
});
