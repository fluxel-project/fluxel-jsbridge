# `@fluxel/browser`

`@fluxel/browser` is a narrow browser lifecycle adapter for a supplied Fluxel
rendering WASM binding. It is neither a JavaScript renderer nor a general SDK.
It owns browser-side lifecycle reduction and the sole `requestAnimationFrame`
producer; the rendering binding owns GPU execution and drawing-buffer changes.

## Use

```js
import {
  createFluxelBrowserRenderer,
  createFluxelWebGpuBrowserRenderer,
} from "@fluxel/browser";

const renderer = createFluxelBrowserRenderer({ canvas, wasm });
renderer.start();
```

Use the asynchronous factory when the supplied binding exposes the WebGPU
entry point:

```js
const renderer = await createFluxelWebGpuBrowserRenderer({ canvas, wasm });
renderer.start();
```

`wasm` is the generated `fluxel-rendering-wasm` module. The WebGL2 factory
uses the binding's synchronous WebGL2 initialization path; the WebGPU factory
uses its asynchronous WebGPU initialization path. Test-only injected creators
exist for the DOM contract tests. These are binding integration details, not a
Fluxel resource model: they do not establish browser session or token concepts
in the public rendering architecture. The backend privately owns its browser
context or device and all GPU objects; the public boundary carries lifecycle
and presentation facts plus the binding's rendering results.

## Lifecycle contract

The adapter observes CSS size and device-pixel ratio, then reports the desired
pixel extent to the binding. JavaScript never mutates the canvas drawing
buffer. It also reduces visibility, resize, WebGL context loss/restoration,
and WebGPU device-loss/recovery outcomes into one browser lifecycle producer.
It removes RAF callbacks, observers, and listeners on disposal.

The returned adapter exposes:

| Method | Meaning |
| --- | --- |
| `start()` | Starts continuous frame opportunities when lifecycle state permits. |
| `resize()` | Reports the current CSS × DPR extent to the binding. |
| `requestFrame()` | Requests one future submission opportunity while the continuous loop is stopped. |
| `lastFrameReport()` | Reads the most recent frame report without scheduling or submitting work. |
| `suspend()` / `resume()` | Applies an explicit browser-side lifecycle pause or resume. |
| `diagnosticsSnapshot()` | Returns diagnostics supplied by the binding unchanged. |
| `dispose()` | Stops browser work and disposes the binding; it returns the same terminal result on repeated calls. |

`requestFrame()` is a command, not a synchronous render call. Its result makes
coalescing and blocked states explicit: `scheduled`, `already-scheduled`,
`already-running`, `blocked`, or a terminal outcome. A `scheduled` result only
means that the adapter accepted one future opportunity; inspect
`lastFrameReport()` for its eventual rendering result.

For WebGPU, a `{ outcome: "device-lost" }` frame report stops RAF and initiates
at most one binding recovery operation. While recovery is pending, lifecycle
events may update desired state but cannot create another frame producer. A
failed recovery remains terminal until disposal.

## Non-goals

This package does not create a scene, define asset ownership, expose GPU
objects, own RHI resources or synchronization, or provide input, audio, video,
storage, or networking APIs. Those capabilities require their own proven
platform contracts. The browser adapter provides platform lifecycle facts;
`fluxel-rendering` owns GPU execution semantics.

`demo/` is an integration and evidence harness. Its staged WASM package and
`window.__fluxelEvidence` are not published package APIs.
