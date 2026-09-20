import { type Ambulance, AmbulanceType, Role } from '@prisma/client';
import { prisma } from '../../prisma.js';

const createAmbulance = async (payload: {
  registrationNo: string;
  type: AmbulanceType;
  providerId?: string;
}): Promise<Ambulance> => {
  const exists = await prisma.ambulance.findUnique({
    where: { registrationNo: payload.registrationNo },
  });

  if (exists) {
    throw new Error('Ambulance with this registration number already exists');
  }

  return prisma.ambulance.create({
    data: payload,
  });
};

const getAllAmbulances = async (query: {
  type?: AmbulanceType;
  isOperational?: string;
}) => {
  const filter: any = { deletedAt: null };

  if (query.type) filter.type = query.type;
  if (query.isOperational !== undefined) {
    filter.isOperational = query.isOperational === 'true';
  }

  return prisma.ambulance.findMany({
    where: filter,
    include: {
      provider: {
        include: {
          user: {
            select: { name: true, phone: true },
          },
        },
      },
    },
  });
};

const getAmbulanceById = async (id: string) => {
  const ambulance = await prisma.ambulance.findFirst({
    where: { id, deletedAt: null },
    include: { provider: true },
  });

  if (!ambulance) throw new Error('Ambulance not found');
  return ambulance;
};

const updateAmbulance = async (
  id: string,
  payload: Partial<Ambulance>
): Promise<Ambulance> => {
  await getAmbulanceById(id);
  return prisma.ambulance.update({
    where: { id },
    data: payload,
  });
};

const softDeleteAmbulance = async (id: string): Promise<Ambulance> => {
  await getAmbulanceById(id);
  return prisma.ambulance.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
};

export const AmbulanceService = {
  createAmbulance,
  getAllAmbulances,
  getAmbulanceById,
  updateAmbulance,
  softDeleteAmbulance,
};