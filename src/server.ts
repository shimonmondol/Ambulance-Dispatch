import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { prisma } from './prisma.js';
import appRoutes from './app/routes/index.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// ১. সিকিউরিটি ও বডি পার্সার
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);
app.use(cors());
app.use(express.json());

// ২. হেলথ চেক এন্ডপয়েন্ট (এখন সরাসরি /health)
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'Emergency Ambulance Dispatch Server is operational',
    data: {
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    },
  });
});

// ৩. মেইন এপিআই রাউটস (কোনো /api/v1 প্রিফিক্স ছাড়া)
app.use('/', appRoutes);

// ৪. হোম রুট
app.get('/', (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'Emergency Ambulance Dispatch Server is Running',
  });
});

// ৫. ৪MD / Route Not Found হ্যান্ডলার
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: 'Route Not Found',
    path: req.originalUrl,
  });
});

// ৬. গ্লোবাল এরর হ্যান্ডলার
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',
    errors: err.errors || [],
  });
});

// ৭. সার্ভার বুটস্ট্র্যাপ
async function main () {
  try {
    await prisma.$connect();
    console.log('✅ Database connected successfully');

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('❌ Failed to connect database:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main ();