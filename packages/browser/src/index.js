/** Browser adapters own DOM lifecycle reduction and the sole RAF producer. */

function requireWebGlSession(wasm, canvas) {
  if (wasm && typeof wasm.createSession === "function") return wasm.createSession(canvas);
  if (wasm?.WebGl2Session && typeof wasm.WebGl2Session.new === "function") return wasm.WebGl2Session.new(canvas);
  if (typeof wasm?.WebGl2Session === "function") return new wasm.WebGl2Session(canvas);
  throw new TypeError("wasm must provide WebGl2Session.new(canvas), WebGl2Session(canvas), or createSession(canvas)");
}

async function requireWebGpuSession(wasm, canvas) {
  // The injected form exists only for DOM contract tests. Production bindings
  // intentionally have one async wasm-bindgen entry point.
  if (wasm && typeof wasm.createWebGpuSession === "function") return wasm.createWebGpuSession(canvas);
  if (wasm?.WebGpuSession && typeof wasm.WebGpuSession.create === "function") return wasm.WebGpuSession.create(canvas);
  throw new TypeError("wasm must provide WebGpuSession.create(canvas) or createWebGpuSession(canvas)");
}

function nonNegativePixel(value) {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : 0;
}

function canvasCssExtent(canvas) {
  const rect = canvas.getBoundingClientRect?.();
  return { width: rect?.width ?? canvas.clientWidth ?? canvas.width ?? 0, height: rect?.height ?? canvas.clientHeight ?? canvas.height ?? 0 };
}

// Private shared DOM reducer; it is intentionally not a JS rendering API.
function createDomAdapter({ canvas, session, kind }) {
  if (!canvas || typeof canvas.addEventListener !== "function") throw new TypeError("canvas must be an EventTarget-like HTMLCanvasElement");
  const isWebGpu = kind === "webgpu";
  const documentTarget = globalThis.document;
  const windowTarget = globalThis;
  let frameRequest = null;
  let disposed = false;
  let wanted = false;
  let manuallySuspended = false;
  let contextLost = false;
  let drawable = true;
  let observer;
  let disposal;
  let lastReport = null;
  let recoveryPending = null;
  let recoveryError = null;
  let lifecycleToken = 0;

  const isVisible = () => documentTarget?.visibilityState !== "hidden";
  const shouldTick = () => !disposed && !recoveryPending && !recoveryError && wanted && !manuallySuspended && !contextLost && drawable && isVisible();
  const cancelFrame = () => {
    if (frameRequest !== null) {
      globalThis.cancelAnimationFrame?.(frameRequest);
      frameRequest = null;
    }
  };
  const scheduleFrame = () => {
    if (!shouldTick() || frameRequest !== null) return;
    if (typeof globalThis.requestAnimationFrame !== "function") throw new Error("requestAnimationFrame is required by the Fluxel browser adapter");
    frameRequest = globalThis.requestAnimationFrame(() => {
      frameRequest = null;
      if (!shouldTick()) return;
      const report = session.render_once();
      lastReport = report;
      if (isWebGpu && report?.outcome === "device-lost") {
        beginRecovery();
        return;
      }
      scheduleFrame();
    });
  };
  const beginRecovery = () => {
    if (!isWebGpu || disposed || recoveryPending) return recoveryPending;
    cancelFrame();
    const token = ++lifecycleToken;
    recoveryError = null;
    // Cache before invoking the async path, so lifecycle interleavings cannot
    // make a second recover producer.
    recoveryPending = Promise.resolve().then(() => session.recover());
    recoveryPending = recoveryPending.then(
      (result) => {
        if (token === lifecycleToken && !disposed) recoveryPending = null;
        return result;
      },
      (error) => {
        if (token === lifecycleToken && !disposed) {
          recoveryPending = null;
          recoveryError = error;
        }
        throw error;
      },
    );
    // RAF has no promise consumer. Keep the Rust error structured and
    // observable via renderOnce() without creating an unhandled rejection.
    recoveryPending.catch(() => {});
    recoveryPending.then(() => {
      if (token === lifecycleToken && !disposed) scheduleFrame();
    }, () => {});
    return recoveryPending;
  };
  const resize = () => {
    if (disposed) return session.resize(0, 0);
    const css = canvasCssExtent(canvas);
    const dpr = Number(globalThis.devicePixelRatio) || 1;
    const width = nonNegativePixel(css.width * dpr);
    const height = nonNegativePixel(css.height * dpr);
    drawable = width > 0 && height > 0;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    // During recovery Rust only coalesces desired extent; no RAF may be made.
    const report = session.resize(canvas.width, canvas.height);
    lastReport = null;
    if (drawable) scheduleFrame(); else cancelFrame();
    return report;
  };
  const onVisibilityChange = () => {
    if (disposed || contextLost || manuallySuspended) return;
    // Rust owns the Recovering transition. Visibility only changes the DOM
    // predicate until that transition has settled; it must not become a second
    // lifecycle producer by calling resume/suspend into a rebuilding session.
    if (recoveryPending) return;
    if (isVisible()) {
      session.resume();
      lastReport = null;
      scheduleFrame();
    } else {
      cancelFrame();
      session.suspend();
    }
  };
  const onContextLost = (event) => {
    event.preventDefault();
    if (disposed || contextLost) return;
    contextLost = true;
    lastReport = null;
    cancelFrame();
    session.context_lost();
  };
  const onContextRestored = () => {
    if (disposed || !contextLost) return;
    session.context_restored();
    lastReport = null;
    contextLost = false;
    if (!manuallySuspended && isVisible()) {
      session.resume();
      scheduleFrame();
    }
  };
  const onWindowResize = () => resize();

  if (!isWebGpu) {
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);
  }
  documentTarget?.addEventListener?.("visibilitychange", onVisibilityChange);
  if (typeof globalThis.ResizeObserver === "function") {
    observer = new globalThis.ResizeObserver(() => resize());
    observer.observe(canvas);
  } else windowTarget.addEventListener?.("resize", onWindowResize);
  resize();

  return Object.freeze({
    start() {
      if (disposed) return disposal;
      wanted = true;
      scheduleFrame();
    },
    resize,
    renderOnce() {
      if (recoveryError) throw recoveryError;
      if (wanted) {
        if (!shouldTick()) return Object.freeze({ outcome: "blocked" });
        return lastReport;
      }
      return session.render_once();
    },
    suspend(_reason = "manual") {
      if (disposed) return disposal;
      manuallySuspended = true;
      cancelFrame();
      // An async WebGPU recovery owns no JS producer, but its Rust operation
      // is still settling. Keep the desired manual state locally and let the
      // recovery token/final predicate suppress RAF; do not create a competing
      // lifecycle operation against the recovering session.
      if (recoveryPending) return undefined;
      return session.suspend();
    },
    resume() {
      if (disposed) return disposal;
      manuallySuspended = false;
      if (recoveryPending) return undefined;
      const report = session.resume();
      lastReport = null;
      scheduleFrame();
      return report;
    },
    diagnosticsSnapshot() { return session.diagnostics_snapshot(); },
    dispose() {
      if (disposed) return disposal;
      disposed = true;
      ++lifecycleToken;
      cancelFrame();
      observer?.disconnect();
      if (!isWebGpu) {
        canvas.removeEventListener("webglcontextlost", onContextLost);
        canvas.removeEventListener("webglcontextrestored", onContextRestored);
      }
      documentTarget?.removeEventListener?.("visibilitychange", onVisibilityChange);
      windowTarget.removeEventListener?.("resize", onWindowResize);
      // No async wrapper: repeat calls need exact cached Promise identity.
      disposal = isWebGpu ? Promise.resolve(session.dispose()) : session.dispose();
      return disposal;
    },
  });
}

/** Creates one explicit synchronous WebGL2 Fluxel WASM session for `canvas`. */
export function createFluxelBrowserRenderer({ canvas, wasm }) {
  return createDomAdapter({ canvas, session: requireWebGlSession(wasm, canvas), kind: "webgl2" });
}

/** Creates one explicit async WebGPU Fluxel WASM session for `canvas`. */
export async function createFluxelWebGpuBrowserRenderer({ canvas, wasm }) {
  if (!canvas || typeof canvas.addEventListener !== "function") throw new TypeError("canvas must be an EventTarget-like HTMLCanvasElement");
  const session = await requireWebGpuSession(wasm, canvas);
  return createDomAdapter({ canvas, session, kind: "webgpu" });
}
