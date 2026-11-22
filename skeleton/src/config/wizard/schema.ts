// Validation in the contract's JSON Schema subset. Answers the JSON pointer of the first
// field at fault, never the value.
import { has, isPlainObject } from './json';
import { WizardSchema } from './types';

const patterns = new WeakMap<WizardSchema, RegExp>();

const pointerToken = (token: string): string => token.replaceAll('~', '~0').replaceAll('/', '~1');

const withinBounds = (schema: WizardSchema, value: number): boolean =>
  (schema.minimum === undefined || value >= schema.minimum) && (schema.maximum === undefined || value <= schema.maximum);

function patternOf(schema: WizardSchema): RegExp {
  let pattern = patterns.get(schema);
  if (!pattern) {
    pattern = new RegExp(schema.pattern as string, 'u');
    patterns.set(schema, pattern);
  }
  return pattern;
}

function stringFits(schema: WizardSchema, value: unknown): boolean {
  if (typeof value !== 'string') return false;
  // code points, as JSON Schema counts them
  const length = [...value].length;
  if (schema.maxLength !== undefined && length > schema.maxLength) return false;
  if (schema.minLength !== undefined && length < schema.minLength) return false;
  if (schema.pattern !== undefined && !patternOf(schema).test(value)) return false;
  return schema.enum === undefined || schema.enum.includes(value);
}

/** null when the value fits, else the JSON pointer of the first field at fault ('' is the root). */
export function schemaFault(schema: WizardSchema, value: unknown, pointer = ''): string | null {
  switch (schema.type) {
    case 'object': {
      if (!isPlainObject(value)) return pointer;
      const properties = schema.properties ?? {};
      const extra = Object.keys(value).find((key) => !has(properties, key));
      if (extra !== undefined) return `${pointer}/${pointerToken(extra)}`;
      const missing = (schema.required ?? []).find((name) => !has(value, name));
      if (missing !== undefined) return `${pointer}/${pointerToken(missing)}`;
      for (const key of Object.keys(value)) {
        const fault = schemaFault(properties[key], value[key], `${pointer}/${pointerToken(key)}`);
        if (fault !== null) return fault;
      }
      return null;
    }
    case 'string': return stringFits(schema, value) ? null : pointer;
    case 'number': return typeof value === 'number' && Number.isFinite(value) && withinBounds(schema, value) ? null : pointer;
    case 'integer': return Number.isSafeInteger(value) && withinBounds(schema, value as number) ? null : pointer;
    case 'boolean': return typeof value === 'boolean' ? null : pointer;
    case 'array': {
      if (!Array.isArray(value) || (schema.maxItems !== undefined && value.length > schema.maxItems)) return pointer;
      for (let i = 0; i < value.length; i += 1) {
        const fault = schemaFault(schema.items as WizardSchema, value[i], `${pointer}/${i}`);
        if (fault !== null) return fault;
      }
      return null;
    }
    default: return pointer;
  }
}
