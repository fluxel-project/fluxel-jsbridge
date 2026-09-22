# Fluxel JavaScript Bridge

`fluxel-jsbridge` contains JavaScript-facing platform adapters for Fluxel.
Its adapters translate browser, mini-game, or native-host lifecycle and
capability facts into the contracts consumed by an application and by
`fluxel-rendering`. It is not a renderer, RHI, asset system, or native host.

The repository currently ships the deliberately narrow
[`@fluxel/browser`](./packages/browser/README.md) adapter. A general JavaScript
SDK is introduced only when behaviour is genuinely shared by more than one
adapter; this repository does not predeclare a universal application API.

## Responsibilities and boundaries

| Owner | Responsibility |
| --- | --- |
| `fluxel-jsbridge` | JavaScript-facing platform adaptation: canvas and DOM lifecycle, resize and visibility facts, platform capability discovery, and JavaScript diagnostic sinks. |
| [`fluxel-rendering`](https://github.com/fluxel-project/fluxel-rendering) | RenderGraph, renderer, RHI, presentation, GPU resources, command submission, completion, and GPU retirement. |
| [`fluxel-host`](https://github.com/fluxel-project/fluxel-host) | Native process and window lifecycle, event pumping, and platform I/O for native applications. Its platform crates do not depend on rendering. |
| [`fluxel-bases`](https://github.com/fluxel-project/fluxel-bases) | Platform-neutral mechanisms that real cross-repository consumers have proved should be shared. |

An adapter owns platform lifecycle reduction, not GPU execution resources. For
example, the browser adapter observes the supplied canvas, CSS/DPR extent,
visibility, and browser loss/restoration events, then passes those facts to the
rendering binding. RHI remains the single owner of GPU buffers, textures,
commands, submission, completion, and retirement. Browser-native GPU objects
and any binding-private handles are implementation details, never a Fluxel
public architecture or a cross-platform resource model.

`fluxel-host` and `fluxel-jsbridge` are peers that serve different platforms.
Native applications may compose a host with rendering; browser and mini-game
applications use a JavaScript adapter with a rendering binding. Neither choice
makes platform lifecycle the owner of rendering semantics.

## Package layout

| Package area | Status | Responsibility |
| --- | --- | --- |
| `@fluxel/browser` | Existing | Browser canvas/DOM lifecycle adapter around an explicitly supplied rendering WASM binding. |
| SDK core | Deferred | A language-level API only after multiple adapters establish a shared contract. |
| Mini-game adapter | Deferred | An adapter for a specifically supported mini-game platform. |
| Native adapter | Deferred | JavaScript adaptation over a concrete native-host bridge contract. |

Platform services are capability-specific. An eventual common SDK must expose
what the selected adapter actually supports rather than emulate unavailable
input, audio, storage, video, or networking behaviour.

## Development boundary

The dependency direction is from JavaScript platform adaptation toward the
rendering binding. The bridge may supply a presentation target and lifecycle
facts, but it must not define scenes, RenderGraph semantics, RHI resources,
GPU synchronization, or renderer-private residency. Conversely, rendering
does not own RAF, DOM events, browser policy, or a native application loop.

For ecosystem ownership and the current development sequence, see the
[Fluxel roadmap](https://github.com/fluxel-project/.github/blob/main/ROADMAP.md)
and [ecosystem architecture](https://github.com/fluxel-project/.github/blob/main/ECOSYSTEM_ARCHITECTURE.md).
