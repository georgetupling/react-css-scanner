#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.argv[2];

if (!ROOT_DIR) {
  console.error("Error: directory argument required");
  process.exit(1);
}

const MAX_DEPTH = 6;

const ALLOWED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".html", ".css"]);

const TMP_DIR = path.resolve("tmp");
fs.mkdirSync(TMP_DIR, { recursive: true });

const dirName = path.basename(path.resolve(ROOT_DIR));
const safeDirName = dirName.replace(/[^a-z0-9-_]/gi, "_");

const DEFAULT_OUTPUT = path.join(TMP_DIR, `scan-dump-${safeDirName}-${Date.now()}.txt`);

const OUTPUT_FILE = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_OUTPUT;

const output = fs.createWriteStream(OUTPUT_FILE, { flags: "w" });

function walk(dir, depth = 0) {
  if (depth > MAX_DEPTH) return;

  let entries;

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        entry.name === "dist" ||
        entry.name === "build" ||
        entry.name === "tmp"
      ) {
        continue;
      }

      walk(fullPath, depth + 1);
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) continue;

    let content;

    try {
      content = fs.readFileSync(fullPath, "utf8");
    } catch {
      continue;
    }

    output.write(`===== FILE: ${fullPath} =====\n\n`);
    output.write(content);
    output.write("\n\n\n");
  }
}

walk(path.resolve(ROOT_DIR));

output.end(() => {
  console.log(`Dump written to ${OUTPUT_FILE}`);
});
