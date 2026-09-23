import 'dotenv/config';
import { Role, AmbulanceType } from '@prisma/client';
import bcrypt from 'bcrypt';
import { prisma } from '../src/prisma.js';

const FLEET_TEMPLATES = [
  { type: AmbulanceType.ICU, prefix: 'DHAKA-METRO-ICU', lat: 23.8103, lng: 90.4125 },
  { type: AmbulanceType.ADVANCED_LIFE_SUPPORT, prefix: 'DHAKA-METRO-ALS', lat: 23.7925, lng: 90.4078 },
  { type: AmbulanceType.BASIC_LIFE_SUPPORT, prefix: 'DHAKA-METRO-BLS', lat: 23.7509, lng: 90.3935 },
];

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@gmail.com';
  const adminPassword = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD || 'Admin@123456', 10);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      password: adminPassword,
      role: Role.ADMIN,
      isVerified: true,
    },
    create: {
      name: process.env.SEED_ADMIN_NAME || 'Central Dispatch Admin',
      email: adminEmail,
      phone: process.env.SEED_ADMIN_PHONE || '+8801700000001',
      password: adminPassword,
      role: Role.ADMIN,
      isVerified: true,
    },
  });

  const providerCount = Number(process.env.SEED_PROVIDER_COUNT) || 3;

  for (let i = 1; i <= providerCount; i++) {
    const providerEmail = `provider${i}@dispatch.com`;
    const providerPassword = await bcrypt.hash(`Provider@123456`, 10);
    const template = FLEET_TEMPLATES[(i - 1) % FLEET_TEMPLATES.length];
    const registrationNo = `${template.prefix}-${String(i).padStart(3, '0')}`;
    const licenseNumber = `DL-DHK-${String(45200 + i)}`;

    const existingProvider = await prisma.user.findUnique({
      where: { email: providerEmail },
    });

    if (!existingProvider) {
      await prisma.user.create({
        data: {
          name: `Emergency Provider Unit ${i}`,
          email: providerEmail,
          phone: `+88017000000${String(10 + i)}`,
          password: providerPassword,
          role: Role.PROVIDER,
          isVerified: true,
          providerProfile: {
            create: {
              licenseNumber,
              isAvailable: true,
              currentLat: template.lat,
              currentLng: template.lng,
              ambulance: {
                create: {
                  registrationNo,
                  type: template.type,
                  isOperational: true,
                },
              },
            },
          },
        },
      });
    }
  }

  const customerCount = Number(process.env.SEED_CUSTOMER_COUNT) || 2;

  for (let j = 1; j <= customerCount; j++) {
    const customerEmail = `customer${j}@dispatch.com`;
    const customerPassword = await bcrypt.hash(`Customer@123456`, 10);

    await prisma.user.upsert({
      where: { email: customerEmail },
      update: {
        password: customerPassword,
        role: Role.CUSTOMER,
        isVerified: true,
      },
      create: {
        name: `Emergency Customer ${j}`,
        email: customerEmail,
        phone: `+88018000000${String(20 + j)}`,
        password: customerPassword,
        role: Role.CUSTOMER,
        isVerified: true,
      },
    });
  }
}

main()
  .catch((error) => {
    process.stderr.write(`Database seed failure: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });