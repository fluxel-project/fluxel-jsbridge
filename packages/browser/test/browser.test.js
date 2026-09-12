import assert from "node:assert/strict";
import test from "node:test";
import { createFluxelBrowserRenderer } from "../src/index.js";

class Target {
  #listeners = new Map();
  addEventListener(type, listener) {
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }
  removeEventListener(type, listener) {
    this.#listeners.get(type)?.delete(listener);
  }
  dispatch(type, event = {}) {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }
  count(type) { return this.#listeners.get(type)?.size ?? 0; }
}

function installBrowser() {
  const saved = {
    document: globalThis.document,
    devicePixelRatio: globalThis.devicePixelRatio,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    ResizeObserver: globalThis.ResizeObserver,
  };
  const documentTarget = new Target();
  documentTarget.visibilityState = "visible";
  const pending = new Map();
  let nextFrame = 1;
  let resizeObserver;
  globalThis.document = documentTarget;
  globalThis.devicePixelRatio = 2;
  globalThis.requestAnimationFrame = (callback) => {
    const id = nextFrame++;
    pending.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => pending.delete(id);
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; resizeObserver = this; }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  };
  return {
    documentTarget,
    pending,
    resize() { resizeObserver.callback(); },
    runOneFrame() {
      const entry = pending.entries().next().value;
      if (!entry) return false;
      const [id, callback] = entry;
      pending.delete(id);
      callback(0);
      return true;
    },
    restore() { Object.assign(globalThis, saved); },
  };
}

function fakeCanvas(width = 100, height = 50) {
  const canvas = new Target();
  canvas.width = width;
  canvas.height = height;
  canvas.clientWidth = width;
  canvas.clientHeight = height;
  canvas.getBoundingClientRect = () => ({ width: canvas.clientWidth, height: canvas.clientHeight });
  return canvas;
}

function fakeWasm(calls) {
  const session = {
    resize(width, height) { calls.push(["resize", width, height]); return { width, height }; },
    render_once() { calls.push(["render"]); return { frame: calls.filter(([kind]) => kind === "render").length }; },
    suspend() { calls.push(["suspend"]); return { state: "suspended" }; },
    resume() { calls.push(["resume"]); return { state: "ready" }; },
    context_lost() { calls.push(["context_lost"]); },
    context_restored() { calls.push(["context_restored"]); },
    diagnostics_snapshot() { return Object.freeze([{ code: "RUST_ONLY" }]); },
    dispose() { calls.push(["dispose"]); return { state: "disposed" }; },
  };
  return { createSession(canvas) { calls.push(["create", canvas]); return session; } };
}

test("converts CSS/DPR extents and owns one idempotent RAF loop", () => {
  const browser = installBrowser();
  try {
    const calls = [];
    const canvas = fakeCanvas();
    const adapter = createFluxelBrowserRenderer({ canvas, wasm: fakeWasm(calls) });
    assert.deepEqual(calls.slice(0, 2), [["create", canvas], ["resize", 200, 100]]);
    assert.equal(canvas.width, 200);
    assert.equal(canvas.height, 100);

    adapter.start();
    adapter.start();
    assert.equal(browser.pending.size, 1);
    browser.runOneFrame();
    assert.equal(calls.filter(([kind]) => kind === "render").length, 1);
    assert.equal(browser.pending.size, 1);

    canvas.clientWidth = 150;
    browser.resize();
    assert.deepEqual(calls.at(-1), ["resize", 300, 100]);
  } finally { browser.restore(); }
});

test("context loss prevents default, stops RAF, and rebuilds before resuming", () => {
  const browser = installBrowser();
  try {
    const calls = [];
    const canvas = fakeCanvas();
    const adapter = createFluxelBrowserRenderer({ canvas, wasm: fakeWasm(calls) });
    adapter.start();
    let prevented = false;
    canvas.dispatch("webglcontextlost", { preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(browser.pending.size, 0);
    assert.deepEqual(calls.at(-1), ["context_lost"]);

    canvas.dispatch("webglcontextrestored");
    assert.deepEqual(calls.slice(-2), [["context_restored"], ["resume"]]);
    assert.equal(browser.pending.size, 1);
  } finally { browser.restore(); }
});

test("visibility, manual suspension, diagnostics forwarding, and disposal share one reducer", () => {
  const browser = installBrowser();
  try {
    const calls = [];
    const canvas = fakeCanvas();
    const adapter = createFluxelBrowserRenderer({ canvas, wasm: fakeWasm(calls) });
    adapter.start();
    browser.documentTarget.visibilityState = "hidden";
    browser.documentTarget.dispatch("visibilitychange");
    assert.deepEqual(calls.at(-1), ["suspend"]);
    assert.equal(browser.pending.size, 0);

    browser.documentTarget.visibilityState = "visible";
    browser.documentTarget.dispatch("visibilitychange");
    assert.deepEqual(calls.slice(-1), [["resume"]]);
    adapter.suspend("test");
    browser.documentTarget.dispatch("visibilitychange");
    assert.deepEqual(calls.at(-1), ["suspend"]);
    assert.deepEqual(adapter.diagnosticsSnapshot(), [{ code: "RUST_ONLY" }]);

    const result = adapter.dispose();
    assert.deepEqual(result, { state: "disposed" });
    assert.equal(canvas.count("webglcontextlost"), 0);
    assert.equal(browser.documentTarget.count("visibilitychange"), 0);
    assert.equal(adapter.dispose(), result);
  } finally { browser.restore(); }
});

test("a structured backpressure outcome preserves RAF ownership without hiding thrown failures", () => {
  const browser = installBrowser();
  try {
    const calls = [];
    const canvas = fakeCanvas();
    const wasm = fakeWasm(calls);
    const original = wasm.createSession;
    wasm.createSession = (target) => {
      const session = original(target);
      session.render_once = () => {
        calls.push(["render", "backpressure"]);
        return { outcome: "backpressure" };
      };
      return session;
    };
    const adapter = createFluxelBrowserRenderer({ canvas, wasm });
    adapter.start();
    browser.runOneFrame();
    assert.deepEqual(calls.at(-1), ["render", "backpressure"]);
    assert.equal(browser.pending.size, 1);
    adapter.suspend();

    const failingWasm = fakeWasm(calls);
    failingWasm.createSession = () => ({
      resize() {}, render_once() { throw new Error("renderer failure"); },
      suspend() {}, resume() {}, context_lost() {}, context_restored() {},
      diagnostics_snapshot() { return []; }, dispose() {},
    });
    const failing = createFluxelBrowserRenderer({ canvas: fakeCanvas(), wasm: failingWasm });
    failing.start();
    // The exception is intentionally observable rather than reclassified as
    // benign backpressure by the adapter.
    assert.throws(() => browser.runOneFrame(), /renderer failure/);
  } finally { browser.restore(); }
});

test("public renderOnce observes the last RAF report and reports blocked states without submitting", () => {
  const browser = installBrowser();
  try {
    const calls = [];
    const canvas = fakeCanvas();
    const adapter = createFluxelBrowserRenderer({ canvas, wasm: fakeWasm(calls) });
    adapter.start();
    browser.runOneFrame();
    const submitted = calls.filter(([kind]) => kind === "render").length;
    assert.equal(submitted, 1);
    assert.deepEqual(adapter.renderOnce(), { frame: 1 });
    assert.equal(calls.filter(([kind]) => kind === "render").length, submitted);

    adapter.suspend();
    assert.deepEqual(adapter.renderOnce(), { outcome: "blocked" });
    assert.equal(calls.filter(([kind]) => kind === "render").length, submitted);

    adapter.resume();
    browser.documentTarget.visibilityState = "hidden";
    browser.documentTarget.dispatch("visibilitychange");
    assert.deepEqual(adapter.renderOnce(), { outcome: "blocked" });
    assert.equal(calls.filter(([kind]) => kind === "render").length, submitted);
  } finally { browser.restore(); }
});
