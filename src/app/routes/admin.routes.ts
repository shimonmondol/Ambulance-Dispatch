import { Router, type Request, type Response, type NextFunction } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../../prisma.js';
import { auth } from '../middlewares/auth.js';

const router = Router();

// Dashboard Analytics Overview (Admin)
router.get('/overview', auth(Role.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [totalUsers, totalAmbulances, totalRides, totalRevenue] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.ambulance.count({ where: { deletedAt: null } }),
      prisma.rideRequest.count({ where: { deletedAt: null } }),
      prisma.payment.aggregate({
        where: { status: 'PAID' },
        _sum: { amount: true },
      }),
    ]);

    res.status(200).json({
      success: true,
      message: 'System analytics retrieved',
      data: {
        totalUsers,
        totalAmbulances,
        totalRides,
        totalRevenue: totalRevenue._sum.amount || 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

// All Users Management (Admin)
router.get('/users', auth(Role.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, email: true, phone: true, role: true, isVerified: true, createdAt: true },
    });
    res.status(200).json({ success: true, message: 'All users fetched', data: users });
  } catch (err) {
    next(err);
  }
});

// User Status Toggle (Verify/Unverify)
router.patch('/users/:id/verify', auth(Role.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const user = await prisma.user.update({
      where: { id },
      data: { isVerified: true },
    });
    res.status(200).json({ success: true, message: 'User verified successfully', data: user });
  } catch (err) {
    next(err);
  }
});

// Audit Trail Inspection
router.get('/audit-logs', auth(Role.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const logs = await prisma.auditLog.findMany({
      take: 50,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });

    res.status(200).json({
      success: true,
      message: 'System audit logs retrieved',
      data: logs,
    });
  } catch (err) {
    next(err);
  }
});

export const adminRoutes = router;