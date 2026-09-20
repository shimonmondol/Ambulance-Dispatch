import { z } from 'zod';
import { Role, AmbulanceType, DispatchStatus, PaymentStatus } from '@prisma/client';

export const registerValidationSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  phone: z.string().min(10, 'Phone must be at least 10 characters'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.nativeEnum(Role).optional(),
  licenseNumber: z.string().optional(),
});

export const loginValidationSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const createAmbulanceValidationSchema = z.object({
  registrationNo: z.string().min(4, 'Registration number is required'),
  type: z.nativeEnum(AmbulanceType),
});

export const updateAmbulanceValidationSchema = z.object({
  registrationNo: z.string().optional(),
  type: z.nativeEnum(AmbulanceType).optional(),
  isOperational: z.boolean().optional(),
});

export const createRideValidationSchema = z.object({
  pickupLocation: z.string().min(3, 'Pickup location is required'),
  dropLocation: z.string().min(3, 'Drop location is required'),
  ambulanceType: z.nativeEnum(AmbulanceType).optional(),
});

export const assignAmbulanceValidationSchema = z.object({
  ambulanceId: z.string().uuid('Valid ambulance UUID required'),
});

export const updateRideStatusValidationSchema = z.object({
  status: z.nativeEnum(DispatchStatus),
});

export const processPaymentValidationSchema = z.object({
  transactionId: z.string().min(5, 'Transaction ID is required'),
});