import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

async function verify() {
  console.log('--- VERIFYING CLEAN DATABASE STATE ---');

  const superAdmin = await prisma.user.findUnique({
    where: { email: 'superadmin@campusloop.in' },
  });
  console.log('Super Admin:', superAdmin?.name, '| Role:', superAdmin?.role, '| Status:', superAdmin?.status);
  const superAdminMatch = await bcrypt.compare('SuperAdmin123!', superAdmin!.passwordHash);
  console.log('Super Admin Password Verified:', superAdminMatch);

  const collegeAdmin = await prisma.user.findUnique({
    where: { email: 'admin@mit.asia' },
  });
  console.log('College Admin:', collegeAdmin?.name, '| Role:', collegeAdmin?.role, '| Status:', collegeAdmin?.status);
  const collegeAdminMatch = await bcrypt.compare('CollegeAdmin123!', collegeAdmin!.passwordHash);
  console.log('College Admin Password Verified:', collegeAdminMatch);

  const studentCount = await prisma.user.count({ where: { role: 'STUDENT' } });
  console.log('Student Count:', studentCount, studentCount === 0 ? '(Clean: 0 demo students)' : '(Has students)');

  const itemCount = await prisma.item.count();
  console.log('Item Count:', itemCount, itemCount === 0 ? '(Clean: 0 demo items)' : '(Has items)');

  const txCount = await prisma.transaction.count();
  console.log('Transaction Count:', txCount, txCount === 0 ? '(Clean: 0 demo transactions)' : '(Has txs)');

  const msgCount = await prisma.message.count();
  console.log('Message Count:', msgCount, msgCount === 0 ? '(Clean: 0 demo messages)' : '(Has messages)');

  await prisma.$disconnect();
}

verify().catch(console.error);
