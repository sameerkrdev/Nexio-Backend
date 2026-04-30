import express from 'express';
import logger from './config/logger';

const app = express();

app.get('/', (req, res) => {
  res.send('Hello from Bun + Express');
});

app.listen(3000, () => {
  logger.info('Server running on port 3000');
});
