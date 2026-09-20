# R5 Atlas application workspace

This directory is the React and TypeScript migration target created in Pack 1.

The live field-tested interface remains in `/testing` until later packs reach feature parity. Shared business boundaries start here now so new work does not add more logic to the legacy DOM runtime.

## Boundaries

* `src/core/converter.ts` isolates legal-land conversion.
* `src/core/storage.ts` isolates browser persistence.
* `src/core/providers.ts` isolates network JSON requests.
* `src/types.ts` contains shared domain contracts.

Run `npm run check` to type-check and build the migration workspace.
