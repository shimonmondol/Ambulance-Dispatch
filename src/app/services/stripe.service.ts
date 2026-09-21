import Stripe from 'stripe';
import dotenv from 'dotenv';

dotenv.config();

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2024-06-20' as any,
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
    const successUrl = `${process.env.FRONTEND_PAYMENT_SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}&rideId=${rideRequestId}`;
    const cancelUrl = `${process.env.FRONTEND_PAYMENT_CANCEL_URL}?rideId=${rideRequestId}`;

    const session = await stripe.checkout.sessions.create({
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
            unit_amount: Math.round(amount * 100), // BDT পয়সা / সেন্টে কনভার্সন
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