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

The adapter is the only submission-loop owner. It turns CSS size × DPR into the actual
canvas drawing-buffer size, stops before forwarding context loss, resumes only
after Rust reports restoration, removes every observer/listener/RAF on dispose,
and forwards diagnostics verbatim. After `start()`, `renderOnce()` observes the
latest RAF report rather than submitting a competing frame; in a suspended
state it returns `{ outcome: "blocked" }`. A `{ outcome: "backpressure" }`
frame report is a normal retry-next-RAF result; a thrown renderer error is not suppressed.
It creates no scene, input, GPU, or host
abstraction.

`createFluxelWebGpuBrowserRenderer` requires the async wasm-bindgen
`WebGpuSession.create(canvas)` factory (a test-only injected
`createWebGpuSession(canvas)` is also accepted). It never probes `navigator.gpu`
or creates a WebGPU canvas context in JavaScript: those objects remain Rust/WASM
private. It shares the DOM reducer but does not register WebGL context events.
On the structured `{ outcome: "device-lost" }`, it stops RAF and starts at most
one Rust `recover()` operation. Resize, visibility, `start`, and `resume` may
update lifecycle state while recovery is pending but cannot submit a frame.
Failed recovery stays stopped and is exposed by `renderOnce()`; `dispose()` is
async and repeat calls return the same terminal Promise. Its Rust session
contract is `resize`, `render_once`, `suspend`, `resume`, `recover`, `dispose`,
and `diagnostics_snapshot`; WebGL context event methods are not part of it.

## Stage 2.2 / v0.2.0 evidence boundary

The v0.2.0 WebGPU target is one named Chrome Stable run on Windows x64 with the
named AMD adapter. It reuses the retained three-object scene and proves the
async `WebGpuSession` loss-recovery and terminal-dispose path alongside normal
CSS/DPR resize and visibility lifecycle. Evidence must retain the exact
browser, OS, adapter, driver, and diagnostics context, plus screenshots and
frame/pixel sampling for the visible states.

This is not a generic WebGPU support statement: it does not promise arbitrary
browsers, GPUs, WebGPU feature sets, formats, adapters, or operating systems.
No final commit SHA, evidence hash, or release result is asserted here; those
belong to the version review and release evidence after the named run completes.

`demo/` is a proof harness. Evidence tooling supplies a staged wasm-bindgen
package at `demo/wasm/`; `window.__fluxelEvidence` is intentionally not a
published package API.
