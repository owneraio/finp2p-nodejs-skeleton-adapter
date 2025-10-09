import axios from "axios";
import { OpenAPIValidator } from "../utils/openapi-validator";

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
          "Accept": "application/json"
        }
      }).then(({ data: response }) => {
        resolve(response);
      }).catch((error: Error) => {
        console.log("error", error);
        reject(error.message);
      });
    });
  };

  async post<T>(url: string, data?: any, idempotencyKey?: string): Promise<T> {
    // Validate request body if validator is enabled
    if (this.validator.isEnabled() && data) {
      const validationResult = this.validator.validateRequestBody('post', url, data);
      if (!validationResult.valid) {
        console.warn('Request validation failed:', validationResult.message);
        if (validationResult.errors) {
          console.warn('Validation errors:', validationResult.errors);
        }
      }
    }

    return new Promise((resolve, reject) => {
      axios.post(`${this.host}${url}`, data, {
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Idempotency-Key": idempotencyKey
        }
      }).then(({ data: response, status }) => {
        // Validate response if validator is enabled
        if (this.validator.isEnabled()) {
          const validationResult = this.validator.validateResponse('post', url, status, response);
          if (!validationResult.valid) {
            console.warn('Response validation failed:', validationResult.message);
            if (validationResult.errors) {
              console.warn('Validation errors:', validationResult.errors);
            }
          }
        }

        resolve(response);
      }).catch((error: Error) => {
        console.log("error", error);
        reject(error.message);
      });
    });
  }
}
