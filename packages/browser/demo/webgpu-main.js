import { createFluxelWebGpuBrowserRenderer } from "../src/index.js";
import { loadFluxelWasm } from "./wasm-loader.js";

const canvas = document.querySelector("canvas");
const wasm = await loadFluxelWasm();
let session;
// Capture the otherwise-private session only inside this proof harness. The
// package adapter still receives and drives the production wasm contract.
const evidenceWasm = {
  WebGpuSession: {
    async create(target) {
      session = await wasm.WebGpuSession.create(target);
      return session;
    },
  },
};
const renderer = await createFluxelWebGpuBrowserRenderer({ canvas, wasm: evidenceWasm });
renderer.start();

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

async function waitForState(expected) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const facts = session.backend_snapshot();
    if (facts.state === expected) return facts;
    await nextFrame();
  }
  throw new Error(`timed out waiting for WebGPU state ${expected}`);
}

const keyColorOracle = Object.freeze([
  { name: "clear", expected: [0, 0, 0, 255], normalized: [0.05, 0.05] },
  { name: "red", expected: [255, 0, 0, 255], normalized: [0.275, 0.675] },
  { name: "green", expected: [0, 255, 0, 255], normalized: [0.725, 0.675] },
  { name: "blue", expected: [0, 89, 255, 255], normalized: [0.5, 0.29] },
]);

async function snapshot() {
  const facts = session.backend_snapshot();
  const drawable = canvas.width > 0 && canvas.height > 0
    && facts.state === "Active" && document.visibilityState !== "hidden";
  let report = null;
  for (let attempt = 0; drawable && report?.outcome !== "submitted" && attempt < 12; attempt += 1) {
    report = renderer.lastFrameReport();
    if (report?.outcome === "submitted") break;
    await nextFrame();
  }
  const blocked = !drawable && report === null;
  return Object.freeze({
    report: blocked ? null : report,
    blocked,
    diagnostics: renderer.diagnosticsSnapshot(),
    errors: [],
    // WebGPU canvas serialization is not a stable readback oracle. The Python
    // runner samples these coordinates from Chrome's compositor screenshot.
    keyColors: drawable ? keyColorOracle : [],
    pixelWidth: canvas.width,
    pixelHeight: canvas.height,
    extent: { width: canvas.width, height: canvas.height },
    canvasRectCss: canvas.getBoundingClientRect().toJSON(),
    backend: session.backend_snapshot(),
  });
}

window.__fluxelEvidence = Object.freeze({
  async ready() {
    // Factory construction performs the initial DPR resize and start already
    // owns the RAF. Readiness must not create a second lifecycle transition.
  },
  snapshot,
  resize(width, height) {
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    return renderer.resize();
  },
  async loseDevice() {
    renderer.suspend("evidence-device-loss");
    session.controlled_destroy_for_evidence();
    return waitForState("Lost");
  },
  async recoverDevice() {
    // Resume the sole adapter RAF. Its first Lost outcome must drive the
    // production adapter's cached recovery path; evidence must not bypass it
    // by calling the otherwise-private Rust session directly.
    renderer.resume();
    return waitForState("Active");
  },
  setVisibleForTest(visible) {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: visible ? "visible" : "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  },
  environment() {
    return session.backend_snapshot();
  },
  dispose() {
    return renderer.dispose();
  },
});
