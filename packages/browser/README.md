# `@fluxel/browser`

This ESM package is the Stage 2 browser lifecycle adapter, not a JavaScript
renderer or SDK core.

```js
import { createFluxelBrowserRenderer, createFluxelWebGpuBrowserRenderer } from "@fluxel/browser";

const renderer = createFluxelBrowserRenderer({ canvas, wasm });
renderer.start();
```

For the asynchronous WebGPU capsule, use the separately explicit factory:

```js
const renderer = await createFluxelWebGpuBrowserRenderer({ canvas, wasm });
renderer.start();
```

`wasm` is the `fluxel-rendering-wasm` generated module. The WebGL2 factory uses
`WebGl2Session.new(canvas)`; a wasm-bindgen constructor export and a test-only
`createSession(canvas)` factory are also accepted. That WebGL2 session provides
`resize`, `render_once`, parameterless `suspend`, `resume`, `context_lost`,
`context_restored`, `dispose`, and `diagnostics_snapshot`.

The adapter is the only submission-loop owner. JavaScript measures CSS size × DPR
and reports that desired extent to Rust/WASM; Rust/WASM is the only code allowed
to mutate the canvas drawing buffer. It stops before forwarding context loss,
resumes only after Rust reports restoration, removes every observer/listener/RAF
on dispose, and forwards diagnostics verbatim.

`requestFrame()` is a command which requests one future submission opportunity
only while the continuous loop is stopped. It never submits synchronously and
never becomes a query: `{ outcome: "scheduled" }`, `"already-running"`,
`"blocked"` with a reason, and terminal outcomes are explicit. `lastFrameReport()`
is a pure query and never submits or schedules work. `scheduled` means only
that the adapter accepted one opportunity; the eventual `submitted` or
`backpressure` report is read through `lastFrameReport()`. A terminal recovery
outcome retains the original error in its `error` field. It creates no scene,
input, GPU, or host abstraction.

`createFluxelWebGpuBrowserRenderer` requires the async wasm-bindgen
`WebGpuSession.create(canvas)` factory (a test-only injected
`createWebGpuSession(canvas)` is also accepted). It never probes `navigator.gpu`
or creates a WebGPU canvas context in JavaScript: those objects remain Rust/WASM
private. It shares the DOM reducer but does not register WebGL context events.
On the structured `{ outcome: "device-lost" }`, it stops RAF and starts at most
one Rust `recover()` operation. Resize, visibility, `start`, and `resume` may
update lifecycle state while recovery is pending but cannot submit a frame.
Failed recovery stays stopped and is exposed as a terminal `requestFrame()`
outcome; `dispose()` is async and repeat calls return the same terminal Promise.
Its Rust session
contract is `resize`, `render_once`, `suspend`, `resume`, `recover`, `dispose`,
and `diagnostics_snapshot`; WebGL context event methods are not part of it.

## v0.3.0 / 0.11 Architecture Closure

v0.3.0 is the browser adapter contribution to the ecosystem 0.11 Architecture
Closure: it freezes one-shot command/query semantics and Rust/WASM-only
drawing-buffer mutation. It does not replace or broaden the Stage 2.2 evidence
claim. That historical v0.2.0 target remains one named Chrome Stable run on
Windows x64 with the named AMD adapter, retained three-object scene, async
loss-recovery, terminal disposal, CSS/DPR resize, and visibility lifecycle.
Evidence for that target records the exact browser, OS, adapter, driver,
diagnostics context, screenshots, and frame/pixel sampling.

This is not a generic WebGPU support statement: it does not promise arbitrary
browsers, GPUs, WebGPU feature sets, formats, adapters, or operating systems.
No final commit SHA, evidence hash, or release result is asserted here; those
belong to the version review and release evidence after the named run completes.

`demo/` is a proof harness. Evidence tooling supplies a staged wasm-bindgen
package at `demo/wasm/`; `window.__fluxelEvidence` is intentionally not a
published package API.
