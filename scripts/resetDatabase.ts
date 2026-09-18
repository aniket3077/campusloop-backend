import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

const dbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
console.log('Connecting to database:', dbUrl?.replace(/:[^:@]+@/, ':****@'));

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: dbUrl,
    },
  },
});

async function resetDatabase() {
  console.log('\n========================================');
  console.log('  STARTING DATABASE CLEAN RESET');
  console.log('========================================\n');

  console.log('1. Deleting all existing data in reverse dependency order...');
  
  const auditLogsDeleted = await prisma.auditLog.deleteMany();
  console.log(`- Deleted ${auditLogsDeleted.count} audit logs`);

  const revenuesDeleted = await prisma.revenue.deleteMany();
  console.log(`- Deleted ${revenuesDeleted.count} revenues`);

  const subscriptionsDeleted = await prisma.subscription.deleteMany();
  console.log(`- Deleted ${subscriptionsDeleted.count} subscriptions`);

  const notificationsDeleted = await prisma.notification.deleteMany();
  console.log(`- Deleted ${notificationsDeleted.count} notifications`);

  const reportsDeleted = await prisma.report.deleteMany();
  console.log(`- Deleted ${reportsDeleted.count} reports`);

  const ratingsDeleted = await prisma.rating.deleteMany();
  console.log(`- Deleted ${ratingsDeleted.count} ratings`);

  const transactionsDeleted = await prisma.transaction.deleteMany();
  console.log(`- Deleted ${transactionsDeleted.count} transactions`);

  const offersDeleted = await prisma.offer.deleteMany();
  console.log(`- Deleted ${offersDeleted.count} offers`);

  const messagesDeleted = await prisma.message.deleteMany();
  console.log(`- Deleted ${messagesDeleted.count} messages`);

  const conversationsDeleted = await prisma.conversation.deleteMany();
  console.log(`- Deleted ${conversationsDeleted.count} conversations`);

  const requestsDeleted = await prisma.request.deleteMany();
  console.log(`- Deleted ${requestsDeleted.count} requests`);

  const itemImagesDeleted = await prisma.itemImage.deleteMany();
  console.log(`- Deleted ${itemImagesDeleted.count} item images`);

  const itemsDeleted = await prisma.item.deleteMany();
  console.log(`- Deleted ${itemsDeleted.count} items`);

  const pickupLocationsDeleted = await prisma.pickupLocation.deleteMany();
  console.log(`- Deleted ${pickupLocationsDeleted.count} pickup locations`);

  const collegeAdminsDeleted = await prisma.collegeAdmin.deleteMany();
  console.log(`- Deleted ${collegeAdminsDeleted.count} college admin mappings`);

  const usersDeleted = await prisma.user.deleteMany();
  console.log(`- Deleted ${usersDeleted.count} users (including all demo students)`);

  const collegesDeleted = await prisma.college.deleteMany();
  console.log(`- Deleted ${collegesDeleted.count} colleges`);

  console.log('\nAll demo data successfully cleared! Total rows wiped.\n');

  console.log('2. Generating secure password hashes...');
  const salt = await bcrypt.genSalt(10);
  const superAdminHash = await bcrypt.hash('SuperAdmin123!', salt);
  const collegeAdminHash = await bcrypt.hash('CollegeAdmin123!', salt);

  console.log('3. Initializing clean Super Administrator...');
  const superAdmin = await prisma.user.create({
    data: {
      name: 'CampusLoop Super Administrator',
      email: 'superadmin@campusloop.in',
      passwordHash: superAdminHash,
      role: 'SUPER_ADMIN',
      verificationStatus: 'VERIFIED',
      trustRating: 5.0,
      status: 'ACTIVE',
    },
  });
  console.log(`+ Created Super Admin: ${superAdmin.name} (${superAdmin.email}) [ID: ${superAdmin.id}]`);

  console.log('4. Initializing clean base university (MIT CSN)...');
  const mitCsn = await prisma.college.create({
    data: {
      name: 'MIT CSN',
      code: 'MIT_CSN',
      emailDomain: 'mit.asia',
      address: 'MIT CSN Campus, Beed Bypass Road',
      city: 'Chhatrapati Sambhajinagar',
      state: 'Maharashtra',
      country: 'India',
      contactPerson: 'Dr. S. K. Patil',
      contactEmail: 'admin@mit.asia',
      contactPhone: '+91 240 237 5000',
      adminName: 'Prof. A. R. Kulkarni',
      status: 'ACTIVE',
      subscriptionPlan: 'PREMIUM',
      subscriptionStatus: 'ACTIVE',
      circularityScore: 75.0,
      studentCount: 0,
      listingCount: 0,
    },
  });
  console.log(`+ Created College: ${mitCsn.name} (${mitCsn.emailDomain}) [ID: ${mitCsn.id}]`);

  console.log('5. Initializing clean College Administrator...');
  const collegeAdmin = await prisma.user.create({
    data: {
      name: 'MIT CSN Campus Admin',
      email: 'admin@mit.asia',
      passwordHash: collegeAdminHash,
      role: 'COLLEGE_ADMIN',
      collegeId: mitCsn.id,
      verificationStatus: 'VERIFIED',
      trustRating: 5.0,
      status: 'ACTIVE',
    },
  });

  await prisma.collegeAdmin.create({
    data: {
      userId: collegeAdmin.id,
      collegeId: mitCsn.id,
      assignedBy: superAdmin.id,
    },
  });
  console.log(`+ Created College Admin: ${collegeAdmin.name} (${collegeAdmin.email}) [ID: ${collegeAdmin.id}]`);

  console.log('6. Initializing verified campus pickup safe hubs...');
  const hubs = [
    {
      name: 'MIT CSN Main Gate Security Post',
      building: 'MIT CSN Main Entrance Arch',
      description: 'Right beside the Security Information Desk at the Main Gate on Beed Bypass Road.',
      operatingHours: '24/7 (Recommended: 8:00 AM - 8:30 PM)',
      safetyTips: 'Under 24/7 CCTV surveillance and security guard attendance.',
      isDefault: true,
    },
    {
      name: 'MIT CSN Central Library Ground Floor',
      building: 'Central Knowledge & Library Building',
      description: 'Reference section circulation lobby near the digital catalog terminal.',
      operatingHours: '8:00 AM - 10:00 PM',
      safetyTips: 'Quiet, high-visibility academic space with dedicated indoor seating.',
      isDefault: false,
    },
    {
      name: 'Computer Science & Engineering Block Atrium',
      building: 'Department of CSE & IT Quad',
      description: 'Central open-air atrium near Lab 4 and the department bulletin board.',
      operatingHours: '8:00 AM - 7:00 PM',
      safetyTips: 'Active engineering student hub with campus Wi-Fi coverage.',
      isDefault: false,
    },
    {
      name: 'Campus Cafeteria Student Hub',
      building: 'Student Amenities & Dining Complex',
      description: 'Designated CampusLoop circular table near the cafeteria entrance.',
      operatingHours: '8:30 AM - 9:00 PM',
      safetyTips: 'Well-lit dining plaza with high student foot traffic.',
      isDefault: false,
    },
  ];

  for (const hub of hubs) {
    await prisma.pickupLocation.create({
      data: {
        collegeId: mitCsn.id,
        ...hub,
        status: 'ACTIVE',
      },
    });
  }
  console.log(`+ Created ${hubs.length} verified pickup safe hubs`);

  console.log('\n========================================');
  console.log('  DATABASE RESET & PURGE COMPLETE');
  console.log('========================================');
  console.log('Clean Status Summary:');
  console.log('- Demo Students: 0 (completely removed)');
  console.log('- Demo Items/Listings: 0 (completely removed)');
  console.log('- Demo Transactions: 0 (completely removed)');
  console.log('- Demo Conversations/Messages: 0 (completely removed)');
  console.log('- Demo Ratings/Reports: 0 (completely removed)');
  console.log('- Active Super Admin: superadmin@campusloop.in (Password: SuperAdmin123!)');
  console.log('- Active College Admin: admin@mit.asia (Password: CollegeAdmin123!)');
  console.log('========================================\n');

  await prisma.$disconnect();
}

resetDatabase().catch((err) => {
  console.error('Reset database failed:', err);
  process.exit(1);
});
