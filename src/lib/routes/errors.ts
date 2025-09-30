import {NextFunction, Request, Response} from "express";
import {logger} from "../helpers";
import {ValidationError} from "../services";

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

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.message });
  }

  if (isErrorWithStatusAndMessage(err)) {
    const status = err.status || 500;
    const message = err.message || 'Internal Server Error';

    logger.warn('Error middleware caught:', err);

    res.status(status).json({
      error: message,
    });
  } else {
    logger.warn('Unexpected error:', err);
    res.status(500).json({error: 'Internal Server Error'});
  }
}
