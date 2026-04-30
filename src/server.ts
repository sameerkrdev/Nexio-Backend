import express from 'express';
import type { Request } from 'express';
import logger from './config/logger';
import { env } from './config/dotenv';
import { errorHandler } from './middlewares/errorHandler';
import { indexValidationSchema, type IndexValidationSchema } from './zodSchema';
import zodValidatorMiddleware from './middlewares/zodValidator';
import bodyParser from 'body-parser';

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.send('Hello from Bun + Express');
});

interface TestRequest extends Request {
  body: IndexValidationSchema['body'];
}

app.post('/', zodValidatorMiddleware(indexValidationSchema), (req: TestRequest, res, next) => {
  try {
    const testStr = req.body.test;
    res.json({ test: testStr });
  } catch (error) {
    next(error);
  }
});

app.use(errorHandler);

app.listen(env.PORT, () => {
  logger.info(`Server running on port ${env.PORT}`);
});
