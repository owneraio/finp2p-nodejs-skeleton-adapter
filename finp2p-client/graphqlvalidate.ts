/**
 * Validation-only codegen config.
 *
 * `graphql-codegen` validates every document in `documents` against `schema`
 * and exits non-zero on a mismatch (e.g. selecting a field on a union type).
 * That check is the only guard the OSS queries have — nothing else in the build
 * compares them to the schema, and a stale vendored schema is precisely how a
 * broken selection set stays invisible until a real server rejects it.
 *
 * This config exists so the check can run without rewriting the committed
 * `graphql.d.ts`: output goes to a throwaway path under node_modules/.cache,
 * so `npm run validate:graphql` is side-effect free and safe in CI.
 *
 * Keep `schema` and `documents` identical to grahpqlgen.ts.
 */
import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  overwrite: true,
  schema: './apis/ownership.graphql',
  documents: './src/oss/graphql/*.graphql',
  generates: {
    'node_modules/.cache/graphql-validate/schema.d.ts': {
      plugins: ['typescript'],
    },
  },
};

export default config;
