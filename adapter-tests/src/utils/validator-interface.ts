/**
 * Validation result interface
 */
export interface ValidationResult {
  valid: boolean;
  message: string;
  errors?: Array<{
    path: string;
    message: string;
    received?: any;
  }>;
}

/**
 * API Validator interface
 */
export interface IApiValidator {
  /**
   * Validate request body against schema
   */
  validateRequestBody(method: string, path: string, data: any): ValidationResult;

  /**
   * Validate response against schema
   */
  validateResponse(method: string, path: string, statusCode: number, data: any): ValidationResult;

  /**
   * Check if validator is enabled
   */
  isEnabled(): boolean;

  /**
   * Enable or disable validation
   */
  setEnabled(enabled: boolean): void;
}
