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

// Initiate Stripe Checkout Session (CUSTOMER only)
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

      // Stripe Checkout Session
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

// Secure Stripe Webhook Handler (No Auth middleware - Signature verified)
router.post("/webhook", async (req: Request, res: Response): Promise<void> => {
  const sig = req.headers["stripe-signature"] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: any;

  try {
    const rawBody = (req as any).rawBody || req.body;
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      webhookSecret as string,
    );
  } catch (err: any) {
    console.error(`⚠️ Webhook signature verification failed: ${err.message}`);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const rideRequestId =
      session.client_reference_id || session.metadata?.rideRequestId;
    const paymentIntentId = session.payment_intent as string;

    if (rideRequestId) {
      try {
        await prisma.$transaction(async (tx) => {
          const payment = await tx.payment.update({
            where: { rideRequestId },
            data: {
              status: PaymentStatus.PAID,
              transactionId: paymentIntentId || session.id,
              paymentGatewayData: session,
            },
          });

          const ride = await tx.rideRequest.update({
            where: { id: rideRequestId },
            data: { status: DispatchStatus.COMPLETED },
          });

          if (ride.providerId) {
            const ambulance = await tx.ambulance.findFirst({
              where: { providerId: ride.providerId },
            });
            if (ambulance) {
              await tx.ambulance.update({
                where: { id: ambulance.id },
                data: { isOperational: true },
              });
            }
          }

          await tx.auditLog.create({
            data: {
              userId: ride.customerId,
              entity: "Payment",
              entityId: payment.id,
              action: "STRIPE_PAYMENT_VERIFIED_PAID",
              metadata: {
                sessionId: session.id,
                paymentIntent: paymentIntentId,
                amountTotal: session.amount_total,
              },
            },
          });
        });
      } catch (dbError) {
        console.error("Database transaction error in Stripe Webhook:", dbError);
      }
    }
  }

  res.status(200).json({ received: true });
});

// Get Payment Status By Request ID
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

// All Payments Ledger (Admin view)
router.get(
  "/",
  auth(Role.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payments = await prisma.payment.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          rideRequest: {
            select: {
              customerId: true,
              pickupAddress: true,
              destination: true,
            },
          },
        },
      });

      res.status(200).json({
        success: true,
        message: "All payments retrieved successfully",
        data: payments,
      });
    } catch (err) {
      next(err);
    }
  },
);

export const paymentRoutes = router;
