import { Role, AmbulanceType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { prisma } from '../src/prisma';

async function main() {
  const adminPassword = await bcrypt.hash('Admin@123456', 10);
  const providerPassword = await bcrypt.hash('Provider@123456', 10);
  const customerPassword = await bcrypt.hash('Customer@123456', 10);

  // ১. Admin তৈরি
  const admin = await prisma.user.upsert({
    where: { email: 'admin@dispatch.com' },
    update: {},
    create: {
      name: 'Central Admin',
      email: 'admin@dispatch.com',
      phone: '+8801700000001',
      password: adminPassword,
      role: Role.ADMIN,
      isVerified: true,
    },
  });

  // ২. Provider তৈরি (Driver Profile এবং Ambulance সহ)
  const provider = await prisma.user.upsert({
    where: { email: 'provider1@dispatch.com' },
    update: {},
    create: {
      name: 'Rahim Ambulance Service',
      email: 'provider1@dispatch.com',
      phone: '+8801700000002',
      password: providerPassword,
      role: Role.PROVIDER,
      isVerified: true,
      providerProfile: {
        create: {
          licenseNumber: 'DHAKA-METRO-D-45210',
          isAvailable: true,
          currentLat: 23.8103,
          currentLng: 90.4125,
          ambulance: {
            create: {
              registrationNo: 'AMB-DHAKA-701',
              type: AmbulanceType.ICU,
              isOperational: true,
            },
          },
        },
      },
    },
  });

  // ৩. Test Customer তৈরি
  const customer = await prisma.user.upsert({
    where: { email: 'customer1@dispatch.com' },
    update: {},
    create: {
      name: 'Hasan Ahmed',
      email: 'customer1@dispatch.com',
      phone: '+8801700000003',
      password: customerPassword,
      role: Role.CUSTOMER,
      isVerified: true,
    },
  });

  console.log('✅ Seed successful:', {
    admin: admin.email,
    provider: provider.email,
    customer: customer.email,
  });
}

main()
  .catch((e) => {
    console.error('❌ Seed execution failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });