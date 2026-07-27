import { NextFunction, Request, Response } from 'express';
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
