
import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  overwrite: true,
  schema: "./apis/ownership.graphql",
  generates: {
    "src/oss/graphql.d.ts": {
      plugins: ["typescript"]
    }
  }
};

export default config;
