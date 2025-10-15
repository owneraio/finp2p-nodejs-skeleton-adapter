

export class ValidationError extends Error {

  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class BusinessError extends Error {

  code: number;
  message: string;

  constructor(code: number, message: string) {
    super(message);
    this.name = 'BusinessError';
    this.code = code;
    this.message = message;

  }

}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}
