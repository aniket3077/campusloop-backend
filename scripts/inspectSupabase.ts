import prisma from '../src/config/db.js';

async function check() {
  const counts = {
    colleges: await prisma.college.count(),
    collegeAdmins: await prisma.collegeAdmin.count(),
    users: await prisma.user.count(),
    items: await prisma.item.count(),
    itemImages: await prisma.itemImage.count(),
    pickupLocations: await prisma.pickupLocation.count(),
    transactions: await prisma.transaction.count(),
    ratings: await prisma.rating.count(),
    offers: await prisma.offer.count(),
    requests: await prisma.request.count(),
    conversations: await prisma.conversation.count(),
    messages: await prisma.message.count(),
    reports: await prisma.report.count(),
    notifications: await prisma.notification.count(),
    subscriptions: await prisma.subscription.count(),
    revenues: await prisma.revenue.count(),
    auditLogs: await prisma.auditLog.count(),
  };
  console.log('--- DATABASE RECORD COUNTS ---');
  console.table(counts);

  await prisma.$disconnect();
}

check().catch(console.error);
