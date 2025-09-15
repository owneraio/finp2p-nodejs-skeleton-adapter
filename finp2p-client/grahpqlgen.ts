
import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  overwrite: true,
  schema: "http://localhost:45727/query",
  generates: {
    "src/generated/oss/graphql.d.ts": {
      plugins: ["typescript"]
    }
  }
};

export default config;
