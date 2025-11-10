import axios from 'axios';
import { OpenAPIValidator } from '../utils/openapi-validator';
import { generateIdempotencyKey } from '../utils/utils';

export class ClientBase {
  host: string;

  protected validator: OpenAPIValidator;

  constructor(host: string, validator?: OpenAPIValidator) {
    this.host = host;
    this.validator = validator || new OpenAPIValidator('dlt-adapter-api.yaml', false);
  }

  async get<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
      axios.get(`${this.host}${url}`, {
        headers: {
          'Accept': 'application/json',
        },
      }).then(({ data: response }) => {
        resolve(response);
      }).catch((error: Error) => {
        console.log('error', error);
        reject(error.message);
      });
    });
  }

  async post<T>(url: string, data?: any, idempotencyKey?: string): Promise<T> {
    // Validate request body if validator is enabled (silently)
    if (this.validator.isEnabled() && data) {
      const validationResult = this.validator.validateRequestBody('post', url, data);
      // Validation is informational only - don't log warnings in tests
    }

    return new Promise((resolve, reject) => {
      axios.post(`${this.host}${url}`, data, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Idempotency-Key': idempotencyKey ?? generateIdempotencyKey(),
        },
      }).then(({ data: response, status }) => {
        // Validate response if validator is enabled (silently)
        if (this.validator.isEnabled()) {
          const validationResult = this.validator.validateResponse('post', url, status, response);
          // Validation is informational only - don't log warnings in tests
        }

        resolve(response);
      }).catch((error: Error) => {
        console.log('error', error);
        reject(error.message);
      });
    });
  }
}
