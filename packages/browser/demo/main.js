import { createFluxelBrowserRenderer } from "../src/index.js";
import { loadFluxelWasm } from "./wasm-loader.js";

const canvas = document.querySelector("canvas");
const renderer = createFluxelBrowserRenderer({ canvas, wasm: await loadFluxelWasm() });
const contextLossExtension = canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context");
renderer.start();

function readPixel(gl, canvas, normalizedX, normalizedY) {
  const pixel = new Uint8Array(4);
  const x = Math.min(canvas.width - 1, Math.max(0, Math.floor(canvas.width * normalizedX)));
  const y = Math.min(canvas.height - 1, Math.max(0, Math.floor(canvas.height * normalizedY)));
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  return [...pixel];
}

async function snapshot() {
  const gl = canvas.getContext("webgl2");
  const drawable = canvas.width > 0 && canvas.height > 0 && !gl?.isContextLost()
    && document.visibilityState !== "hidden";
  let report = null;
  for (let attempt = 0; drawable && report?.outcome !== "submitted" && attempt < 8; attempt += 1) {
    report = renderer.lastFrameReport();
    if (report?.outcome === "submitted") break;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  const blocked = !drawable && report === null;
  const keyColors = drawable ? [
    { name: "clear", expected: [0, 0, 0, 255], actual: readPixel(gl, canvas, 0.05, 0.05) },
    { name: "red", expected: [255, 0, 0, 255], actual: readPixel(gl, canvas, 0.275, 0.325) },
    { name: "green", expected: [0, 255, 0, 255], actual: readPixel(gl, canvas, 0.725, 0.325) },
    { name: "blue", expected: [0, 89, 255, 255], actual: readPixel(gl, canvas, 0.5, 0.71) },
  ] : [];
  // CONTEXT_LOST_WEBGL is the expected blocked-state sentinel, not a draw error.
  const webglError = drawable ? (gl?.getError() ?? 0) : 0;
  return Object.freeze({
    report: blocked ? null : report,
    blocked,
    diagnostics: renderer.diagnosticsSnapshot(),
    errors: webglError === 0 ? [] : [`WebGL error 0x${webglError.toString(16)}`],
    keyColors,
    pixelWidth: canvas.width,
    pixelHeight: canvas.height,
    extent: { width: canvas.width, height: canvas.height },
  });
}

// This intentionally lives only on the demo window. It is a narrow evidence
// harness, not a package export or an application SDK.
window.__fluxelEvidence = Object.freeze({
  async ready() {
    renderer.resize();
    renderer.resume();
  },
  snapshot,
  resize(width, height) {
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    return renderer.resize();
  },
  loseContext() {
    const observed = new Promise((resolve) => canvas.addEventListener("webglcontextlost", resolve, { once: true }));
    if (!contextLossExtension) throw new Error("WEBGL_lose_context is required for the Stage 2 evidence harness");
    contextLossExtension.loseContext();
    return observed;
  },
  restoreContext() {
    const observed = new Promise((resolve) => canvas.addEventListener("webglcontextrestored", resolve, { once: true }));
    if (!contextLossExtension) throw new Error("WEBGL_lose_context is required for the Stage 2 evidence harness");
    contextLossExtension.restoreContext();
    return observed;
  },
  setVisibleForTest(visible) {
    // Browser visibility is not writable. Dispatching the same DOM event uses
    // the adapter's production reducer rather than a test-only lifecycle path.
    Object.defineProperty(document, "visibilityState", { configurable: true, value: visible ? "visible" : "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  },
  dispose() {
    return renderer.dispose();
  },
});
