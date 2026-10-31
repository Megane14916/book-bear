import type { components, operations } from './generated'

type Assert<T extends true> = T
type Optional<T, K extends keyof T> = {} extends Pick<T, K> ? true : false
type Schemas = components['schemas']

// Compile with the Web typecheck so generation flags cannot silently make
// server-defaulted request fields mandatory for openapi-fetch consumers.
export type ApiContractTypeChecks = [
  Assert<Optional<Schemas['CreateBookmarkRequest'], 'visibility'>>,
  Assert<Optional<Schemas['CreateBookmarkRequest'], 'isSpoiler'>>,
  Assert<Optional<Schemas['CreateReplyRequest'], 'isSpoiler'>>,
  Assert<Optional<Schemas['PatchBookmarkRequest'], 'content'>>,
  Assert<Optional<NonNullable<operations['getFeed']['parameters']['query']>, 'limit'>>,
  Assert<Schemas['BookmarkFlowPage']['nextCursor'] extends string | null ? true : false>,
  Assert<'author' extends keyof Schemas['BookmarkFlowItem'] ? false : true>,
  Assert<'book' extends keyof Schemas['BookmarkFlowItem'] ? false : true>,
]
