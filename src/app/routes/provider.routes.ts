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
// 1. Get Provider Profile & Duty Availability Status
// ==========================================
router.get(
  "/profile",
  auth(Role.PROVIDER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user;

      const profile = await prisma.providerProfile.findUnique({
        where: { userId: user.id },
        include: {
          ambulance: true,
          user: {
            select: { id: true, name: true, email: true, phone: true },
          },
        },
      });

      if (!profile) {
        res
          .status(404)
          .json({ success: false, message: "Provider profile not found" });
        return;
      }

      res.status(200).json({ success: true, data: profile });
    } catch (err) {
      next(err);
    }
  },
);

// ==========================================
// 2. Update Provider Profile & Assigned Vehicle Information
// ==========================================
router.put(
  "/profile",
  auth(Role.PROVIDER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user;
      const { name, phone, licenseNo, registrationNo, ambulanceType } = req.body;

      // Update primary user contact credentials
      await prisma.user.update({
        where: { id: user.id },
        data: {
          ...(name ? { name } : {}),
          ...(phone ? { phone } : {}),
        },
      });

      // Upsert provider profile record
      const profile = await prisma.providerProfile.upsert({
        where: { userId: user.id },
        update: {
          licenseNumber: licenseNo,
        },
        create: {
          userId: user.id,
          licenseNumber: licenseNo,
          isAvailable: true,
        },
      });

      // Update or attach ambulance equipment record if provided
      if (registrationNo && ambulanceType) {
        const existingAmbulance = await prisma.ambulance.findFirst({
          where: { providerId: profile.id },
        });

        if (existingAmbulance) {
          await prisma.ambulance.update({
            where: { id: existingAmbulance.id },
            data: {
              registrationNo,
              type: ambulanceType,
            },
          });
        } else {
          await prisma.ambulance.create({
            data: {
              registrationNo,
              type: ambulanceType,
              providerId: profile.id,
              isOperational: true,
            },
          });
        }
      }

      res.status(200).json({
        success: true,
        message: "Provider Profile Updated Successfully",
      });
    } catch (err) {
      next(err);
    }
  },
);

// ==========================================
// 3. Toggle Provider Online / Offline Duty Availability
// ==========================================
router.patch(
  "/status",
  auth(Role.PROVIDER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user;
      const { isAvailable } = req.body;

      const profile = await prisma.providerProfile.findUnique({
        where: { userId: user.id },
      });

      if (!profile) {
        res
          .status(404)
          .json({ success: false, message: "Provider profile not found" });
        return;
      }

      const updatedProfile = await prisma.providerProfile.update({
        where: { id: profile.id },
        data: { isAvailable: Boolean(isAvailable) },
      });

      res.status(200).json({
        success: true,
        message: `Duty status updated to ${isAvailable ? "ONLINE" : "OFFLINE"}`,
        data: updatedProfile,
      });
    } catch (err) {
      next(err);
    }
  },
);


// 4. Get Provider Assigned Tasks & Incoming Rides
router.get(
  "/tasks",
  auth(Role.PROVIDER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user;
      const status = req.query.status as string;

      const profile = await prisma.providerProfile.findFirst({
        where: { userId: user.id },
      });

      const profileId = profile?.id;
      const userId = user.id;

      // Provider matching list (covers both direct userId and profileId)
      const providerConditions: any[] = [{ providerId: userId }];
      if (profileId) {
        providerConditions.push({ providerId: profileId });
      }

      let whereClause: any = {};

      if (!status || status === "ALL") {
        // Show all rides associated with this provider OR unassigned rides
        whereClause = {
          OR: [
            ...providerConditions,
            { providerId: null },
          ],
        };
      } else if (status === "PENDING") {
        whereClause = {
          status: DispatchStatus.PENDING,
          OR: [
            ...providerConditions,
            { providerId: null },
          ],
        };
      } else {
        whereClause = {
          status: status as DispatchStatus,
          OR: [
            ...providerConditions,
            { providerId: null },
          ],
        };
      }

      const rides = await prisma.rideRequest.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        include: {
          customer: {
            select: { id: true, name: true, phone: true },
          },
          payment: {
            select: {
              id: true,
              amount: true,
              status: true,
              transactionId: true,
            },
          },
        },
      });

      console.log(`[Provider Tasks] Found ${rides.length} rides for status filter: ${status || "ALL"}`);

      res.status(200).json({ success: true, data: rides });
    } catch (err) {
      console.error("[Provider Tasks Error]:", err);
      next(err);
    }
  },
);


// 5. Accept Dispatch Ride Request
router.patch(
  "/rides/:id/accept",
  auth(Role.PROVIDER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user;
      const rideId = req.params.id as string;

      const profile = await prisma.providerProfile.findFirst({
        where: { userId: user.id },
      });

      if (!profile) {
        res
          .status(404)
          .json({ success: false, message: "Provider profile not found" });
        return;
      }

      const ride = await prisma.rideRequest.findUnique({
        where: { id: rideId },
      });

      if (!ride) {
        res.status(404).json({ success: false, message: "Ride not found" });
        return;
      }

      if (ride.providerId && ride.providerId !== profile.id && ride.providerId !== user.id) {
        res.status(400).json({
          success: false,
          message: "Ride has already been accepted by another provider",
        });
        return;
      }

      const updatedRide = await prisma.$transaction(async (tx) => {
        const result = await tx.rideRequest.update({
          where: { id: rideId },
          data: {
            providerId: profile.id,
            status: DispatchStatus.ACCEPTED,
          },
        });

        // Set provider duty busy
        await tx.providerProfile.update({
          where: { id: profile.id },
          data: { isAvailable: false },
        });

        return result;
      });

      res.status(200).json({
        success: true,
        message: "Ride accepted successfully",
        data: updatedRide,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ==========================================
// 6. Direct Complete or Cancel Ride Request
// ==========================================
router.patch(
  "/rides/:id/status",
  auth(Role.PROVIDER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user;
      const rideId = req.params.id as string;
      const { status } = req.body;

      const profile = await prisma.providerProfile.findFirst({
        where: { userId: user.id },
      });

      const profileId = profile?.id;
      const targetProviderId = profileId || user.id;

      const updatedRide = await prisma.$transaction(async (tx) => {
        // Update ride status and lock providerId if unassigned
        const ride = await tx.rideRequest.update({
          where: { id: rideId },
          data: {
            status: status as DispatchStatus,
            providerId: targetProviderId,
          },
        });

        // If trip is completed or cancelled, release vehicle and duty availability
        if (
          status === DispatchStatus.COMPLETED ||
          status === DispatchStatus.CANCELLED
        ) {
          if (profileId) {
            await tx.providerProfile.update({
              where: { id: profileId },
              data: { isAvailable: true },
            });

            await tx.ambulance.updateMany({
              where: { providerId: profileId },
              data: { isOperational: true },
            });
          }
        }

        return ride;
      });

      res.status(200).json({
        success: true,
        message: `Ride marked as ${status}`,
        data: updatedRide,
      });
    } catch (err) {
      console.error("[Provider Status Update Error]:", err);
      next(err);
    }
  },
);

// ==========================================
// 7. Provider Earnings & Completed Analytics
// ==========================================
router.get(
  "/earnings",
  auth(Role.PROVIDER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user;

      const profile = await prisma.providerProfile.findFirst({
        where: { userId: user.id },
      });

      const profileId = profile?.id;
      const userId = user.id;

      const providerConditions: any[] = [{ providerId: userId }];
      if (profileId) {
        providerConditions.push({ providerId: profileId });
      }

      // Fetch completed rides matching exact provider dashboard criteria
      const completedRides = await prisma.rideRequest.findMany({
        where: {
          OR: providerConditions,
          status: DispatchStatus.COMPLETED,
        },
        include: {
          payment: {
            select: {
              id: true,
              status: true,
              amount: true,
              transactionId: true,
              provider: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      const totalRevenue = completedRides.reduce(
        (acc, item) => acc + (item.fareAmount || 0),
        0,
      );
      const totalCount = completedRides.length;

      // Group weekly earnings by day of week
      const weeklyMap: Record<string, number> = {
        Sun: 0,
        Mon: 0,
        Tue: 0,
        Wed: 0,
        Thu: 0,
        Fri: 0,
        Sat: 0,
      };

      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

      completedRides.forEach((ride) => {
        const dayIdx = new Date(ride.createdAt).getDay();
        const dayKey = days[dayIdx] ?? "Sun";
        weeklyMap[dayKey] = (weeklyMap[dayKey] || 0) + (ride.fareAmount || 0);
      });
      const chartData = Object.keys(weeklyMap).map((day) => ({
        day,
        amount: weeklyMap[day] ?? 0,
      }));
      res.status(200).json({
        success: true,
        data: {
          totalEarnings: totalRevenue,
          completedTrips: totalCount,
          chartData,
          rides: completedRides,
        },
      });
    } catch (err) {
      console.error("[Earnings Error]:", err);
      next(err);
    }
  },
);

export const providerRoutes = router;