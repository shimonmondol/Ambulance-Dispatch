import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { Role, PaymentStatus, DispatchStatus } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { auth } from "../middlewares/auth.js";
// @ts-ignore
import SSLCommerzPayment from "sslcommerz-lts";

const router = Router();

// ==========================================
// ডোমেইন কনফিগারেশন
// ==========================================
const LIVE_BACKEND_URL = "https://ambulance-dispatch-mu.vercel.app";
const LIVE_FRONTEND_URL = "https://ambulance-dispatch-client.vercel.app";

// ব্যাকএন্ডের নিজস্ব বেস URL (SSLCommerz কলব্যাকের জন্য)
function getBackendBaseUrl(req: Request): string {
  if (process.env.BACKEND_URL) {
    return process.env.BACKEND_URL.replace(/\/$/, "");
  }

  if (req.headers.host?.includes("localhost")) {
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    return `${protocol}://${req.get("host")}`;
  }

  return LIVE_BACKEND_URL;
}

// ফ্রন্টএন্ড বেস URL বের করার হেল্পার
function getFrontendBaseUrl(req: Request): string {
  if (process.env.FRONTEND_URL) {
    return process.env.FRONTEND_URL.replace(/\/$/, "");
  }

  const origin = req.headers.origin as string | undefined;
  const referer = req.headers.referer as string | undefined;

  // ক্লায়েন্ট যদি লোকালহোস্টে টেস্ট করে
  if (
    (origin && origin.includes("localhost")) ||
    (referer && referer.includes("localhost")) ||
    req.headers.host?.includes("localhost")
  ) {
    return "http://localhost:3000";
  }

  // লাইভ প্রোডাকশনের ক্লায়েন্ট ডোমেইন
  return LIVE_FRONTEND_URL;
}

// Helper to update ambulance & provider availability
async function updateProviderAndAmbulanceStatus(providerId: string) {
  await prisma.ambulance.updateMany({
    where: { providerId },
    data: { isOperational: true },
  });
  await prisma.providerProfile.updateMany({
    where: { id: providerId },
    data: { isAvailable: true },
  });
}

// ==========================================
// 1. SSLCommerz Session Init (POST /payment/ssl-init)
// ==========================================
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
        res
          .status(404)
          .json({ success: false, message: "Ride request not found" });
        return;
      }

      if (ride.payment && ride.payment.status === PaymentStatus.PAID) {
        res
          .status(400)
          .json({ success: false, message: "Ride is already paid for" });
        return;
      }

      const store_id = process.env.STORE_ID || "testbox";
      const store_passwd = process.env.STORE_PASS || "qwerty";
      const is_live = process.env.IS_LIVE === "true";

      const tran_id = `SSLCZ_${Date.now()}_${ride.id.slice(-6)}`;
      
      // লাইভ ব্যাকএন্ড URL
      const backendBase = getBackendBaseUrl(req);

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
        fail_url: `${backendBase}/payment/ssl-fail?rideId=${ride.id}&tran_id=${tran_id}`,
        cancel_url: `${backendBase}/payment/ssl-cancel?rideId=${ride.id}&tran_id=${tran_id}`,
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
  },
);

// ==========================================
// 2. SSLCommerz Success Callback Handler
// ==========================================
router.post("/ssl-success", async (req: Request, res: Response) => {
  const { rideId, tran_id } = req.query as { rideId: string; tran_id: string };
  const frontendBase = getFrontendBaseUrl(req);

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

    // ফ্রন্টএন্ড সাকসেস পেজে রিডাইরেক্ট
    return res.redirect(
      `${frontendBase}/payment/success?rideId=${rideId}&tran_id=${tran_id || ""}`,
    );
  } catch {
    return res.redirect(
      `${frontendBase}/payment/failed?rideId=${rideId || ""}&reason=server_error`,
    );
  }
});

// ==========================================
// 3. SSLCommerz Cancel Callback Handler
// ==========================================
router.post("/ssl-cancel", async (req: Request, res: Response) => {
  const { rideId, tran_id } = req.query as { rideId: string; tran_id?: string };
  const frontendBase = getFrontendBaseUrl(req);

  try {
    if (rideId) {
      await prisma.$transaction(async (tx) => {
        await tx.payment.updateMany({
          where: { rideRequestId: rideId },
          data: {
            status: PaymentStatus.FAILED,
            provider: "SSLCOMMERZ",
            ...(tran_id ? { transactionId: tran_id } : {}),
          },
        });

        const updatedRide = await tx.rideRequest.update({
          where: { id: rideId },
          data: { status: DispatchStatus.CANCELLED },
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

    // ফ্রন্টএন্ড ফেইল্ড পেজে রিডাইরেক্ট
    return res.redirect(
      `${frontendBase}/payment/failed?rideId=${rideId || ""}&reason=user_cancelled`,
    );
  } catch {
    return res.redirect(
      `${frontendBase}/payment/failed?rideId=${rideId || ""}&reason=server_error`,
    );
  }
});

// ==========================================
// 4. SSLCommerz Fail Callback Handler
// ==========================================
router.post("/ssl-fail", async (req: Request, res: Response) => {
  const { rideId, tran_id } = req.query as { rideId: string; tran_id?: string };
  const frontendBase = getFrontendBaseUrl(req);

  try {
    if (rideId) {
      await prisma.$transaction(async (tx) => {
        await tx.payment.updateMany({
          where: { rideRequestId: rideId },
          data: {
            status: PaymentStatus.FAILED,
            provider: "SSLCOMMERZ",
            ...(tran_id ? { transactionId: tran_id } : {}),
          },
        });

        const updatedRide = await tx.rideRequest.update({
          where: { id: rideId },
          data: { status: DispatchStatus.CANCELLED },
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

    return res.redirect(
      `${frontendBase}/payment/failed?rideId=${rideId || ""}&reason=declined`,
    );
  } catch {
    return res.redirect(
      `${frontendBase}/payment/failed?rideId=${rideId || ""}&reason=server_error`,
    );
  }
});

// ==========================================
// 5. SSLCommerz IPN Handler
// ==========================================
router.post("/ssl-ipn", async (req: Request, res: Response) => {
  try {
    const { tran_id, status } = req.body;

    if (status === "VALID") {
      const payment = await prisma.payment.findFirst({
        where: { transactionId: tran_id },
      });

      if (payment && payment.status !== PaymentStatus.PAID) {
        await prisma.$transaction(async (tx) => {
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: PaymentStatus.PAID, provider: "SSLCOMMERZ" },
          });

          const updatedRide = await tx.rideRequest.update({
            where: { id: payment.rideRequestId },
            data: { status: DispatchStatus.COMPLETED },
          });

          if (updatedRide.providerId) {
            await updateProviderAndAmbulanceStatus(updatedRide.providerId);
          }
        });
      }
    }

    res.status(200).json({ message: "IPN received successfully" });
  } catch (error) {
    res.status(500).json({ message: "IPN processing error", error });
  }
});

// ==========================================
// 6. Direct / Manual Payment (Cash)
// ==========================================
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

// ==========================================
// 7. Get Payment Status By Request ID
// ==========================================
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

// ==========================================
// 8. Payment History
// ==========================================
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

export const paymentRoutes = router;