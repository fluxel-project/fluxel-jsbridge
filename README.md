# Fluxel JS Bridge

`fluxel-jsbridge` is the default JavaScript SDK monorepo for Fluxel. It gives
browser, mini-game, and native-host applications one developer-facing API while
adapting each environment's services and connecting to the Fluxel rendering
kernel.

It is an integration layer, not the semantic authority for rendering, assets,
diagnostics, or platform services. The same lower-level contracts may be
presented by a Rust, C#, Lua, or other language SDK without changing their
meaning.

## Repository outline

The repository will grow packages only when a vertical slice proves their
boundary:

| Package area | Responsibility |
| --- | --- |
| SDK core | The stable, language-level application API and composition of rendering with host services. |
| Browser adapter | Web APIs, the rendering WASM module, and browser diagnostics. |
| Mini-game adapter | A selected mini-game platform's APIs and its rendering WASM integration. |
| Native adapter | The API injected or exposed by a Fluxel native host. |

The adapters translate environment-specific capabilities; they do not pretend
that every platform has identical services.

## Dependencies and contracts

`fluxel-jsbridge` consumes either a Fluxel rendering WASM/native binding or a
Fluxel host API. `fluxel-rendering` remains a host-agnostic rendering kernel:
it accepts a supplied surface target, resource bytes, scene/canvas updates, and
render calls, but does not own a main loop, input, IO, audio, storage, or
networking. A native host supplies those services when an executable, APK, or
IPA is required.

The SDK composes those contracts into familiar application services such as
`app.scene`, `app.canvas`, `app.assets`, `app.input`, `app.audio`,
`app.video`, `app.storage`, and `app.net`. It must expose capability
discovery rather than manufacture unsupported behavior:

```js
if (app.capabilities.video) {
  await app.video.play(source);
}
```

## Non-goals

This repository does not define GPU resource ownership, native RHI behavior,
or the portable renderer contract; those belong to
[`fluxel-rendering`](https://github.com/fluxel-project/fluxel-rendering).
It does not create native application hosts, own OS lifecycle policy, or
implement platform filesystem, audio, video, storage, and network backends.
Those responsibilities belong to `fluxel-host`. Shared, platform-neutral
mechanisms such as asset identity and diagnostic schemas belong to
`fluxel-bases` when their cross-repository contracts are proven.

## Status and roadmap

**Status:** `@fluxel/browser` is the first deliberately narrow adapter. It
creates one explicitly supplied WASM canvas session, owns RAF, CSS/DPR resize,
visibility and WebGL context lifecycle, and forwards Rust diagnostics unchanged.
It is not an SDK core and does not export scene, input, assets, audio, storage,
or networking APIs.

- Prove the browser adapter with the `fluxel-rendering-wasm` WebGL2 slice and
  Chrome real-target evidence before calling it supported.
- Establish the SDK core only from behavior shared by those adapters.
- Add native-host adaptation after `fluxel-host` provides a concrete host API.
- Keep every capability optional and observable as browser, mini-game, and
  native support diverge.

For the ecosystem-wide ownership and stage plan, see the
[Fluxel roadmap](https://github.com/fluxel-project/.github/blob/main/ROADMAP.md).
