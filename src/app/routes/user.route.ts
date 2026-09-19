import { Router } from 'express';
import { UserController } from '../controllers/user.controller.js';
import { auth } from '../../app/middlewares/auth.js';
import { Role } from '@prisma/client';

const router = Router();

router.get('/me', auth(Role.CUSTOMER, Role.PROVIDER, Role.ADMIN), UserController.getMe);
router.patch('/me', auth(Role.CUSTOMER, Role.PROVIDER, Role.ADMIN), UserController.updateMe);

export const UserRoutes = router;