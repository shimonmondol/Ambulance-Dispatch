import { Router, type Request, type Response, type NextFunction } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../../prisma.js';
import { auth } from '../middlewares/auth.js';

const router = Router();

// Get Logged-in User Profile
router.get('/me', auth(Role.CUSTOMER, Role.PROVIDER, Role.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        createdAt: true,
        providerProfile: { include: { ambulance: true } },
      },
    });

    res.status(200).json({ success: true, message: 'Profile fetched successfully', data: user });
  } catch (err) {
    next(err);
  }
});

// Update Profile
router.patch('/me', auth(Role.CUSTOMER, Role.PROVIDER, Role.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;
    const { name, phone } = req.body;

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { name, phone },
      select: { id: true, name: true, email: true, phone: true, role: true, updatedAt: true },
    });

    res.status(200).json({ success: true, message: 'Profile updated successfully', data: updated });
  } catch (err) {
    next(err);
  }
});

export const userRoutes = router;