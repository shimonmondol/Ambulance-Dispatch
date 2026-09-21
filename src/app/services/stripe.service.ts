import 'dotenv/config';
import Stripe from 'stripe';

let stripeInstance: Stripe | null = null;

export const getStripeClient = (): Stripe => {
  if (!stripeInstance) {
    const secretKey = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder_key';
    stripeInstance = new Stripe(secretKey, {
      apiVersion: '2024-06-20' as any,
    });
  }
  return stripeInstance;
};

export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    const client = getStripeClient();
    const value = (client as any)[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

interface ICreateCheckoutSession {
  amount: number;
  rideRequestId: string;
  customerEmail: string;
  customerName: string;
}

export class StripeService {
  static async createCheckoutSession({
    amount,
    rideRequestId,
    customerEmail,
    customerName,
  }: ICreateCheckoutSession) {
    const client = getStripeClient();

    const frontendSuccess = process.env.FRONTEND_PAYMENT_SUCCESS_URL || 'http://localhost:3000/payment/success';
    const frontendCancel = process.env.FRONTEND_PAYMENT_CANCEL_URL || 'http://localhost:3000/payment/cancel';

    const successUrl = `${frontendSuccess}?session_id={CHECKOUT_SESSION_ID}&rideId=${rideRequestId}`;
    const cancelUrl = `${frontendCancel}?rideId=${rideRequestId}`;

    const session = await client.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: customerEmail,
      client_reference_id: rideRequestId,
      line_items: [
        {
          price_data: {
            currency: 'bdt',
            product_data: {
              name: 'Emergency Ambulance Dispatch Service',
              description: `Emergency ride dispatch fee for request: ${rideRequestId}`,
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      metadata: {
        rideRequestId,
        customerName,
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return session;
  }
}