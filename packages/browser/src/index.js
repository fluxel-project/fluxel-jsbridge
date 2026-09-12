/**
 * The browser adapter owns DOM lifecycle reduction and the single RAF loop.
 * It deliberately does not expose scene, GPU, input, or host abstractions.
 */

function requireSession(wasm, canvas) {
  if (wasm && typeof wasm.createSession === "function") {
    return wasm.createSession(canvas);
  }

  // The released wasm-bindgen package is expected to expose this primary form.
  if (wasm?.WebGl2Session && typeof wasm.WebGl2Session.new === "function") {
    return wasm.WebGl2Session.new(canvas);
  }

  // This also accepts wasm-bindgen's constructor export without changing the
  // browser-facing contract or inventing a second renderer implementation.
  if (typeof wasm?.WebGl2Session === "function") {
    return new wasm.WebGl2Session(canvas);
  }

  throw new TypeError(
    "wasm must provide WebGl2Session.new(canvas), WebGl2Session(canvas), or createSession(canvas)",
  );
}

function nonNegativePixel(value) {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : 0;
}

function canvasCssExtent(canvas) {
  const rect = canvas.getBoundingClientRect?.();
  return {
    width: rect?.width ?? canvas.clientWidth ?? canvas.width ?? 0,
    height: rect?.height ?? canvas.clientHeight ?? canvas.height ?? 0,
  };
}

/**
 * Creates one explicit Fluxel WASM session for `canvas`.
 *
 * `wasm` is the generated `fluxel-rendering-wasm` module (or an equivalent
 * injected module in a contract test). The adapter never creates WebGL state;
 * it only forwards lifecycle calls and makes the canvas drawing-buffer extent
 * match CSS pixels multiplied by the current device pixel ratio.
 */
export function createFluxelBrowserRenderer({ canvas, wasm }) {
  if (!canvas || typeof canvas.addEventListener !== "function") {
    throw new TypeError("canvas must be an EventTarget-like HTMLCanvasElement");
  }

  const session = requireSession(wasm, canvas);
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

  const isVisible = () => documentTarget?.visibilityState !== "hidden";
  const shouldTick = () => !disposed && wanted && !manuallySuspended && !contextLost && drawable && isVisible();

  const cancelFrame = () => {
    if (frameRequest !== null) {
      globalThis.cancelAnimationFrame?.(frameRequest);
      frameRequest = null;
    }
  };

  const scheduleFrame = () => {
    if (!shouldTick() || frameRequest !== null) return;
    if (typeof globalThis.requestAnimationFrame !== "function") {
      throw new Error("requestAnimationFrame is required by the Fluxel browser adapter");
    }
    frameRequest = globalThis.requestAnimationFrame(() => {
      frameRequest = null;
      if (!shouldTick()) return;
      const report = session.render_once();
      lastReport = report;
      // Bounded GPU work may ask the sole RAF owner to try again next frame.
      // It is a structured normal outcome, unlike a thrown renderer failure.
      if (report?.outcome === "backpressure") {
        scheduleFrame();
        return;
      }
      scheduleFrame();
    });
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
    const report = session.resize(canvas.width, canvas.height);
    lastReport = null;
    if (drawable) scheduleFrame();
    else cancelFrame();
    return report;
  };

  const onVisibilityChange = () => {
    if (disposed || contextLost || manuallySuspended) return;
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
    // The Rust session must finish rebuilding its generation before any RAF
    // can submit work again.
    session.context_restored();
    lastReport = null;
    contextLost = false;
    if (!manuallySuspended && isVisible()) {
      session.resume();
      scheduleFrame();
    }
  };

  const onWindowResize = () => resize();
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);
  documentTarget?.addEventListener?.("visibilitychange", onVisibilityChange);

  if (typeof globalThis.ResizeObserver === "function") {
    observer = new globalThis.ResizeObserver(() => resize());
    observer.observe(canvas);
  } else {
    // Chrome has ResizeObserver; this fallback only retains explicit resize
    // behavior for embedders with a smaller DOM implementation.
    windowTarget.addEventListener?.("resize", onWindowResize);
  }

  resize();

  return Object.freeze({
    start() {
      if (disposed) return disposal;
      wanted = true;
      scheduleFrame();
    },
    resize,
    renderOnce() {
      // Once RAF owns submission this becomes observation-only, so callers
      // cannot create a second producer of GPU work.
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
      // Reasons are adapter-local observability only; the closed Rust session
      // deliberately has a parameterless suspend transition.
      return session.suspend();
    },
    resume() {
      if (disposed) return disposal;
      manuallySuspended = false;
      const report = session.resume();
      lastReport = null;
      scheduleFrame();
      return report;
    },
    diagnosticsSnapshot() {
      // Deliberately no filtering, console formatting, draining, or JS records.
      return session.diagnostics_snapshot();
    },
    dispose() {
      if (disposed) return disposal;
      disposed = true;
      cancelFrame();
      observer?.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      documentTarget?.removeEventListener?.("visibilitychange", onVisibilityChange);
      windowTarget.removeEventListener?.("resize", onWindowResize);
      disposal = session.dispose();
      return disposal;
    },
  });
}
