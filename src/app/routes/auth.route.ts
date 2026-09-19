import { Router, type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt, { type Secret } from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { prisma } from '../.././prisma.js';

const router = Router();
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'super_access_secret_key';

// Register
router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, phone, password, role, licenseNumber } = req.body;

    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email }, { phone }] },
    });

    if (existingUser) {
      res.status(400).json({ success: false, message: 'Email or phone already exists', errors: [] });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userRole = role || Role.CUSTOMER;

    const result = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: { name, email, phone, password: hashedPassword, role: userRole },
      });

      if (userRole === Role.PROVIDER) {
        if (!licenseNumber) throw new Error('License number is required for Provider registration');
        await tx.providerProfile.create({
          data: { userId: newUser.id, licenseNumber },
        });
      }

      const { password: _, ...userWithoutPass } = newUser;
      return userWithoutPass;
    });

    res.status(201).json({ success: true, message: 'User registered successfully', data: result });
  } catch (err) {
    next(err);
  }
});

// Login
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.deletedAt) {
      res.status(404).json({ success: false, message: 'User not found or deactivated', errors: [] });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      res.status(401).json({ success: false, message: 'Invalid credentials', errors: [] });
      return;
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_ACCESS_SECRET as Secret,
      { expiresIn: '1d' }
    );

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        accessToken: token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
      },
    });
  } catch (err) {
    next(err);
  }
});

export const authRoutes = router;