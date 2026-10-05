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

// ১. Create (ADMIN only - Protected)
router.post(
  "/",
  auth(Role.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, registrationNo, type } = req.body;

      // Type validation check
      if (type && !Object.values(AmbulanceType).includes(type)) {
        res.status(400).json({
          success: false,
          message: `Invalid ambulance type. Allowed types: ${Object.values(AmbulanceType).join(", ")}`,
          errors: [],
        });
        return;
      }

      const ambulance = await prisma.ambulance.create({
        data: {
          name: name ? String(name).trim() : null, // undefined এর বদলে null
          registrationNo,
          type: type as AmbulanceType,
        },
      });

      res.status(201).json({
        success: true,
        message: "Ambulance Created Successfully",
        data: ambulance,
      });
    } catch (err: any) {
      if (err.code === "P2002") {
        res.status(400).json({
          success: false,
          message: "Registration number already exists. Please choose a unique one.",
          errors: [err.message],
        });
        return;
      }
      next(err);
    }
  },
);

// ২. List All (পাবলিক)
router.get(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { type, isOperational, search } = req.query;
      const filter: any = { deletedAt: null };

      if (type) filter.type = type as AmbulanceType;
      if (isOperational !== undefined)
        filter.isOperational = isOperational === "true";
      if (search) {
        filter.OR = [
          { name: { contains: String(search), mode: "insensitive" } },
          { registrationNo: { contains: String(search), mode: "insensitive" } },
        ];
      }

      const ambulances = await prisma.ambulance.findMany({
        where: filter,
        include: { provider: true },
        orderBy: { createdAt: "desc" },
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

// ৩. Get By ID (পাবলিক)
router.get(
  "/:id",
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
        message: "Ambulance Details Retrieved Successfully",
        data: ambulance,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ৪. Update (ADMIN only - Protected)
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

      const { name, registrationNo, type, isOperational } = req.body;

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

      if (type && !Object.values(AmbulanceType).includes(type)) {
        res.status(400).json({
          success: false,
          message: `Invalid ambulance type. Allowed types: ${Object.values(AmbulanceType).join(", ")}`,
          errors: [],
        });
        return;
      }

      const updateData: {
        name?: string | null;
        registrationNo?: string;
        type?: AmbulanceType;
        isOperational?: boolean;
      } = {};

      if (name !== undefined) {
        updateData.name = name ? String(name).trim() : null;
      }
      if (
        registrationNo !== undefined &&
        registrationNo !== existingAmbulance.registrationNo
      ) {
        updateData.registrationNo = registrationNo;
      }
      if (type !== undefined) updateData.type = type as AmbulanceType;
      if (isOperational !== undefined)
        updateData.isOperational = Boolean(isOperational);

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

// ৫. Delete (ADMIN only - Protected)
router.delete(
  "/:id",
  auth(Role.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;

      const deleted = await prisma.ambulance.delete({
        where: { id },
      });

      res.status(200).json({
        success: true,
        message: "Ambulance Deleted Successfully",
        data: deleted,
      });
    } catch (err) {
      next(err);
    }
  },
);

export const ambulanceRoutes = router;