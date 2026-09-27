import { Application, NextFunction, Request, Response } from 'express';
import { logger } from '../helpers';
import {
  AccountAlreadyBoundError,
  AccountInvalidShapeError,
  AccountNotFoundError,
  BusinessError,
  NotSupportedError,
  ValidationError,
} from '../models';
import { components } from './model-gen';

function isErrorWithStatusAndMessage(err: any): err is { status: number, message: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    !Array.isArray(err) &&
    'status' in err &&
    'message' in err &&
    typeof (err as any).status === 'number' &&
    typeof (err as any).message === 'string'
  );
}

type errorResponse = components['schemas']['OperationBase'] & {
  error?: components['schemas']['receiptOperationErrorInformation']
};

const failureResponse = (code: number, message: string): errorResponse => {
  return {
    cid: '',
    isCompleted: true,
    error: {
      code,
      message,
    },
  };
};

const apiErrors = (code: number, message: string): components['schemas']['APIErrors'] => {
  return { errors: [{ code, message }] };
};

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof AccountAlreadyBoundError) {
    return res.status(409).json(apiErrors(err.code, err.message));
  } else if (err instanceof AccountInvalidShapeError) {
    return res.status(400).json(apiErrors(err.code, err.message));
  } else if (err instanceof AccountNotFoundError) {
    return res.status(404).json(apiErrors(err.code, err.message));
  } else if (err instanceof NotSupportedError) {
    return res.status(501).json(apiErrors(0, err.message));
  }

  if (err instanceof ValidationError) {
    const { message } = err;
    return res.status(400).json(failureResponse(1, message));
  } else if (err instanceof BusinessError) {
    const { code, message } = err;
    return res.status(200).json(failureResponse(code, message));
  }

  if (isErrorWithStatusAndMessage(err)) {
    const status = err.status || 500;
    const message = err.message || 'Internal Server Error';

    logger.warning('Error middleware caught:', err);

    res.status(status).json(failureResponse(0, message));
  } else {
    logger.warning('Unexpected error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

const ROUTING_METHODS = new Set(['all', 'get', 'post', 'put', 'patch', 'delete', 'use']);
const forwarding = new WeakSet<object>();

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

const isPromiseLike = (value: unknown): value is Promise<unknown> =>
  typeof (value as Promise<unknown> | undefined)?.catch === 'function';

/**
 * A handler whose rejected promise is passed to `next`. The promise is not
 * handed back, because Express 5 would pass the same rejection on again.
 * Error middleware, recognised by its four parameters, is left as it is.
 */
const forwardRejection = (arg: unknown): unknown => {
  if (Array.isArray(arg)) return arg.map(forwardRejection);
  if (typeof arg !== 'function' || arg.length === 4) return arg;
  const handler = arg as Handler;
  return (req: Request, res: Response, next: NextFunction) => {
    const result = handler(req, res, next);
    if (isPromiseLike(result)) result.catch(next);
  };
};

/**
 * The app with every route and middleware registered through it passing a
 * rejected promise to `next`, and so to `errorHandler`. Express 5 does this
 * itself; Express 4 leaves the rejection unhandled, which under Node's
 * default ends the process, so one failing request would take an adapter on
 * Express 4 down. Applying it twice is harmless.
 */
export function forwardAsyncErrors<T extends Application>(app: T): T {
  if (forwarding.has(app)) return app;
  const proxy = new Proxy(app, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== 'string' || !ROUTING_METHODS.has(prop) || typeof value !== 'function') return value;
      return (...args: unknown[]) => value.apply(target, args.map(forwardRejection));
    },
  });
  forwarding.add(proxy);
  return proxy;
}
