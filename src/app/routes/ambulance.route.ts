import { Router, type Request, type Response, type NextFunction } from 'express';
import { Role, AmbulanceType } from '@prisma/client';
import { prisma } from '../../prisma.js';
import { auth } from '../middlewares/auth.js';

const router = Router();

// Create (ADMIN only)
router.post('/', auth(Role.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { registrationNo, type } = req.body;
    const ambulance = await prisma.ambulance.create({
      data: { registrationNo, type: type as AmbulanceType },
    });
    res.status(201).json({ success: true, message: 'Ambulance created', data: ambulance });
  } catch (err) {
    next(err);
  }
});

// List All (Filtered & Non-deleted)
router.get('/', auth(Role.ADMIN, Role.PROVIDER, Role.CUSTOMER), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type, isOperational } = req.query;
    const filter: any = { deletedAt: null };

    if (type) filter.type = type as AmbulanceType;
    if (isOperational !== undefined) filter.isOperational = isOperational === 'true';

    const ambulances = await prisma.ambulance.findMany({
      where: filter,
      include: { provider: true },
    });

    res.status(200).json({ success: true, message: 'Ambulances retrieved', data: ambulances });
  } catch (err) {
    next(err);
  }
});

// Get By ID
router.get('/:id', auth(Role.ADMIN, Role.PROVIDER, Role.CUSTOMER), async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const ambulance = await prisma.ambulance.findFirst({
      where: { id, deletedAt: null },
      include: { provider: true },
    });

    if (!ambulance) {
      res.status(404).json({ success: false, message: 'Ambulance not found', errors: [] });
      return;
    }

    res.status(200).json({ success: true, message: 'Ambulance details retrieved', data: ambulance });
  } catch (err) {
    next(err);
  }
});

// Update (ADMIN only)
router.patch('/:id', auth(Role.ADMIN), async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const updated = await prisma.ambulance.update({
      where: { id },
      data: req.body,
    });
    res.status(200).json({ success: true, message: 'Ambulance updated', data: updated });
  } catch (err) {
    next(err);
  }
});

// Soft Delete (ADMIN only)
router.delete('/:id', auth(Role.ADMIN), async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const deleted = await prisma.ambulance.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    res.status(200).json({ success: true, message: 'Ambulance soft deleted', data: deleted });
  } catch (err) {
    next(err);
  }
});

export const ambulanceRoutes = router;