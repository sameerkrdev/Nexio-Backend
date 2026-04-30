import { Router } from 'express';
import zodValidatorMiddleware from '../middlewares/zodValidator.middleware';
import { userValidationSchema } from '../zodSchema/user.schema';
import { createUser } from '../controllers/user.controller';

const router = Router();

router.route('/').post(zodValidatorMiddleware(userValidationSchema), createUser);

export default router;
