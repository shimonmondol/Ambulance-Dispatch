import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { Role, PaymentStatus, DispatchStatus } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { auth } from "../middlewares/auth.js";
import { stripe, StripeService } from "../services/stripe.service.js";

const router = Router();

// 1. Pay for Ride (Direct / Manual Payment)
router.post(
  "/:id/pay",
  auth(Role.CUSTOMER, Role.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const user = (req as any).user;

      const payment = await prisma.payment.findFirst({
        where: {
          OR: [{ id }, { rideRequestId: id }],
          ...(user.role === Role.CUSTOMER && {
            rideRequest: { customerId: user.id },
          }),
        },
        include: { rideRequest: true },
      });

      if (!payment) {
        res.status(404).json({
          success: false,
          message: "Payment or Ride request not found",
        });
        return;
      }

      if (payment.status === PaymentStatus.PAID) {
        res.status(400).json({
          success: false,
          message: "Ride has already been paid for",
        });
        return;
      }

      const result = await prisma.$transaction(async (tx) => {
        const updatedPayment = await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.PAID,
            provider: payment.provider || "CASH",
          },
        });

        const updatedRide = await tx.rideRequest.update({
          where: { id: payment.rideRequestId },
          data: { status: DispatchStatus.COMPLETED },
        });

        if (updatedRide.providerId) {
          const ambulance = await tx.ambulance.findFirst({
            where: { providerId: updatedRide.providerId },
          });
          if (ambulance) {
            await tx.ambulance.update({
              where: { id: ambulance.id },
              data: { isOperational: true },
            });
          }

          await tx.providerProfile.update({
            where: { id: updatedRide.providerId },
            data: { isAvailable: true },
          });
        }

        await tx.auditLog.create({
          data: {
            userId: user.id,
            entity: "Payment",
            entityId: payment.id,
            action: "MANUAL_PAYMENT_MARKED_AS_PAID",
          },
        });

        return updatedPayment;
      });

      res.status(200).json({
        success: true,
        message: "Payment completed successfully",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  },
);

// 2. Initiate Stripe Checkout Session (CUSTOMER only)
router.post(
  "/create-checkout-session/:requestId",
  auth(Role.CUSTOMER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requestId = req.params.requestId as string;
      const user = (req as any).user;
      const ride = await prisma.rideRequest.findFirst({
        where: { id: requestId, customerId: user.id, deletedAt: null },
        include: { customer: true, payment: true },
      });

      if (!ride) {
        res.status(404).json({
          success: false,
          message: "Ride request not found",
        });
        return;
      }

      if (ride.payment && ride.payment.status === PaymentStatus.PAID) {
        res.status(400).json({
          success: false,
          message: "Ride has already been paid for",
        });
        return;
      }

      const session = await StripeService.createCheckoutSession({
        amount: ride.fareAmount,
        rideRequestId: ride.id,
        customerEmail: ride.customer.email,
        customerName: ride.customer.name,
      });

      await prisma.payment.upsert({
        where: { rideRequestId: ride.id },
        update: {
          transactionId: session.id,
          provider: "STRIPE",
          status: PaymentStatus.PENDING,
          amount: ride.fareAmount,
        },
        create: {
          rideRequestId: ride.id,
          amount: ride.fareAmount,
          transactionId: session.id,
          provider: "STRIPE",
          status: PaymentStatus.PENDING,
        },
      });

      res.status(200).json({
        success: true,
        message: "Stripe checkout session initialized successfully",
        data: {
          sessionId: session.id,
          paymentUrl: session.url,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// 3. Secure Stripe Webhook Handler
router.post("/webhook", async (req: Request, res: Response): Promise<void> => {
  const sig = req.headers["stripe-signature"] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: any = null;

  let rawString = "";
  if (Buffer.isBuffer(req.body)) {
    rawString = req.body.toString("utf8");
  } else if (typeof req.body === "string") {
    rawString = req.body;
  } else {
    rawString = JSON.stringify(req.body);
  }

  try {
    if (webhookSecret && sig) {
      event = stripe.webhooks.constructEvent(
        Buffer.isBuffer(req.body) ? req.body : rawString,
        sig,
        webhookSecret,
      );
    } else {
      event = JSON.parse(rawString);
    }
  } catch {
    try {
      event = JSON.parse(rawString);
    } catch {
      res.status(400).send("Invalid JSON Payload");
      return;
    }
  }

  const eventType = event?.type;
  const session = event?.data?.object;

  if (eventType === "checkout.session.completed" && session) {
    const sessionId = session.id as string;
    const rideRequestId =
      session.client_reference_id || (session.metadata && session.metadata.rideRequestId);
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.id;

    try {
      await prisma.payment.updateMany({
        where: {
          OR: [
            ...(rideRequestId ? [{ rideRequestId }] : []),
            { transactionId: sessionId },
          ],
        },
        data: {
          status: PaymentStatus.PAID,
          provider: "STRIPE",
          transactionId: paymentIntentId || sessionId,
        },
      });

      const targetRideId =
        rideRequestId ||
        (
          await prisma.payment.findFirst({
            where: { transactionId: sessionId },
            select: { rideRequestId: true },
          })
        )?.rideRequestId;

      if (targetRideId) {
        const updatedRide = await prisma.rideRequest.update({
          where: { id: targetRideId },
          data: { status: DispatchStatus.COMPLETED },
        });

        if (updatedRide.providerId) {
          await prisma.ambulance.updateMany({
            where: { providerId: updatedRide.providerId },
            data: { isOperational: true },
          });
          await prisma.providerProfile.updateMany({
            where: { id: updatedRide.providerId },
            data: { isAvailable: true },
          });
        }
      }
    } catch {
      // Transaction failures handled by database rollback
    }
  }

  res.status(200).json({ received: true });
});

// 4. Get Payment Status By Request ID
router.get(
  "/:requestId/status",
  auth(Role.ADMIN, Role.CUSTOMER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requestId = req.params.requestId as string;
      const payment = await prisma.payment.findUnique({
        where: { rideRequestId: requestId },
        include: {
          rideRequest: {
            select: {
              id: true,
              status: true,
              fareAmount: true,
              pickupAddress: true,
              destination: true,
            },
          },
        },
      });

      if (!payment) {
        res.status(404).json({ success: false, message: "Payment not found" });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Payment status record fetched",
        data: payment,
      });
    } catch (err) {
      next(err);
    }
  },
);

// 5. Payment History / Ledger (CUSTOMER sees own history, ADMIN sees all)
router.get(
  "/",
  auth(Role.ADMIN, Role.CUSTOMER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user;

      const whereCondition =
        user.role === Role.CUSTOMER
          ? { rideRequest: { customerId: user.id } }
          : {};

      const payments = await prisma.payment.findMany({
        where: whereCondition,
        orderBy: { createdAt: "desc" },
        include: {
          rideRequest: {
            select: {
              id: true,
              customerId: true,
              pickupAddress: true,
              destination: true,
              status: true,
            },
          },
        },
      });

      res.status(200).json({
        success: true,
        message: "Payment history retrieved successfully",
        data: payments,
      });
    } catch (err) {
      next(err);
    }
  },
);

// 6. Get Single Payment Details by ID
router.get(
  "/:id",
  auth(Role.ADMIN, Role.CUSTOMER, Role.PROVIDER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const user = (req as any).user;

      const payment = await prisma.payment.findFirst({
        where: {
          OR: [{ id }, { rideRequestId: id }],
          ...(user.role === Role.CUSTOMER && {
            rideRequest: { customerId: user.id },
          }),
        },
        include: {
          rideRequest: true,
        },
      });

      if (!payment) {
        res.status(404).json({ success: false, message: "Payment not found" });
        return;
      }

      res.status(200).json({
        success: true,
        message: "Payment retrieved successfully",
        data: payment,
      });
    } catch (err) {
      next(err);
    }
  },
);

export const paymentRoutes = router;