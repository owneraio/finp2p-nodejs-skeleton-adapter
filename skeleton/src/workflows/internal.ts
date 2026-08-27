import { WorkflowStorage } from './storage';

// Cross-file internals of the workflows package. Imported by service.ts and
// resumable.ts; never re-exported from the barrel.

export interface OperationContext {
  cid: string;
  storage: WorkflowStorage;
}

/**
 * The operation whose method is currently starting. Set by the proxy right
 * before invoking a proxied method, cleared once the method's synchronous
 * part returns — valid only until the method's first `await`.
 */
let currentOperation: OperationContext | undefined;

export function getCurrentOperation(): OperationContext | undefined {
  return currentOperation
}

export function setCurrentOperation(op: OperationContext | undefined): void {
  currentOperation = op;
}
