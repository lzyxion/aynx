# Contributing to Aynx

English · [한국어](CONTRIBUTING.ko.md)

## Pre-commit checks

Frontend changes must pass:

```sh
npm run check && npm run build && npm test && npm run check:cycles && npm run check:bundle
```

Rust changes (`src-tauri/`) must also pass:

```sh
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
```

Write `cargo test` output to a file rather than piping it (`| head` kills it with SIGPIPE).
Documentation-only changes need only `npm run check`.

## Code and documentation maps

[Code conventions](docs/conventions.md) · [Backend module map](docs/modules.md) · [Frontend module map](docs/modules-frontend.md) · [Documentation index](docs/README.md)

Design notes and work logs (`docs/log/`, `docs/internal/`, `docs/verification/`) live in a private repository, so links to them will not open here.

[Back to README](README.md)
