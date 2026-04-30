import express from 'express';
import logger from './config/logger';
import { env } from './config/dotenv';

const app = express();

app.get('/', (req, res) => {
  res.send('Hello from Bun + Express');
});

app.listen(env.PORT, () => {
  logger.info(`Server running on port ${env.PORT}`);
});
