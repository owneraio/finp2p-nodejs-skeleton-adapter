// Checks a value against a ControlCenterSchema; answers the JSON pointer of the first fault, never the value.
import { has, isPlainObject } from './json';
import { ControlCenterSchema } from './types';

const patterns = new WeakMap<ControlCenterSchema, RegExp>();

const pointerToken = (token: string): string => token.replaceAll('~', '~0').replaceAll('/', '~1');

function patternOf(schema: ControlCenterSchema): RegExp {
  let pattern = patterns.get(schema);
  if (!pattern) {
    pattern = new RegExp(schema.pattern as string, 'u');
    patterns.set(schema, pattern);
  }
  return pattern;
}

// lengths in UTF-16 units, as Control Center counts them
const stringFits = (schema: ControlCenterSchema, value: unknown): boolean => typeof value === 'string'
  && (schema.maxLength === undefined || value.length <= schema.maxLength)
  && (schema.minLength === undefined || value.length >= schema.minLength)
  && (schema.pattern === undefined || patternOf(schema).test(value))
  && (schema.enum === undefined || schema.enum.includes(value));

/** null when the value fits, else the JSON pointer of the first field at fault ('' is the root). */
export function schemaFault(schema: ControlCenterSchema, value: unknown, pointer = ''): string | null {
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
    case 'integer': return Number.isSafeInteger(value) ? null : pointer;
    case 'boolean': return typeof value === 'boolean' ? null : pointer;
    case 'array': {
      if (!Array.isArray(value) || (schema.maxItems !== undefined && value.length > schema.maxItems)) return pointer;
      for (let i = 0; i < value.length; i += 1) {
        const fault = schemaFault(schema.items as ControlCenterSchema, value[i], `${pointer}/${i}`);
        if (fault !== null) return fault;
      }
      return null;
    }
    default: return pointer;
  }
}
