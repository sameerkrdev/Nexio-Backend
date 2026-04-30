import express from 'express';
import { errorHandler } from './middlewares/errorHandler';
import bodyParser from 'body-parser';
import userRouter from './routers/user.route';

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.send('Hello from Bun + Express');
});

app.use('api/v1/users', userRouter);

app.use(errorHandler);

export default app;
