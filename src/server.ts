import express from 'express';
import type { Request } from 'express';
import logger from './config/logger';
import { env } from './config/dotenv';
import { errorHandler } from './middlewares/errorHandler';
import { indexValidationSchema, type IndexValidationSchema } from './zodSchema';
import zodValidatorMiddleware from './middlewares/zodValidator';
import bodyParser from 'body-parser';
import prisma from './config/prisma';
import createHttpError from 'http-errors';

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.send('Hello from Bun + Express');
});

interface TestRequest extends Request {
  body: IndexValidationSchema['body'];
}

app.post(
  '/',
  zodValidatorMiddleware(indexValidationSchema),
  async (req: TestRequest, res, next) => {
    try {
      const { email, name } = req.body;

      const existingUser = await prisma.user.findFirst({ where: { email } });
      if (existingUser) {
        const error = createHttpError(401, 'User is already exits. Try again with different email');
        throw error;
      }

      const newUser = await prisma.user.create({
        data: {
          email,
          name,
        },
      });

      res.json({ success: true, data: newUser, message: 'User is created successfully' });
    } catch (error) {
      next(error);
    }
  },
);

app.use(errorHandler);

app.listen(env.PORT, () => {
  logger.info(`Server running on port ${env.PORT}`);
});
