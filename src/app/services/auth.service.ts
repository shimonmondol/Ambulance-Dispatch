import bcrypt from 'bcrypt';
import { Role, type User } from '@prisma/client';
import { prisma } from '../../prisma.js';
import { jwtHelpers } from '../utils/jwtHelpers.js';

const registerUser = async (payload: {
  name: string;
  email: string;
  phone: string;
  password: string;
  role?: Role;
  licenseNumber?: string;
}): Promise<Omit<User, 'password'>> => {
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ email: payload.email }, { phone: payload.phone }],
    },
  });

  if (existingUser) {
    throw new Error('User with this email or phone already exists');
  }

  const hashedPassword = await bcrypt.hash(payload.password, 10);
  const userRole = payload.role || Role.CUSTOMER;

  return prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        password: hashedPassword,
        role: userRole,
      },
    });

    if (userRole === Role.PROVIDER) {
      if (!payload.licenseNumber) {
        throw new Error('License number is required for Provider registration');
      }
      await tx.providerProfile.create({
        data: {
          userId: newUser.id,
          licenseNumber: payload.licenseNumber,
        },
      });
    }

    const { password, ...result } = newUser;
    return result as Omit<User, 'password'>;
  });
};

const loginUser = async (payload: { email: string; password: string }) => {
  const user = await prisma.user.findUnique({
    where: { email: payload.email },
  });

  if (!user || user.deletedAt) {
    throw new Error('User not found or account deactivated');
  }

  const isPasswordValid = await bcrypt.compare(payload.password, user.password);
  if (!isPasswordValid) {
    throw new Error('Invalid email or password');
  }

  const jwtPayload = { id: user.id, email: user.email, role: user.role };

  const accessToken = jwtHelpers.generateToken(
    jwtPayload,
    process.env.JWT_ACCESS_SECRET as string,
    '1d'
  );

  const refreshToken = jwtHelpers.generateToken(
    jwtPayload,
    process.env.JWT_REFRESH_SECRET as string,
    '7d'
  );

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  };
};

export const AuthService = {
  registerUser,
  loginUser,
};