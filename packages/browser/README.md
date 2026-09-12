# `@fluxel/browser`

This ESM package is the Stage 2 browser lifecycle adapter, not a JavaScript
renderer or SDK core.

```js
import { createFluxelBrowserRenderer } from "@fluxel/browser";

const renderer = createFluxelBrowserRenderer({ canvas, wasm });
renderer.start();
```

`wasm` is the `fluxel-rendering-wasm` generated module. Its primary session
factory is `WebGl2Session.new(canvas)`; a wasm-bindgen constructor export and a
test-only `createSession(canvas)` factory are also accepted. The resulting
session must provide `resize`, `render_once`, parameterless `suspend`, `resume`,
`context_lost`, `context_restored`, `dispose`, and `diagnostics_snapshot`.

The adapter is the only submission-loop owner. It turns CSS size × DPR into the actual
canvas drawing-buffer size, stops before forwarding context loss, resumes only
after Rust reports restoration, removes every observer/listener/RAF on dispose,
and forwards diagnostics verbatim. After `start()`, `renderOnce()` observes the
latest RAF report rather than submitting a competing frame; in a suspended
state it returns `{ outcome: "blocked" }`. A `{ outcome: "backpressure" }`
frame report is a normal retry-next-RAF result; a thrown renderer error is not suppressed.
It creates no scene, input, GPU, or host
abstraction.

`demo/` is a proof harness. Evidence tooling supplies a staged wasm-bindgen
package at `demo/wasm/`; `window.__fluxelEvidence` is intentionally not a
published package API.
