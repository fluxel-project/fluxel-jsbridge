# Fluxel JavaScript Bridge

`fluxel-jsbridge` contains JavaScript-facing platform adapters for Fluxel.
Its adapters translate browser, mini-game, or native-host lifecycle and
capability facts into the boundary consumed by an application and by
`fluxel-rendering`. It is not a renderer, RHI, asset system, or native host.

Once those facts enter `fluxel-rendering`, that repository owns the rendering
path through `RenderScene`, `FramePipeline`, material/shader resolution, and
`RenderGraph`. The separate `fluxel-rhi` repository owns the RHI execution
contract and private backends. The JavaScript bridge does not add a Graph/RHI
translation layer to that path.

The repository currently ships the deliberately narrow
[`@fluxel/browser`](./packages/browser/README.md) adapter. General JavaScript
wrappers are undecided; no SDK, adapter expansion, API, or delivery plan is
retained here.

## Responsibilities and boundaries

| Owner | Responsibility |
| --- | --- |
| `fluxel-jsbridge` | JavaScript-facing platform adaptation: canvas and DOM lifecycle, resize and visibility facts, platform capability discovery, and JavaScript diagnostic sinks. |
| [`fluxel-rendering`](https://github.com/fluxel-project/fluxel-rendering) | Renderer, FramePipeline/material/shader preparation, RenderGraph, resource-use planning, frame policy, and GPU resource retirement decisions. |
| [`fluxel-rhi`](https://github.com/fluxel-project/fluxel-rhi) | Portable RHI contract and backends, GPU resource creation, command execution and submission, completion evidence, and RHI-side presentation. |
| [`fluxel-host`](https://github.com/fluxel-project/fluxel-host) | Native process and window lifecycle, event pumping, and platform I/O for native applications. Its platform crates do not depend on rendering. |
| [`fluxel-bases`](https://github.com/fluxel-project/fluxel-bases) | Platform-neutral mechanisms that real cross-repository consumers have proved should be shared. |

An adapter owns platform lifecycle reduction, not GPU execution resources. For
example, the browser adapter observes the supplied canvas, CSS/DPR extent,
visibility, and browser loss/restoration events, then passes those facts to the
rendering binding. RHI owns GPU buffers, textures, commands, submission, and
completion evidence; rendering decides when resources may retire. Browser-native
GPU objects and binding-private handles remain implementation details.

`fluxel-host` and `fluxel-jsbridge` are peers that serve different platforms.
Native applications may compose a host with rendering; browser and mini-game
applications use a JavaScript adapter with a rendering binding and do not
depend on the native host. Platform lifecycle is not the owner of rendering
semantics.

## Package layout

| Package area | Status | Responsibility |
| --- | --- | --- |
| `@fluxel/browser` | Existing | Browser canvas/DOM lifecycle adapter around an explicitly supplied rendering WASM binding. |

## Development boundary

The existing browser adapter depends on its rendering binding, not on
`fluxel-host`. Platform integration does not define scenes, RenderGraph
semantics, RHI resources, GPU synchronization, or renderer-private residency.
Conversely, rendering does not own RAF, DOM events, browser policy, or a
native application loop.

For ecosystem ownership and the current development sequence, see the
[Fluxel roadmap](https://github.com/fluxel-project/.github/blob/main/ROADMAP.md)
and [ecosystem architecture](https://github.com/fluxel-project/.github/blob/main/ECOSYSTEM_ARCHITECTURE.md).

## Rendering evidence boundary

Rendering's bounded S7/S8 result is native Windows DX12/WGL consumer evidence
only. Its [S7 historical closure](https://github.com/fluxel-project/fluxel-rendering/blob/main/documents/s7-deferred-closure.md)
and [S8 measured closure](https://github.com/fluxel-project/fluxel-rendering/blob/main/documents/s8-measured-closure.md)
do not validate this browser adapter, WebGPU/WebGL, browser visibility, canvas
restoration, or JavaScript bindings. Browser lifecycle, loss/restore, and
JavaScript evidence remain separate requirements.
