import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { Role, AmbulanceType } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { auth } from "../middlewares/auth.js";

const router = Router();

// Create (ADMIN only)
router.post(
  "/",
  auth(Role.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { registrationNo, type } = req.body;
      const ambulance = await prisma.ambulance.create({
        data: { registrationNo, type: type as AmbulanceType },
      });
      res.status(201).json({
        success: true,
        message: "Ambulance Created Successfully",
        data: ambulance,
      });
    } catch (err) {
      next(err);
    }
  },
);

// List All (Filtered & Non-deleted)
router.get(
  "/",
  auth(Role.ADMIN, Role.PROVIDER, Role.CUSTOMER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { type, isOperational } = req.query;
      const filter: any = { deletedAt: null };

      if (type) filter.type = type as AmbulanceType;
      if (isOperational !== undefined)
        filter.isOperational = isOperational === "true";

      const ambulances = await prisma.ambulance.findMany({
        where: filter,
        include: { provider: true },
      });

      res.status(200).json({
        success: true,
        message: "Ambulances Retrieved Successfully",
        data: ambulances,
      });
    } catch (err) {
      next(err);
    }
  },
);

// Get By ID
router.get(
  "/:id",
  auth(Role.ADMIN, Role.PROVIDER, Role.CUSTOMER),
  async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const ambulance = await prisma.ambulance.findFirst({
        where: { id, deletedAt: null },
        include: { provider: true },
      });

      if (!ambulance) {
        res
          .status(404)
          .json({ success: false, message: "Ambulance not found", errors: [] });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Ambulance Details Successfully",
        data: ambulance,
      });
    } catch (err) {
      next(err);
    }
  },
);

// Update (ADMIN only)
router.patch(
  "/:id",
  auth(Role.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;

      if (!id || typeof id !== "string") {
        res.status(400).json({
          success: false,
          message: "Valid ambulance ID is required",
          errors: [],
        });
        return;
      }

      const { registrationNo, type, isOperational } = req.body;

      // ১. অ্যাম্বুলেন্সটি বিদ্যমান কি না চেক
      const existingAmbulance = await prisma.ambulance.findFirst({
        where: { id, deletedAt: null },
      });

      if (!existingAmbulance) {
        res.status(404).json({
          success: false,
          message: "Ambulance not found or already deactivated",
          errors: [],
        });
        return;
      }

      // ২. যদি নতুন registrationNo দেওয়া হয় এবং তা বর্তমানটির চেয়ে আলাদা হয়
      if (
        registrationNo &&
        registrationNo !== existingAmbulance.registrationNo
      ) {
        const duplicate = await prisma.ambulance.findUnique({
          where: { registrationNo },
        });

        if (duplicate) {
          res.status(400).json({
            success: false,
            message: `Ambulance with registration number '${registrationNo}' already exists.`,
            errors: [],
          });
          return;
        }
      }

      // ৩. শুধুমাত্র পাঠানো ফিল্ডগুলো ফিল্টার করা
      const updateData: {
        registrationNo?: string;
        type?: AmbulanceType;
        isOperational?: boolean;
      } = {};

      // registrationNo শুধু তখনই আপডেটে যাবে যদি তা সত্যিই পরিবর্তন হয়ে থাকে
      if (
        registrationNo !== undefined &&
        registrationNo !== existingAmbulance.registrationNo
      ) {
        updateData.registrationNo = registrationNo;
      }
      if (type !== undefined) updateData.type = type as AmbulanceType;
      if (isOperational !== undefined)
        updateData.isOperational = Boolean(isOperational);

      // ৪. আপডেট এক্সিকিউশন
      const updated = await prisma.ambulance.update({
        where: { id },
        data: updateData,
      });

      res.status(200).json({
        success: true,
        message: "Ambulance Updated Successfully",
        data: updated,
      });
    } catch (err: any) {
      // Prisma unique constraint error catch (P2002)
      if (err.code === "P2002") {
        res.status(400).json({
          success: false,
          message:
            "Registration number already exists. Please choose a unique one.",
          errors: [err.message],
        });
        return;
      }
      next(err);
    }
  },
);

// Delete (ADMIN only)
router.delete('/:id', auth(Role.ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;

    const deleted = await prisma.ambulance.delete({
      where: { id },
    });

    res.status(200).json({
      success: true,
      message: 'Ambulance Delete Successfully',
      data: deleted,
    });
  } catch (err) {
    next(err);
  }
});

export const ambulanceRoutes = router;
