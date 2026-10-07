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
import SSLCommerzPayment from "sslcommerz-lts";

const router = Router();

// 1. SSLCommerz Session Init (POST /payment/ssl-init)
router.post(
  "/ssl-init",
  auth(Role.CUSTOMER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user;
      const { rideId } = req.body;

      const ride = await prisma.rideRequest.findFirst({
        where: { id: rideId, customerId: user.id },
        include: { customer: true, payment: true },
      });

      if (!ride) {
        res.status(404).json({ success: false, message: "Ride request not found" });
        return;
      }

      if (ride.payment && ride.payment.status === PaymentStatus.PAID) {
        res.status(400).json({ success: false, message: "Ride is already paid for" });
        return;
      }

      const store_id = process.env.STORE_ID || "testbox";
      const store_passwd = process.env.STORE_PASS || "qwerty";
      const is_live = process.env.IS_LIVE === "true";

      const tran_id = `SSLCZ_${Date.now()}_${ride.id.slice(-6)}`;
      const backendBase = process.env.BACKEND_URL || "http://localhost:5000";

      await prisma.payment.upsert({
        where: { rideRequestId: ride.id },
        update: {
          transactionId: tran_id,
          provider: "SSLCOMMERZ",
          status: PaymentStatus.PENDING,
          amount: ride.fareAmount,
        },
        create: {
          rideRequestId: ride.id,
          amount: ride.fareAmount,
          transactionId: tran_id,
          provider: "SSLCOMMERZ",
          status: PaymentStatus.PENDING,
        },
      });

      const sslData = {
        total_amount: ride.fareAmount,
        currency: "BDT",
        tran_id: tran_id,
        success_url: `${backendBase}/payment/ssl-success?rideId=${ride.id}&tran_id=${tran_id}`,
        fail_url: `${backendBase}/payment/ssl-fail?rideId=${ride.id}`,
        cancel_url: `${backendBase}/payment/ssl-cancel?rideId=${ride.id}`,
        ipn_url: `${backendBase}/payment/ssl-ipn`,
        shipping_method: "NO",
        product_name: "Emergency Ambulance Dispatch",
        product_category: "Healthcare",
        product_profile: "general",
        cus_name: ride.customer?.name || user.name || "Customer",
        cus_email: ride.customer?.email || user.email || "customer@example.com",
        cus_add1: ride.pickupAddress || "Dhaka",
        cus_city: "Dhaka",
        cus_postcode: "1207",
        cus_country: "Bangladesh",
        cus_phone: ride.customer?.phone || "01700000000",
      };

      const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
      const apiResponse = await sslcz.init(sslData);

      if (apiResponse?.GatewayPageURL) {
        res.status(200).json({
          success: true,
          message: "SSLCommerz session initialized",
          data: {
            GatewayPageURL: apiResponse.GatewayPageURL,
          },
        });
        return;
      }

      res.status(400).json({
        success: false,
        message: "Failed to initialize SSLCommerz gateway URL",
      });
    } catch (err) {
      next(err);
    }
  }
);

// SSLCommerz Success / Fail / Cancel Callbacks
router.post("/ssl-success", async (req: Request, res: Response) => {
  const { rideId, tran_id } = req.query as { rideId: string; tran_id: string };
  const frontendBase = process.env.FRONTEND_URL || "http://localhost:3000";

  try {
    if (rideId) {
      await prisma.$transaction(async (tx) => {
        await tx.payment.updateMany({
          where: { rideRequestId: rideId },
          data: {
            status: PaymentStatus.PAID,
            provider: "SSLCOMMERZ",
            ...(tran_id ? { transactionId: tran_id } : {}),
          },
        });
        const updatedRide = await tx.rideRequest.update({
          where: { id: rideId },
          data: { status: DispatchStatus.COMPLETED },
        });

        if (updatedRide.providerId) {
          await tx.ambulance.updateMany({
            where: { providerId: updatedRide.providerId },
            data: { isOperational: true },
          });
          await tx.providerProfile.updateMany({
            where: { id: updatedRide.providerId },
            data: { isAvailable: true },
          });
        }
      });
    }

    res.redirect(`${frontendBase}/customer/dashboard?payment=success`);
  } catch (error) {
    console.error("SSL Success Error:", error);
    res.redirect(`${frontendBase}/customer/dashboard?payment=error`);
  }
});

router.post("/ssl-fail", async (req: Request, res: Response) => {
  const frontendBase = process.env.FRONTEND_URL || "http://localhost:3000";
  res.redirect(`${frontendBase}/customer/dashboard?payment=failed`);
});

router.post("/ssl-cancel", async (req: Request, res: Response) => {
  const frontendBase = process.env.FRONTEND_URL || "http://localhost:3000";
  res.redirect(`${frontendBase}/customer/dashboard?payment=cancelled`);
});

// 2. Pay for Ride (Direct / Manual Payment)
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
  }
);

// 3. Initiate Stripe Checkout Session
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
  }
);

// 4. Secure Stripe Webhook Handler
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
        webhookSecret
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
          await txAmbulanceUpdate(updatedRide.providerId);
        }
      }
    } catch (webhookErr) {
      console.error("Webhook processing error:", webhookErr);
    }
  }

  res.status(200).json({ received: true });
});

async function txAmbulanceUpdate(providerId: string) {
  await prisma.ambulance.updateMany({
    where: { providerId },
    data: { isOperational: true },
  });
  await prisma.providerProfile.updateMany({
    where: { id: providerId },
    data: { isAvailable: true },
  });
}

// 5. Get Payment Status By Request ID
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
  }
);

// 6. Payment History
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
  }
);

export const paymentRoutes = router;