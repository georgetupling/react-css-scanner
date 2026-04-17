import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  unbundle: true,
  external: ["typescript"],
  inputOptions(options) {
    const defineValues =
      typeof options.define === "object" && options.define !== null ? options.define : undefined;

    if (defineValues) {
      options.transform = {
        ...options.transform,
        define: defineValues,
      };
    }

    delete options.define;
    delete options.inject;
    return options;
  },
});
