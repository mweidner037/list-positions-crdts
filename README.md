# @list-positions/crdts

A collection of CRDTs built on top of the [list-positions](https://github.com/mweidner037/list-positions#readme) library.

This package is meant as an example of how to use list-positions, not a production CRDT library. So take a look at the [source code](./src/).

## About

list-positions provides local data structures that implement the core of a list/text [CRDT](https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type) but with a different API. This package wraps those data structures to create more traditional CRDTs.

Specifically, this package's classes are all hybrid op-based/state-based CRDTs that tolerate duplicated and out-of-order messages (in op-based usage) and support state-based merging (state-based usage).

## API

Classes:

- `ListCrdt<T>`
- `TextCrdt`

Types:

- `ListCrdtMessage<T>`, `TextCrdtMessage`: Op-based message types.
- `ListCrdtSavedState<T>`, `TextCrdtSavedState`: State-based state types. Can also be used for ordinary saving and loading.

The types are all JSON objects. You can serialize them with `JSON.stringify` (possibly GZIP'd) or design more efficient binary formats if you like.
