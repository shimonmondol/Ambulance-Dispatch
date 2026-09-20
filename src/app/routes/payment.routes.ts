import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { Role, PaymentStatus } from "@prisma/client";
import { prisma } from '../../prisma.js';
import { auth } from '../middlewares/auth.js';
import { validateRequest } from '../middlewares/validateRequest.js';
import { processPaymentValidationSchema } from '../validations/dispatch.validation.js';

const router = Router();

// Process Payment for Ride
router.post(
  "/:requestId/pay",
  auth(Role.CUSTOMER),
  validateRequest(processPaymentValidationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requestId = req.params.requestId as string;
      const { transactionId } = req.body;

      const payment = await prisma.payment.findUnique({
        where: {
          rideRequestId: requestId,
        },
      });

      if (!payment) {
        res
          .status(404)
          .json({ success: false, message: "Payment record not found" });
        return;
      }

      if (payment.status === PaymentStatus.PAID) {
        res
          .status(400)
          .json({ success: false, message: "Payment already completed" });
        return;
      }

      const updatedPayment = await prisma.payment.update({
        where: {
          rideRequestId: requestId,
        },
        data: {
          transactionId,
          status: PaymentStatus.PAID,
        },
      });

      res.status(200).json({
        success: true,
        message: "Payment processed successfully",
        data: updatedPayment,
      });
    } catch (err: any) {
      if (err.code === "P2002") {
        res
          .status(400)
          .json({ success: false, message: "Duplicate transaction ID" });
        return;
      }
      next(err);
    }
  },
);

// Get Payment By Request ID
router.get(
  "/:requestId",
  auth(Role.ADMIN, Role.CUSTOMER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requestId = req.params.requestId as string;
      const payment = await prisma.payment.findUnique({
        where: { rideRequestId: requestId },
        include: { rideRequest: true },
      });

      if (!payment) {
        res.status(404).json({ success: false, message: "Payment not found" });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Payment record fetched",
        data: payment,
      });
    } catch (err) {
      next(err);
    }
  },
);

// All Payments (Admin view with pagination)
router.get(
  "/",
  auth(Role.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payments = await prisma.payment.findMany({
        orderBy: { createdAt: "desc" },
        include: { rideRequest: true },
      });
      res.status(200).json({
        success: true,
        message: "All payments retrieved",
        data: payments,
      });
    } catch (err) {
      next(err);
    }
  },
);

export const paymentRoutes = router;
