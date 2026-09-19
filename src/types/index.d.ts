import { Role } from '@prisma/client';

export type TJwtPayload = {
  id: string;
  email: string;
  role: Role;
};

declare global {
  namespace Express {
    interface Request {
      user?: TJwtPayload;
    }
  }
}