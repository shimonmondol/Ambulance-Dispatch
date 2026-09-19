import type { NextFunction, Request, Response } from 'express';
import jwt, { type Secret } from 'jsonwebtoken';
import { Role } from '@prisma/client';

export type TJwtPayload = {
  id: string;
  email: string;
  role: Role;
};

export const auth = (...requiredRoles: Role[]) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({
          success: false,
          message: 'Unauthorized access. No token provided.',
          errors: [],
        });
        return;
      }

      const token = authHeader.split(' ')[1];
      const secret = (process.env.JWT_ACCESS_SECRET || 'super_access_secret_key') as Secret;

      // Type error fix: Convert to unknown first
      const verifiedUser = jwt.verify(token!, secret) as unknown as TJwtPayload;

      (req as any).user = verifiedUser;

      if (requiredRoles.length && !requiredRoles.includes(verifiedUser.role)) {
        res.status(403).json({
          success: false,
          message: 'Forbidden. You do not have permission to perform this action.',
          errors: [],
        });
        return;
      }

      next();
    } catch (error: any) {
      res.status(401).json({
        success: false,
        message: 'Invalid or expired token.',
        errors: [error.message],
      });
    }
  };
};