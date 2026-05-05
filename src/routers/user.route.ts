import { Router } from 'express';
import { verifyAccessTokenMiddleware } from '../middlewares/verifyAccessToken.middleware';
import zodValidatorMiddleware from '../middlewares/zodValidator.middleware';
import { getUserByUsername, patchMyWallet } from '../controllers/user.controller';
import { updateWalletSchema, usernameParamSchema } from '../zodSchema/user.schema';

const userRouter = Router();

userRouter.get(
  '/by-username/:username',
  zodValidatorMiddleware(usernameParamSchema),
  getUserByUsername,
);

userRouter.patch(
  '/me/wallet',
  verifyAccessTokenMiddleware,
  zodValidatorMiddleware(updateWalletSchema),
  patchMyWallet,
);

export default userRouter;
