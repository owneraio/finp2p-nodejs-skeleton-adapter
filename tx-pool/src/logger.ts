import winston from 'winston';

let logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
  ),
  transports: [new winston.transports.Console()],
});

export function setLogger(l: winston.Logger) {
  logger = l;
}

export function getLogger(): winston.Logger {
  return logger;
}
