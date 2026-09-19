import { prisma } from '../../../src/prisma.js';

const getMyProfile = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      isVerified: true,
      createdAt: true,
      providerProfile: {
        include: {
          ambulance: true,
        },
      },
    },
  });

  if (!user) throw new Error('User profile not found');
  return user;
};

const updateMyProfile = async (
  userId: string,
  payload: { name?: string; phone?: string }
) => {
  return prisma.user.update({
    where: { id: userId },
    data: payload,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      updatedAt: true,
    },
  });
};

export const UserService = {
  getMyProfile,
  updateMyProfile,
};