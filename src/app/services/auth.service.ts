import bcrypt from 'bcrypt';
import { Role, type User } from '@prisma/client';
import { prisma } from '../../prisma.js';
import { jwtHelpers } from '../utils/jwtHelpers.js';

// Custom AppError class to pass explicit status code to globalErrorHandler
class AppError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

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
    throw new AppError(409, 'User with this email or phone already exists');
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
        throw new AppError(400, 'License number is required for Provider registration');
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
  console.log('\n================== [LOGIN ATTEMPT DEBUG] ==================');
  console.log('1. Payload received -> Email:', payload.email, '| Password typed:', payload.password);

  // ১. ইউজারকে ডাটাবেসে খোঁজা
  const user = await prisma.user.findUnique({
    where: { email: payload.email },
  });

  if (!user || user.deletedAt) {
    console.log('❌ User not found in database or account deactivated');
    console.log('===========================================================\n');
    throw new AppError(404, 'User not found or account deactivated');
  }

  console.log('2. User found -> ID:', user.id, '| Role:', user.role);
  console.log('3. Password in DB (Hashed/Raw):', user.password);

  // ২. পাসওয়ার্ড যাচাই (Bcrypt Compare)
  let isPasswordValid = false;
  try {
    isPasswordValid = await bcrypt.compare(payload.password, user.password);
  } catch (bcryptErr) {
    console.log('⚠️ bcrypt.compare failed to execute (DB password format might not be a valid bcrypt hash):', bcryptErr);
  }

  console.log('4. bcrypt.compare result:', isPasswordValid);

  // ৩. যদি পাসওয়ার্ড না মেলে, সাথে সাথে 401 এরর থ্রো করবে
  if (!isPasswordValid) {
    console.log('⛔ PASSWORDS DO NOT MATCH! THROWING 401 ERROR NOW.');
    console.log('===========================================================\n');
    throw new AppError(401, 'Invalid email or password');
  }

  console.log('✅ Passwords matched! Generating JWT Tokens...');
  console.log('===========================================================\n');

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