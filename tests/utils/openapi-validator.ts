import { readFileSync, existsSync } from 'fs';
import { parse } from 'yaml';
import { z } from 'zod';
import { IApiValidator, ValidationResult } from './validator-interface';

interface OpenAPISchema {
  type?: string;
  properties?: Record<string, OpenAPISchema>;
  required?: string[];
  items?: OpenAPISchema;
  $ref?: string;
  enum?: any[];
  allOf?: OpenAPISchema[];
  oneOf?: OpenAPISchema[];
}

interface OpenAPISpec {
  paths: {
    [path: string]: {
      [method: string]: {
        requestBody?: {
          content?: {
            'application/json'?: { schema?: OpenAPISchema };
          };
        };
        responses?: {
          [statusCode: string]: {
            content?: {
              'application/json'?: { schema?: OpenAPISchema };
            };
          };
        };
      };
    };
  };
  components?: {
    schemas?: Record<string, OpenAPISchema>;
  };
}

/**
 * OpenAPI Validator - validates requests/responses against OpenAPI spec
 */
export class OpenAPIValidator implements IApiValidator {
  private spec: OpenAPISpec | null = null;
  private enabled: boolean;

  constructor(specPath: string = 'dlt-adapter-api.yaml', enabled: boolean = true) {
    this.enabled = enabled;

    if (enabled && existsSync(specPath)) {
      try {
        this.spec = parse(readFileSync(specPath, 'utf-8'));
        console.log(`Loaded OpenAPI spec: ${specPath}`);
      } catch (error) {
        console.warn(`Failed to load OpenAPI spec:`, error);
      }
    }
  }

  validateRequestBody(method: string, path: string, data: any): ValidationResult {
    if (!this.enabled || !this.spec) {
      return { valid: true, message: 'Validation disabled' };
    }

    const schema = this.getRequestSchema(method, path);
    if (!schema) {
      return { valid: true, message: 'No request schema found' };
    }

    return this.validate(data, schema, 'Request');
  }

  validateResponse(method: string, path: string, statusCode: number, data: any): ValidationResult {
    if (!this.enabled || !this.spec) {
      return { valid: true, message: 'Validation disabled' };
    }

    const schema = this.getResponseSchema(method, path, statusCode);
    if (!schema) {
      return { valid: true, message: 'No response schema found' };
    }

    return this.validate(data, schema, 'Response');
  }

  private validate(data: any, schema: OpenAPISchema, type: string): ValidationResult {
    try {
      const zodSchema = this.toZod(schema);
      const result = zodSchema.safeParse(data);

      if (result.success) {
        return { valid: true, message: `${type} valid` };
      }

      return {
        valid: false,
        message: `${type} validation failed`,
        errors: result.error.issues.map(err => ({
          path: err.path.join('.'),
          message: err.message,
          received: (err as any).received,
        })),
      };
    } catch (error) {
      return { valid: false, message: `Validation error: ${error}` };
    }
  }

  private toZod(schema: OpenAPISchema, visited = new Set<string>()): z.ZodSchema {
    // Handle $ref
    if (schema.$ref) {
      const refName = schema.$ref.split('/').pop()!;
      if (visited.has(refName)) return z.any();

      const refSchema = this.spec?.components?.schemas?.[refName];
      if (!refSchema) return z.any();

      visited.add(refName);
      return this.toZod(refSchema, visited);
    }

    // Handle allOf (merge schemas)
    if (schema.allOf?.length) {
      const schemas = schema.allOf.map(s => this.toZod(s, visited));
      return schemas.reduce((acc, curr) => (acc as any).merge(curr), z.object({}));
    }

    // Handle oneOf (union)
    if (schema.oneOf?.length) {
      const schemas = schema.oneOf.map(s => this.toZod(s, visited));
      return z.union([schemas[0], schemas[1], ...schemas.slice(2)] as any);
    }

    // Handle enum
    if (schema.enum?.length) {
      return schema.enum.length === 1
        ? z.literal(schema.enum[0])
        : schema.enum.every(v => typeof v === 'string')
        ? z.enum(schema.enum as any)
        : z.union(schema.enum.map(v => z.literal(v)) as any);
    }

    // Handle by type
    switch (schema.type) {
      case 'string':
        return z.string();
      case 'number':
        return z.number();
      case 'integer':
        return z.number().int();
      case 'boolean':
        return z.boolean();
      case 'array':
        return z.array(schema.items ? this.toZod(schema.items, visited) : z.any());
      case 'object':
        return this.objectToZod(schema, visited);
      default:
        return schema.properties ? this.objectToZod(schema, visited) : z.any();
    }
  }

  private objectToZod(schema: OpenAPISchema, visited: Set<string>): z.ZodSchema {
    if (!schema.properties) {
      return z.record(z.string(), z.any());
    }

    const shape: Record<string, z.ZodTypeAny> = {};
    const required = new Set(schema.required || []);

    for (const [key, prop] of Object.entries(schema.properties)) {
      const fieldSchema = this.toZod(prop, visited);
      shape[key] = required.has(key) ? fieldSchema : fieldSchema.optional();
    }

    return z.object(shape);
  }

  private getRequestSchema(method: string, path: string): OpenAPISchema | null {
    const operation = this.getOperation(method, path);
    return operation?.requestBody?.content?.['application/json']?.schema || null;
  }

  private getResponseSchema(method: string, path: string, statusCode: number): OpenAPISchema | null {
    const operation = this.getOperation(method, path);
    return operation?.responses?.[statusCode.toString()]?.content?.['application/json']?.schema || null;
  }

  private getOperation(method: string, path: string) {
    const normalizedPath = this.normalizePath(path);
    return this.spec?.paths[normalizedPath]?.[method.toLowerCase()];
  }

  private normalizePath(path: string): string {
    const cleanPath = path.split('?')[0];

    // Try exact match
    if (this.spec?.paths[cleanPath]) {
      return cleanPath;
    }

    // Try path parameter matching
    for (const specPath of Object.keys(this.spec?.paths || {})) {
      if (this.matchesPathPattern(cleanPath, specPath)) {
        return specPath;
      }
    }

    return cleanPath;
  }

  private matchesPathPattern(actual: string, pattern: string): boolean {
    const actualParts = actual.split('/');
    const patternParts = pattern.split('/');

    if (actualParts.length !== patternParts.length) return false;

    return patternParts.every((part, i) =>
      part.startsWith('{') && part.endsWith('}') || part === actualParts[i]
    );
  }

  isEnabled(): boolean {
    return this.enabled && this.spec !== null;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}
