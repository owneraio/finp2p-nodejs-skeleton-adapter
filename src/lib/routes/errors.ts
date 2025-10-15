import {NextFunction, Request, Response} from "express";
import {logger} from "../helpers";
import {BusinessError, ValidationError} from "../services";

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
    console.error(`Got validation error: ${err.message}`);
    return res.status(400).json({ error: err.message });
  } else if (err instanceof BusinessError) {
    console.error(`Got business error: ${err.message}`);
    return res.status(200).json({ error: err.message });
  }

  console.error('Unexpected error:', err);

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
