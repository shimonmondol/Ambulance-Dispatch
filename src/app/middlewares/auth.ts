import { type NextFunction, type Request, type Response } from 'express';
import { Role } from '@prisma/client';
import { jwtHelpers } from '../utils/jwtHelpers.js';
import { type TJwtPayload } from '../../types/index.js';

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

      if (!token) {
        res.status(401).json({
          success: false,
          message: 'Unauthorized access. Malformed token format.',
          errors: [],
        });
        return;
      }

      const verifiedUser = jwtHelpers.verifyToken(
        token,
        process.env.JWT_ACCESS_SECRET as string
      ) as TJwtPayload;

      req.user = verifiedUser;

      if (requiredRoles.length && !requiredRoles.includes(verifiedUser.role)) {
        res.status(403).json({
          success: false,
          message: 'Forbidden. You do not have permission to perform this action.',
          errors: [],
        });
        return;
      }

      next();
    } catch (error) {
      res.status(401).json({
        success: false,
        message: 'Invalid or expired token.',
        errors: error instanceof Error ? [error.message] : [],
      });
    }
  };
};