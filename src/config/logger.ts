import winston, { format } from 'winston';
const { combine, timestamp, json } = format;

const logger = winston.createLogger({
  level: 'info',
  format: combine(timestamp(), json()), // production format
  transports: [
    // file for errors
    new winston.transports.File({
      dirname: 'logs',
      filename: 'error.log',
      level: 'error',
    }),

    // file for all logs
    new winston.transports.File({
      dirname: 'logs',
      filename: 'combined.log',
    }),
  ],
});

// dev console transport
if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: combine(json(), timestamp()),
    }),
  );
}

export default logger;
