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

app.use((req, res, next) => {
  if (req.originalUrl.includes('/webhook')) {
    express.raw({ type: '*/*' })(req, res, next);
  } else {
    express.json()(req, res, next);
  }
});

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
    app.listen(PORT);
  } catch {
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();