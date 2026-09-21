import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { prisma } from './prisma.js';
import appRoutes from './app/routes/index.js';
import { globalErrorHandler } from './app/middlewares/globalErrorHandler.js';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);
app.use(cors());

app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      // যদি রিকোয়েস্ট stripe webhook রাউটে আসে তবে raw buffer রেখে দেওয়া হয়
      if (req.originalUrl.includes('/webhook')) {
        req.rawBody = buf;
      }
    },
  })
);
app.use(express.urlencoded({ extended: true }));

app.get('/', (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'Emergency Ambulance Dispatch Server is Running',
  });
});

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

app.use('/', appRoutes);

app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: 'Route Not Found',
    path: req.originalUrl,
  });
});

app.use(globalErrorHandler);

async function main() {
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

main();