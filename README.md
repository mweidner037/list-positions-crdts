# Template Typescript lib

Template for a TypeScript library meant to be published on npm.

Setup and package versions should be current as of Feb 19 2023.

## Files

- `src/`: Source folder. Entry point is `index.ts`. Built to `build/esm` and `build/commonjs`.
  - Node.js uses the CommonJS build: we point to it with `main` in `package.json` and **don't** set `type: "module"`. That way, we don't have to change any file extensions to `.mjs` or `.cjs`, and we don't have to add any explicit extensions to TypeScript imports (`require()` will try adding the `.js` extension automatically). Thus we don't need any post-`tsc` build steps.
- `test/`: Test folder. Runs using mocha.

## Commands

- Build with `npm run build`.
- Test, lint, etc. with `npm run test`. Use `npm run coverage` for code coverage (opens in browser).
- Preview typedoc with `npm run docs`. (Open `docs/index.html` in a browser.)
- Publish with `npm publish`.

## TODO

- Delete `.git`, then setup your own Git repo.
- Search for TODO.
- Write your library in `src/`.
- Replace this README.
