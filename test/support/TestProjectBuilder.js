import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";

const RESOURCE_ROOT = path.resolve("test/resources");

const TEMPLATE_FILES = {
  empty: {},
  "basic-react-app": {
    "package.json":
      '{\n  "name": "basic-react-app",\n  "dependencies": {\n    "react": "^18.0.0"\n  }\n}\n',
    "src/App.tsx": "export function App() { return null; }\n",
  },
  "react-app-with-global-css": {
    "package.json":
      '{\n  "name": "react-app-with-global-css",\n  "dependencies": {\n    "react": "^18.0.0"\n  }\n}\n',
    "src/main.tsx": 'import "./styles/global.css";\nexport function App() { return null; }\n',
    "src/styles/global.css": ".app-shell {}\n",
  },
  "react-app-with-css-modules": {
    "package.json":
      '{\n  "name": "react-app-with-css-modules",\n  "dependencies": {\n    "react": "^18.0.0"\n  }\n}\n',
    "src/components/Button.tsx":
      'import styles from "./Button.module.css";\nexport function Button() { return <button className={styles.root}>Button</button>; }\n',
    "src/components/Button.module.css": ".root {}\n",
  },
  "react-app-with-external-css": {
    "package.json":
      '{\n  "name": "react-app-with-external-css",\n  "dependencies": {\n    "react": "^18.0.0"\n  }\n}\n',
    "src/App.tsx":
      'import "library/styles.css";\nexport function App() { return <div className="library-btn" />; }\n',
  },
};

export class TestProjectBuilder {
  #selectedTemplate = "basic-react-app";
  #files = new Map();

  withTemplate(templateName) {
    if (!(templateName in TEMPLATE_FILES)) {
      throw new Error(`Unknown test template "${templateName}".`);
    }

    this.#selectedTemplate = templateName;
    return this;
  }

  withFile(relativePath, content) {
    this.#files.set(normalizeRelativePath(relativePath), content);
    return this;
  }

  withSourceFile(relativePath, content) {
    return this.withFile(relativePath, content);
  }

  withCssFile(relativePath, content) {
    return this.withFile(relativePath, content);
  }

  async withFileFromResource(relativePath, resourcePath) {
    const content = await loadTestResource(resourcePath);
    return this.withFile(relativePath, content);
  }

  async withSourceFileFromResource(relativePath, resourcePath) {
    return this.withFileFromResource(relativePath, resourcePath);
  }

  async withCssFileFromResource(relativePath, resourcePath) {
    return this.withFileFromResource(relativePath, resourcePath);
  }

  async withGlobalCssFromResource(resourcePath, targetPath = "src/styles/global.css") {
    return this.withCssFileFromResource(targetPath, resourcePath);
  }

  withNodeModuleFile(relativePath, content) {
    return this.withFile(path.join("node_modules", relativePath), content);
  }

  withConfig(config) {
    return this.withFile("scan-react-css.json", `${JSON.stringify(config, null, 2)}\n`);
  }

  async build() {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "scan-react-css-integration-test-"));
    const templateFiles = TEMPLATE_FILES[this.#selectedTemplate];

    for (const [relativePath, content] of Object.entries(templateFiles)) {
      await writeProjectFile(rootDir, relativePath, content);
    }

    for (const [relativePath, content] of this.#files.entries()) {
      await writeProjectFile(rootDir, relativePath, content);
    }

    return new BuiltTestProject(rootDir);
  }
}

export class BuiltTestProject {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }

  filePath(relativePath) {
    return path.join(this.rootDir, relativePath);
  }

  async readFile(relativePath) {
    return readFile(this.filePath(relativePath), "utf8");
  }

  async listFiles() {
    return listRelativeFiles(this.rootDir);
  }

  async cleanup() {
    await rm(this.rootDir, { recursive: true, force: true });
  }
}

export async function loadTestResource(resourcePath) {
  return readFile(path.join(RESOURCE_ROOT, normalizeRelativePath(resourcePath)), "utf8");
}

async function writeProjectFile(rootDir, relativePath, content) {
  const filePath = path.join(rootDir, normalizeRelativePath(relativePath));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function listRelativeFiles(rootDir, currentDir = rootDir) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const relativePaths = [];

  for (const entry of entries) {
    const entryPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      relativePaths.push(...(await listRelativeFiles(rootDir, entryPath)));
      continue;
    }

    relativePaths.push(path.relative(rootDir, entryPath).split(path.sep).join("/"));
  }

  return relativePaths.sort((left, right) => left.localeCompare(right));
}

function normalizeRelativePath(relativePath) {
  return relativePath.split("\\").join("/");
}
