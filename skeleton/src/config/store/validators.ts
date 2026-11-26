import { ConfigValues } from './schema';

export interface ValidationResult {
  status: 'valid' | 'invalid';
  message: string;
  details?: { label: string; value: string }[];
}

/** A read-only check on the values: it may call out, but changes nothing anywhere. */
export type Validator = (values: ConfigValues) => Promise<ValidationResult>;

export const valid = (message: string, details?: ValidationResult['details']): ValidationResult => ({ status: 'valid', message, details });
export const invalid = (message: string): ValidationResult => ({ status: 'invalid', message });
