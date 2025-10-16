import { NextFunction, Request, Response } from 'express';
import { logger } from '../helpers';
import { BusinessError, ValidationError } from '../services';
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

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
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

    logger.warn('Error middleware caught:', err);

    res.status(status).json(failureResponse(0, message));
  } else {
    logger.warn('Unexpected error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
