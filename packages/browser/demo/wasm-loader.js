// Evidence tooling stages the generated wasm-bindgen package at this relative
// path. Keeping loading here makes the proof harness replaceable, while the
// published adapter remains only an explicit dependency-injected façade.
export async function loadFluxelWasm() {
  const wasm = await import("./wasm/fluxel_rendering_wasm.js");
  if (typeof wasm.default === "function") await wasm.default();
  return wasm;
}
