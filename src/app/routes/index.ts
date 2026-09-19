import { Router } from 'express';
import { authRoutes } from './auth.route.js';
import { userRoutes } from './user.route.js';
import { ambulanceRoutes } from './ambulance.route.js';

const rootRouter = Router();

rootRouter.use('/auth', authRoutes);
rootRouter.use('/users', userRoutes);
rootRouter.use('/ambulances', ambulanceRoutes);

export default rootRouter;