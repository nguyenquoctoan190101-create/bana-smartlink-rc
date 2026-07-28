import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";

const rootRequire = createRequire(import.meta.url);
const openapiPackagePath = rootRequire.resolve("openapi-typescript/package.json");
const openapiRequire = createRequire(openapiPackagePath);
const redoclyPackagePath = openapiRequire.resolve(
  "@redocly/openapi-core/package.json",
);
const redoclyRequire = createRequire(redoclyPackagePath);
const minimatchPackagePath = redoclyRequire.resolve("minimatch/package.json");
const minimatchRequire = createRequire(minimatchPackagePath);
const braceExpansionPath = minimatchRequire.resolve("brace-expansion");
const braceExpansionModule = minimatchRequire(braceExpansionPath);

// minimatch@5 expects the legacy callable export. brace-expansion@5.0.8 fixes
// CVE-2026-14257 and exposes `expand` as a named export instead. Present both
// interfaces in this process so the current OpenAPI generator can use the
// patched dependency without downgrading its own major version.
if (typeof braceExpansionModule !== "function") {
  if (typeof braceExpansionModule.expand !== "function") {
    throw new TypeError("brace-expansion does not expose an expand function");
  }
  const callableBraceExpansion = (...args) =>
    braceExpansionModule.expand(...args);
  Object.assign(callableBraceExpansion, braceExpansionModule);
  const cachedBraceExpansion = minimatchRequire.cache[braceExpansionPath];
  if (!cachedBraceExpansion) {
    throw new Error("brace-expansion was not loaded into the CommonJS cache");
  }
  cachedBraceExpansion.exports = callableBraceExpansion;
}

const { createConfig } = redoclyRequire("@redocly/openapi-core");
const { default: openapiTS, astToString, COMMENT_HEADER } =
  await import("openapi-typescript");

const redocly = await createConfig({}, { extends: ["minimal"] });
const schemaUrl = new URL("../docs/openapi.json", import.meta.url);
const outputUrl = new URL("../src/generated/openapi.ts", import.meta.url);
const schemaAst = await openapiTS(schemaUrl, { redocly });

await writeFile(outputUrl, `${COMMENT_HEADER}${astToString(schemaAst)}`, "utf8");
