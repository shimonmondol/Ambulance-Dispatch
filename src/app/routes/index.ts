import { Router } from 'express';
import { authRoutes } from './auth.route.js';
import { userRoutes } from './user.route.js';
import { ambulanceRoutes } from './ambulance.route.js';
import { rideRoutes } from './ride.routes.js';
import { paymentRoutes } from './payment.routes.js';
import { adminRoutes } from './admin.routes.js';


const rootRouter = Router();

rootRouter.use('/auth', authRoutes);
rootRouter.use('/users', userRoutes);
rootRouter.use('/ambulances', ambulanceRoutes);
rootRouter.use('/rides', rideRoutes);
rootRouter.use('/payments', paymentRoutes);
rootRouter.use('/admin', adminRoutes);

export default rootRouter;