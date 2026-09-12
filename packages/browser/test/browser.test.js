import assert from "node:assert/strict";
import test from "node:test";
import { createFluxelBrowserRenderer, createFluxelWebGpuBrowserRenderer } from "../src/index.js";

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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function settlePromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

function fakeWebGpuWasm(calls, recovery) {
  const session = {
    resize(width, height) { calls.push(["resize", width, height]); },
    render_once() { calls.push(["render"]); return { outcome: "submitted" }; },
    suspend() { calls.push(["suspend"]); },
    resume() { calls.push(["resume"]); },
    recover() { calls.push(["recover"]); return recovery.promise; },
    diagnostics_snapshot() { return []; },
    dispose() { calls.push(["dispose"]); return Promise.resolve({ state: "disposed" }); },
  };
  return { WebGpuSession: { async create(canvas) { calls.push(["create", canvas]); return session; } }, session };
}

test("reports CSS/DPR extent to Rust/WASM and owns one idempotent RAF loop", () => {
  const browser = installBrowser();
  try {
    const calls = [];
    const canvas = fakeCanvas();
    const adapter = createFluxelBrowserRenderer({ canvas, wasm: fakeWasm(calls) });
    assert.deepEqual(calls.slice(0, 2), [["create", canvas], ["resize", 200, 100]]);
    assert.equal(canvas.width, 100);
    assert.equal(canvas.height, 50);

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

test("requestFrame is a one-shot command and lastFrameReport is a pure query", () => {
  const browser = installBrowser();
  try {
    const calls = [];
    const canvas = fakeCanvas();
    const adapter = createFluxelBrowserRenderer({ canvas, wasm: fakeWasm(calls) });
    assert.deepEqual(adapter.lastFrameReport(), null);
    assert.deepEqual(adapter.requestFrame(), { outcome: "scheduled" });
    assert.equal(browser.pending.size, 1);
    assert.equal(calls.filter(([kind]) => kind === "render").length, 0);
    browser.runOneFrame();
    assert.equal(calls.filter(([kind]) => kind === "render").length, 1);
    assert.deepEqual(adapter.lastFrameReport(), { frame: 1 });
    assert.equal(browser.pending.size, 0);

    adapter.start();
    assert.deepEqual(adapter.requestFrame(), { outcome: "already-running" });
    assert.equal(calls.filter(([kind]) => kind === "render").length, 1);

    adapter.suspend();
    assert.deepEqual(adapter.requestFrame(), { outcome: "blocked", reason: "suspended" });

    // Stop the continuous producer, then verify an unavailable one-shot has a
    // structured outcome and never becomes a query or direct submission.
    const stopped = createFluxelBrowserRenderer({ canvas: fakeCanvas(), wasm: fakeWasm(calls) });
    stopped.suspend();
    assert.deepEqual(stopped.requestFrame(), { outcome: "blocked", reason: "suspended" });
    browser.documentTarget.visibilityState = "hidden";
    assert.deepEqual(stopped.requestFrame(), { outcome: "blocked", reason: "suspended" });
  } finally { browser.restore(); }
});

test("WebGPU recovery has one producer, coalesces lifecycle events, and registers no WebGL listeners", async () => {
  const browser = installBrowser();
  try {
    const calls = [];
    const recovery = deferred();
    const canvas = fakeCanvas();
    const wasm = fakeWebGpuWasm(calls, recovery);
    wasm.session.render_once = () => { calls.push(["render", "lost"]); return { outcome: "device-lost" }; };
    const adapter = await createFluxelWebGpuBrowserRenderer({ canvas, wasm });
    assert.equal(canvas.count("webglcontextlost"), 0);
    assert.equal(canvas.count("webglcontextrestored"), 0);
    adapter.start();
    browser.runOneFrame();
    await Promise.resolve();
    assert.equal(calls.filter(([kind]) => kind === "recover").length, 1);
    assert.equal(browser.pending.size, 0);
    assert.deepEqual(adapter.requestFrame(), { outcome: "blocked", reason: "recovering" });

    canvas.clientWidth = 140;
    browser.resize();
    browser.documentTarget.visibilityState = "hidden";
    browser.documentTarget.dispatch("visibilitychange");
    browser.documentTarget.visibilityState = "visible";
    browser.documentTarget.dispatch("visibilitychange");
    adapter.suspend("during-recovery");
    adapter.resume();
    adapter.start();
    assert.equal(browser.pending.size, 0);
    assert.equal(calls.filter(([kind]) => kind === "recover").length, 1);
    assert.equal(calls.filter(([kind]) => kind === "resume").length, 0);
    assert.equal(calls.filter(([kind]) => kind === "suspend").length, 0);

    recovery.resolve({ state: "ready" });
    await settlePromises();
    assert.equal(browser.pending.size, 1);
    assert.deepEqual(calls.filter(([kind]) => kind === "resize").at(-1), ["resize", 280, 100]);
  } finally { browser.restore(); }
});

test("WebGPU disposal caches one Promise and stale recovery cannot revive RAF", async () => {
  const browser = installBrowser();
  try {
    const calls = [];
    const recovery = deferred();
    const canvas = fakeCanvas();
    const wasm = fakeWebGpuWasm(calls, recovery);
    wasm.session.render_once = () => ({ outcome: "device-lost" });
    const adapter = await createFluxelWebGpuBrowserRenderer({ canvas, wasm });
    adapter.start();
    browser.runOneFrame();
    await Promise.resolve();
    const first = adapter.dispose();
    const second = adapter.dispose();
    assert.strictEqual(first, second);
    assert.deepEqual(adapter.requestFrame(), { outcome: "terminal", reason: "disposed" });
    assert.equal(canvas.count("webglcontextlost"), 0);
    assert.equal(browser.documentTarget.count("visibilitychange"), 0);
    recovery.resolve({ state: "ready" });
    await settlePromises();
    await first;
    assert.equal(browser.pending.size, 0);
    assert.equal(calls.filter(([kind]) => kind === "recover").length, 1);
  } finally { browser.restore(); }
});

test("WebGPU recovery failure remains observable and stops submission", async () => {
  const browser = installBrowser();
  try {
    const calls = [];
    const recovery = deferred();
    const wasm = fakeWebGpuWasm(calls, recovery);
    wasm.session.render_once = () => ({ outcome: "device-lost" });
    const adapter = await createFluxelWebGpuBrowserRenderer({ canvas: fakeCanvas(), wasm });
    adapter.start();
    browser.runOneFrame();
    await Promise.resolve();
    const failure = new Error("recover failed");
    recovery.reject(failure);
    await settlePromises();
    assert.equal(browser.pending.size, 0);
    const terminal = adapter.requestFrame();
    assert.deepEqual(terminal, { outcome: "terminal", reason: "recovery-failed", error: failure });
    assert.strictEqual(terminal.error, failure);
    adapter.resume();
    adapter.resize();
    adapter.start();
    await settlePromises();
    assert.equal(browser.pending.size, 0);
    assert.equal(calls.filter(([kind]) => kind === "recover").length, 1);
    assert.strictEqual(adapter.requestFrame().error, failure);
  } finally { browser.restore(); }
});

test("WebGPU factory propagates async Rust initialization rejection without DOM listeners", async () => {
  const browser = installBrowser();
  try {
    const canvas = fakeCanvas();
    const failure = new Error("no adapter");
    await assert.rejects(
      createFluxelWebGpuBrowserRenderer({
        canvas,
        wasm: { WebGpuSession: { create: async () => { throw failure; } } },
      }),
      failure,
    );
    assert.equal(canvas.count("webglcontextlost"), 0);
    assert.equal(browser.documentTarget.count("visibilitychange"), 0);
  } finally { browser.restore(); }
});
