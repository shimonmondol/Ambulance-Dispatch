🚀 Getting Started
1. Installation & Prisma Migration
Bash
# Clone the repository
git clone <repository-url>
cd ambulance-dispatch

# Install dependencies
npm install

# Push schema to database and generate client
npx prisma db push
npx prisma generate
2. Run the Development Server
Bash
npm run dev
The server will start at http://localhost:5000.

📡 Core API Endpoints
🔐 Authentication (/auth)
POST /auth/register - Register a new user (Customer or Provider)

POST /auth/login - Login and get JWT token

🚑 Fleet Management (/ambulances)
POST /ambulances - Add ambulance to fleet (Admin / Provider only)

GET /ambulances - View available ambulances

PATCH /ambulances/:id/status - Update vehicle status / coordinates

📍 Emergency Rides (/rides)
POST /rides - Request emergency ambulance (Customer only)

PATCH /rides/:id/assign - Assign ambulance to ride (Admin / Provider)

GET /rides/:id - Get specific ride details

💳 Payments & Webhook (/payments)
POST /payments/create-checkout-session/:requestId - Create Stripe Hosted Checkout URL (Customer only)

POST /payments/webhook - Stripe Webhook handler (checkout.session.completed)

GET /payments/:requestId/status - Check live ride payment status

GET /payments - Payment history ledger

🧪 Stripe Webhook Local Testing
Start listening to local webhook events:

Bash
stripe listen --forward-to localhost:5000/payments/webhook
Copy the signing secret (whsec_...) printed in your terminal and update STRIPE_WEBHOOK_SECRET in your .env.


Bash
stripe events resend <evt_id>
🏗️ Production Build
Bash
# Compile TypeScript to JavaScript
npm run build

# Start production server
npm run dev