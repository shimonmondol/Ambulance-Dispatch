import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { Role, DispatchStatus, PaymentStatus } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { auth } from "../middlewares/auth.js";

const router = Router();

// ==========================================
// 1. Dashboard Analytics Overview (Admin)
// ==========================================
router.get(
  "/overview",
  auth(Role.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const [
        totalUsers,
        totalCustomers,
        totalProviders,
        totalAmbulances,
        totalRides,
        completedRides,
        pendingRides,
        cancelledRides,
        paidRevenue,
      ] = await Promise.all([
        prisma.user.count({ where: { deletedAt: null } }),
        prisma.user.count({ where: { role: Role.CUSTOMER, deletedAt: null } }),
        prisma.user.count({ where: { role: Role.PROVIDER, deletedAt: null } }),
        prisma.ambulance.count({ where: { deletedAt: null } }),
        prisma.rideRequest.count({ where: { deletedAt: null } }),
        prisma.rideRequest.count({
          where: { status: DispatchStatus.COMPLETED, deletedAt: null },
        }),
        prisma.rideRequest.count({
          where: { status: DispatchStatus.PENDING, deletedAt: null },
        }),
        prisma.rideRequest.count({
          where: { status: DispatchStatus.CANCELLED, deletedAt: null },
        }),
        prisma.payment.aggregate({
          where: { status: PaymentStatus.PAID },
          _sum: { amount: true },
        }),
      ]);

      // Fetch 5 most recent missions
      const recentRides = await prisma.rideRequest.findMany({
        where: { deletedAt: null },
        take: 5,
        orderBy: { createdAt: "desc" },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          payment: {
            select: {
              id: true,
              status: true,
              amount: true,
              transactionId: true,
            },
          },
        },
      });

      // 7-day revenue trend aggregation
      const weeklyMap: Record<string, number> = {
        Sun: 0,
        Mon: 0,
        Tue: 0,
        Wed: 0,
        Thu: 0,
        Fri: 0,
        Sat: 0,
      };

      const completedTripsList = await prisma.rideRequest.findMany({
        where: { status: DispatchStatus.COMPLETED, deletedAt: null },
        select: { createdAt: true, fareAmount: true },
      });

      const dayNames = [
        "Sun",
        "Mon",
        "Tue",
        "Wed",
        "Thu",
        "Fri",
        "Sat",
      ] as const;

      completedTripsList.forEach((ride) => {
        const dayIdx = new Date(ride.createdAt).getDay();
        const dayKey = dayNames[dayIdx] ?? "Sun";
        weeklyMap[dayKey] = (weeklyMap[dayKey] || 0) + (ride.fareAmount || 0);
      });

      const revenueChart = Object.keys(weeklyMap).map((day) => ({
        day,
        amount: weeklyMap[day] ?? 0,
      }));

      res.status(200).json({
        success: true,
        message: "System analytics retrieved successfully",
        data: {
          metrics: {
            totalUsers,
            totalCustomers,
            totalProviders,
            totalAmbulances,
            totalRides,
            completedRides,
            pendingRides,
            cancelledRides,
            totalRevenue: paidRevenue._sum.amount || 0,
          },
          revenueChart,
          recentRides,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// Alias: /stats endpoint for frontend compatibility
router.get(
  "/stats",
  auth(Role.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    res.redirect(307, `${req.baseUrl}/overview`);
  },
);

// ==========================================
// 2. All Users Management (Admin)
// ==========================================
router.get(
  "/users",
  auth(Role.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const role = req.query.role as Role | undefined;

      const whereClause: any = {};
      if (role && Object.values(Role).includes(role)) {
        whereClause.role = role;
      }

      const users = await prisma.user.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          isVerified: true,
          deletedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      res.status(200).json({
        success: true,
        message: "All users fetched",
        data: users,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ==========================================
// 3. Update User Role
// ==========================================
router.patch(
  "/users/:id/role",
  auth(Role.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const { role } = req.body;

      if (!role || !Object.values(Role).includes(role)) {
        res
          .status(400)
          .json({ success: false, message: "Invalid role specified" });
        return;
      }

      const user = await prisma.user.update({
        where: { id },
        data: { role },
        select: { id: true, name: true, email: true, role: true },
      });

      if (role === Role.PROVIDER) {
        await prisma.providerProfile.upsert({
          where: { userId: id },
          update: {},
          create: {
            userId: id,
            licenseNumber: "PENDING_VERIFICATION",
            isAvailable: false,
          },
        });
      }

      res.status(200).json({
        success: true,
        message: `User role changed to ${role}`,
        data: user,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ==========================================
// 4. Toggle User Verification Status
// ==========================================
router.patch(
  "/users/:id/verify",
  auth(Role.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const { isVerified } = req.body;

      const user = await prisma.user.update({
        where: { id },
        data: {
          isVerified: isVerified !== undefined ? Boolean(isVerified) : true,
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          isVerified: true,
          deletedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      res.status(200).json({
        success: true,
        message: "User verification status updated successfully",
        data: user,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ==========================================
// 5. Suspend / Ban User Account
// ==========================================
router.patch(
  "/users/:id/toggle-ban",
  auth(Role.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;

      const existingUser = await prisma.user.findUnique({
        where: { id },
        select: { id: true, deletedAt: true },
      });

      if (!existingUser) {
        res.status(404).json({ success: false, message: "User not found" });
        return;
      }

      const isBanned = Boolean(existingUser.deletedAt);

      const updatedUser = await prisma.user.update({
        where: { id },
        data: {
          deletedAt: isBanned ? null : new Date(),
        },
        select: {
          id: true,
          name: true,
          email: true,
          deletedAt: true,
        },
      });

      res.status(200).json({
        success: true,
        message: isBanned
          ? "User account unbanned"
          : "User account suspended/banned",
        data: updatedUser,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ==========================================
// 6. Global Ride Requests Master List
// ==========================================
router.get(
  "/rides",
  auth(Role.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = req.query.status as string;

      const whereClause: any = { deletedAt: null };
      if (status && status !== "ALL") {
        whereClause.status = status as DispatchStatus;
      }

      const rides = await prisma.rideRequest.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          payment: {
            select: {
              id: true,
              status: true,
              amount: true,
              transactionId: true,
            },
          },
        },
      });

      res.status(200).json({
        success: true,
        message: "All rides retrieved",
        data: rides,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ==========================================
// 7. Get All Registered Ambulances & Fleets (READ)
// ==========================================
router.get(
  "/ambulances",
  auth(Role.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ambulances = await prisma.ambulance.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: {
          provider: {
            select: {
              id: true,
              licenseNumber: true,
              isAvailable: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phone: true,
                  isVerified: true,
                },
              },
            },
          },
        },
      });

      res.status(200).json({
        success: true,
        message: "Ambulance fleets fetched successfully",
        data: ambulances,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ==========================================
// 8. Create Ambulance (CREATE)
// ==========================================
router.post(
  "/ambulances",
  auth(Role.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { registrationNo, type, name, image, baseFare, perKmFare } =
        req.body;

      if (!registrationNo || !type) {
        res.status(400).json({
          success: false,
          message: "Registration number and ambulance type are required",
        });
        return;
      }

      const existing = await prisma.ambulance.findFirst({
        where: { registrationNo, deletedAt: null },
      });

      if (existing) {
        res.status(400).json({
          success: false,
          message: "Ambulance with this registration number already exists",
        });
        return;
      }

      // providerId ফিল্ড পাঠানো যাবে না; Prisma রিলেশন থাকলে connect করতে হয়, না থাকলে ফিল্ডটি রাখা যাবে না
      const newAmbulance = await prisma.ambulance.create({
        data: {
          registrationNo,
          type,
          name: name || undefined,
          image: image || null,
          isOperational: true,
          // স্কিমায় baseFare বা perKmFare থাকলে সেভ হবে:
          ...((prisma.ambulance as any).fields?.baseFare
            ? { baseFare: Number(baseFare) || 0 }
            : {}),
          ...((prisma.ambulance as any).fields?.perKmFare
            ? { perKmFare: Number(perKmFare) || 0 }
            : {}),
        },
        include: {
          provider: {
            select: {
              licenseNumber: true,
              user: { select: { name: true, phone: true } },
            },
          },
        },
      });

      res.status(201).json({
        success: true,
        message: "Ambulance added successfully",
        data: newAmbulance,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ==========================================
// 9. Update Ambulance Fleet (UPDATE)
// ==========================================
router.put(
  "/ambulances/:id",
  auth(Role.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const {
        registrationNo,
        type,
        name,
        baseFare,
        perKmFare,
        responseTime,
        hasParamedic,
      } = req.body;

      const updated = await prisma.ambulance.update({
        where: { id },
        data: {
          registrationNo,
          type,
          ...((prisma.ambulance as any).fields?.name ? { name } : {}),
          ...((prisma.ambulance as any).fields?.baseFare
            ? { baseFare: Number(baseFare) || 0 }
            : {}),
          ...((prisma.ambulance as any).fields?.perKmFare
            ? { perKmFare: Number(perKmFare) || 0 }
            : {}),
          ...((prisma.ambulance as any).fields?.responseTime
            ? { responseTime }
            : {}),
          ...((prisma.ambulance as any).fields?.hasParamedic
            ? { hasParamedic: Boolean(hasParamedic) }
            : {}),
        },
        include: {
          provider: {
            select: {
              licenseNumber: true,
              user: { select: { name: true, phone: true } },
            },
          },
        },
      });

      res.status(200).json({
        success: true,
        message: "Ambulance updated successfully",
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ==========================================
// 10. Delete Ambulance Fleet (DELETE - Soft Delete)
// ==========================================
router.delete(
  "/ambulances/:id",
  auth(Role.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;

      await prisma.ambulance.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      res.status(200).json({
        success: true,
        message: "Ambulance deleted successfully",
      });
    } catch (err) {
      next(err);
    }
  },
);

// ==========================================
// 11. Verify / Approve Ambulance Fleet
// ==========================================
router.patch(
  "/ambulances/:id/verify",
  auth(Role.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const { isVerified } = req.body;

      const ambulance = await prisma.ambulance.update({
        where: { id },
        data: { isVerified: Boolean(isVerified) },
        include: {
          provider: {
            select: {
              licenseNumber: true,
              user: { select: { name: true, phone: true } },
            },
          },
        },
      });

      res.status(200).json({
        success: true,
        message: `Fleet ${ambulance.registrationNo} verification status updated to ${isVerified ? "VERIFIED" : "PENDING"}`,
        data: ambulance,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ==========================================
// 12. Audit Trail Inspection
// ==========================================
router.get(
  "/audit-logs",
  auth(Role.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const logs = await prisma.auditLog.findMany({
        take: 50,
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
        },
      });

      res.status(200).json({
        success: true,
        message: "System audit logs retrieved",
        data: logs,
      });
    } catch (err) {
      next(err);
    }
  },
);

export const adminRoutes = router;
