export class PluginError extends Error {
  constructor(public code: number, message: string) {
    super(message);
    this.name = 'PluginError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
