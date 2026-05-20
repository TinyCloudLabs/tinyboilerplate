/**
 * Patch TinyCloud's generated browser WASM initializer to use the current
 * wasm-bindgen object-shaped init API. The published @tinycloud/web-sdk bundle
 * still calls the initializer with the compiled module directly, which emits:
 * "using deprecated parameters for the initialization function; pass a single object instead"
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { dirname, resolve } from "path";
import { pathToFileURL } from "url";

const require = createRequire(import.meta.url);

const bundledWebSdkStart =
  "return function(A){return Y=A.exports,s=null,a=null,Y}(C)}(function(A,g,I,Q){";
const bundledWebSdkStartPatched =
  "return function(A){return Y=A.exports,s=null,a=null,Y}(C)}({module_or_path:function(A,g,I,Q){";
const bundledWebSdkEnd = "void 0)).then(function(){Y.initPanicHook()});";
const bundledWebSdkEndPatched = "void 0)}).then(function(){Y.initPanicHook()});";

const directWasmInit = `var initialized = __wbg_init(wasm()).then(function () {
    return initPanicHook();
});`;
const directWasmInitPatched = `var initialized = __wbg_init({ module_or_path: wasm() }).then(function () {
    return initPanicHook();
});`;

export function patchTinyCloudWasmInit(content) {
  let patched = content;

  if (patched.includes(bundledWebSdkStart) && patched.includes(bundledWebSdkEnd)) {
    patched = patched
      .replace(bundledWebSdkStart, bundledWebSdkStartPatched)
      .replace(bundledWebSdkEnd, bundledWebSdkEndPatched);
  }

  if (patched.includes(directWasmInit)) {
    patched = patched.replace(directWasmInit, directWasmInitPatched);
  }

  return {
    content: patched,
    changed: patched !== content,
  };
}

function resolvePackageJson(packageName, resolver = require) {
  try {
    return resolver.resolve(`${packageName}/package.json`);
  } catch {
    return null;
  }
}

function resolvePackageFile(packageName, relativePath, resolver = require) {
  const packageJson = resolvePackageJson(packageName, resolver);
  return packageJson ? resolve(dirname(packageJson), relativePath) : null;
}

function patchFile(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return "missing";
  }

  const content = readFileSync(filePath, "utf8");
  const result = patchTinyCloudWasmInit(content);
  if (!result.changed) {
    return "unchanged";
  }

  writeFileSync(filePath, result.content, "utf8");
  return "patched";
}

export function patchInstalledTinyCloudWebSdk() {
  const webSdkPackageJson = resolvePackageJson("@tinycloud/web-sdk");
  const webSdkRequire = webSdkPackageJson ? createRequire(webSdkPackageJson) : require;

  return [
    resolvePackageFile("@tinycloud/web-sdk", "dist/index.mjs"),
    resolvePackageFile("@tinycloud/web-sdk", "dist/index.cjs"),
    resolvePackageFile("@tinycloud/web-sdk-wasm", "dist/index.js", webSdkRequire),
  ].map((filePath) => ({
    filePath,
    status: patchFile(filePath),
  }));
}

function main() {
  for (const { filePath, status } of patchInstalledTinyCloudWebSdk()) {
    if (status === "patched") {
      console.log(`[fix-web-wasm-init] Patched: ${filePath}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
