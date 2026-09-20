import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { Role, DispatchStatus, PaymentStatus } from "@prisma/client";
import { prisma } from "../.././prisma.js";
import { auth } from "../middlewares/auth.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import {
  createRideValidationSchema,
  assignAmbulanceValidationSchema,
  updateRideStatusValidationSchema,
} from "../validations/dispatch.validation.js";
import { calculatePagination } from "../utils/paginationHelper.js";

const router = Router();

// ১. Create Ride Request (CUSTOMER only)
router.post(
  "/",
  auth(Role.CUSTOMER),
  validateRequest(createRideValidationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user;
      const {
        pickupAddress,
        pickupLat,
        pickupLng,
        destination,
        ambulanceType,
      } = req.body;

      const baseFare = 1200.0;

      const result = await prisma.$transaction(async (tx) => {
        // Payment মডেলে provider required থাকায় 'provider: "CASH"' যোগ করা হয়েছে
        const ride = await tx.rideRequest.create({
          data: {
            customerId: user.id,
            pickupAddress,
            pickupLat: Number(pickupLat),
            pickupLng: Number(pickupLng),
            destination,
            ambulanceType,
            status: DispatchStatus.PENDING,
            fareAmount: baseFare,
            payment: {
              create: {
                amount: baseFare,
                status: PaymentStatus.UNPAID,
                provider: "CASH", // BKASH | STRIPE | SSLCOMMERZ | CASH
              },
            },
          },
          include: {
            payment: true,
          },
        });

        // AuditLog স্কিমা অনুযায়ী entity ও entityId ফিল্ড ব্যবহার করা হয়েছে
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: "DISPATCH_REQUEST_CREATED",
            entity: "RideRequest",
            entityId: ride.id,
          },
        });

        return ride;
      });

      res.status(201).json({
        success: true,
        message: "Emergency ride request created successfully",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ২. List Rides with Pagination, Filtering & Sorting
router.get(
  "/",
  auth(Role.ADMIN, Role.PROVIDER, Role.CUSTOMER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user;
      const { status, searchTerm, page, limit, sortBy, sortOrder } = req.query;
      const pagination = calculatePagination({
        page: page as string,
        limit: limit as string,
        sortBy: (sortBy as string) || "createdAt",
        sortOrder: sortOrder as any,
      });

      const andConditions: any[] = [{ deletedAt: null }];

      // রোল অনুযায়ী ডেটা ফিল্টারিং
      if (user.role === Role.CUSTOMER) {
        andConditions.push({ customerId: user.id });
      } else if (user.role === Role.PROVIDER) {
        // ProviderProfile আইডি পাওয়া গেলে স্কোপ করা
        const profile = await prisma.providerProfile.findUnique({
          where: { userId: user.id },
        });
        if (profile) {
          andConditions.push({ providerId: profile.id });
        }
      }

      if (status) {
        andConditions.push({ status: status as DispatchStatus });
      }

      if (searchTerm) {
        andConditions.push({
          OR: [
            {
              pickupAddress: {
                contains: searchTerm as string,
                mode: "insensitive",
              },
            },
            {
              destination: {
                contains: searchTerm as string,
                mode: "insensitive",
              },
            },
          ],
        });
      }

      const whereConditions = { AND: andConditions };

      const [rides, total] = await Promise.all([
        prisma.rideRequest.findMany({
          where: whereConditions,
          skip: pagination.skip,
          take: pagination.limit,
          orderBy: { [pagination.sortBy]: pagination.sortOrder },
          include: {
            customer: { select: { name: true, phone: true } },
            provider: {
              include: {
                user: { select: { name: true, phone: true } },
                ambulance: true,
              },
            },
            payment: true,
          },
        }),
        prisma.rideRequest.count({ where: whereConditions }),
      ]);

      res.status(200).json({
        success: true,
        message: "Ride requests retrieved successfully",
        meta: {
          page: pagination.page,
          limit: pagination.limit,
          total,
          totalPage: Math.ceil(total / pagination.limit),
        },
        data: rides,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ৩. Get Single Ride Details
router.get(
  "/:id",
  auth(Role.ADMIN, Role.PROVIDER, Role.CUSTOMER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const ride = await prisma.rideRequest.findFirst({
        where: { id, deletedAt: null },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          provider: {
            include: {
              user: { select: { name: true, phone: true } },
              ambulance: true,
            },
          },
          payment: true,
        },
      });

      if (!ride) {
        res
          .status(404)
          .json({ success: false, message: "Ride request not found" });
        return;
      }

      res
        .status(200)
        .json({ success: true, message: "Ride details retrieved", data: ride });
    } catch (err) {
      next(err);
    }
  },
);

// ৪. Assign Provider to Ride
router.patch(
  "/:id/assign",
  auth(Role.ADMIN, Role.PROVIDER),
  validateRequest(assignAmbulanceValidationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const user = (req as any).user;
      const { providerId } = req.body;

      const result = await prisma.$transaction(async (tx) => {
        const ride = await tx.rideRequest.findUnique({ where: { id } });
        if (!ride || ride.status !== DispatchStatus.PENDING) {
          throw new Error(
            "Ride request cannot be assigned (Must be in PENDING state)",
          );
        }

        const updatedRide = await tx.rideRequest.update({
          where: { id },
          data: {
            providerId,
            status: DispatchStatus.ACCEPTED,
          },
        });

        // ড্রাইভার/প্রোভাইডারের স্টেটাস busy করা
        await tx.providerProfile.update({
          where: { id: providerId },
          data: { isAvailable: false },
        });

        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: `PROVIDER_ASSIGNED_${providerId}`,
            entity: "RideRequest",
            entityId: id,
          },
        });

        return updatedRide;
      });

      res.status(200).json({
        success: true,
        message: "Provider assigned successfully",
        data: result,
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  },
);

// ৫. Update Ride Status Lifecycle
router.patch(
  "/:id/status",
  auth(Role.ADMIN, Role.PROVIDER),
  validateRequest(updateRideStatusValidationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const user = (req as any).user;
      const { status } = req.body as { status: DispatchStatus };

      const result = await prisma.$transaction(async (tx) => {
        const currentRide = await tx.rideRequest.findUnique({ where: { id } });
        if (!currentRide) throw new Error("Ride request not found");

        // আপনার স্কিমার DispatchStatus এনাম অনুযায়ী ট্রানজিশন লজিক
        const validTransitions: Record<DispatchStatus, DispatchStatus[]> = {
          PENDING: [DispatchStatus.CANCELLED, DispatchStatus.ACCEPTED],
          ACCEPTED: [DispatchStatus.EN_ROUTE, DispatchStatus.CANCELLED],
          EN_ROUTE: [DispatchStatus.ARRIVED_AT_SCENE, DispatchStatus.CANCELLED],
          ARRIVED_AT_SCENE: [
            DispatchStatus.PATIENT_PICKED_UP,
            DispatchStatus.CANCELLED,
          ],
          PATIENT_PICKED_UP: [
            DispatchStatus.COMPLETED,
            DispatchStatus.CANCELLED,
          ],
          COMPLETED: [],
          CANCELLED: [],
        };

        if (!validTransitions[currentRide.status]?.includes(status)) {
          throw new Error(
            `Cannot transition ride status from ${currentRide.status} to ${status}`,
          );
        }

        const updatedRide = await tx.rideRequest.update({
          where: { id },
          data: { status },
        });

        // রাইড শেষ বা ক্যানসেল হলে প্রোভাইডার আবার Available হবে
        if (
          (status === DispatchStatus.COMPLETED ||
            status === DispatchStatus.CANCELLED) &&
          updatedRide.providerId
        ) {
          await tx.providerProfile.update({
            where: { id: updatedRide.providerId },
            data: { isAvailable: true },
          });
        }

        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: `STATUS_UPDATED_TO_${status}`,
            entity: "RideRequest",
            entityId: id,
          },
        });
        return updatedRide;
      });

      res.status(200).json({
        success: true,
        message: `Ride marked as ${status}`,
        data: result,
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  },
);

// ৬. Cancel Ride Request (Customer)
router.patch(
  "/:id/cancel",
  auth(Role.CUSTOMER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const user = (req as any).user;
      const { cancellationReason } = req.body;

      const result = await prisma.$transaction(async (tx) => {
        const ride = await tx.rideRequest.findFirst({
          where: { id, customerId: user.id, deletedAt: null },
        });

        if (
          !ride ||
          ride.status === DispatchStatus.COMPLETED ||
          ride.status === DispatchStatus.CANCELLED
        ) {
          throw new Error("Ride cannot be cancelled");
        }

        const updated = await tx.rideRequest.update({
          where: { id },
          data: {
            status: DispatchStatus.CANCELLED,
            cancellationReason: cancellationReason || "Cancelled by customer",
          },
        });

        if (updated.providerId) {
          await tx.providerProfile.update({
            where: { id: updated.providerId },
            data: { isAvailable: true },
          });
        }

        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: "RIDE_CANCELLED_BY_CUSTOMER",
            entity: "RideRequest",
            entityId: id,
          },
        });

        return updated;
      });

      res.status(200).json({
        success: true,
        message: "Ride cancelled successfully",
        data: result,
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  },
);

// ৭. Hard Delete Ride (Admin Only)
router.delete(
  "/:id",
  auth(Role.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;

      const existingRide = await prisma.rideRequest.findUnique({
        where: { id },
      });

      if (!existingRide) {
        res.status(404).json({
          success: false,
          message: "Ride request not found",
        });
        return;
      }

      // (Atomic Transaction)
      await prisma.$transaction(async (tx) => {
        await tx.payment.deleteMany({
          where: { rideRequestId: id },
        });
        await tx.rideRequest.delete({
          where: { id },
        });
      });

      res.status(200).json({
        success: true,
        message: "Deleted Successfully",
      });
    } catch (err) {
      next(err);
    }
  },
);

export const rideRoutes = router;
