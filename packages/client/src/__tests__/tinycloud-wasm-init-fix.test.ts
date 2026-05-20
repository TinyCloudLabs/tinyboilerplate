import { describe, expect, test } from "bun:test";

import { patchTinyCloudWasmInit } from "../../scripts/fix-web-wasm-init.mjs";

describe("patchTinyCloudWasmInit", () => {
  test("wraps the bundled web-sdk wasm module in the object-shaped initializer", () => {
    const input =
      'return function(A){return Y=A.exports,s=null,a=null,Y}(C)}(function(A,g,I,Q){return E(i,Q,!1)}(0,0,"wasm",void 0)).then(function(){Y.initPanicHook()});';

    const result = patchTinyCloudWasmInit(input);

    expect(result.changed).toBe(true);
    expect(result.content).toContain(
      "return function(A){return Y=A.exports,s=null,a=null,Y}(C)}({module_or_path:function(A,g,I,Q){",
    );
    expect(result.content).toContain('}(0,0,"wasm",void 0)}).then(function(){Y.initPanicHook()});');
  });

  test("wraps the direct web-sdk-wasm module in the object-shaped initializer", () => {
    const input = `var initialized = __wbg_init(wasm()).then(function () {
    return initPanicHook();
});`;

    const result = patchTinyCloudWasmInit(input);

    expect(result.changed).toBe(true);
    expect(result.content).toContain(
      "var initialized = __wbg_init({ module_or_path: wasm() }).then(function () {",
    );
  });
});
