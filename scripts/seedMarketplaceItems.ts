import { PrismaClient, TransactionType } from '@prisma/client';
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

async function seedItems() {
  console.log('\n========================================');
  console.log('  SEEDING CAMPUS MARKETPLACE ITEMS');
  console.log('========================================\n');

  // 1. Fetch the MIT CSN college
  const college = await prisma.college.findFirst({
    where: { code: 'MIT_CSN' },
  });

  if (!college) {
    throw new Error('College MIT CSN not found in database! Please run resetDatabase.ts first.');
  }
  console.log(`Found college: ${college.name} (${college.id})`);

  // 2. Fetch pickup locations
  const pickupLocations = await prisma.pickupLocation.findMany({
    where: { collegeId: college.id },
  });
  console.log(`Found ${pickupLocations.length} pickup locations`);

  const libraryHub = pickupLocations.find((p) => p.name.includes('Library')) || pickupLocations[0];
  const gateHub = pickupLocations.find((p) => p.name.includes('Main Gate')) || pickupLocations[0];
  const csHub = pickupLocations.find((p) => p.name.includes('Computer Science')) || pickupLocations[0];
  const cafeHub = pickupLocations.find((p) => p.name.includes('Cafeteria')) || pickupLocations[0];

  // 3. Create or find verified students
  const salt = await bcrypt.genSalt(10);
  const studentPasswordHash = await bcrypt.hash('Student123!', salt);
  const defaultStudentPasswordHash = await bcrypt.hash('Password123!', salt);

  const studentData = [
    {
      name: 'Campus Student',
      email: 'student@mit.asia',
      passwordHash: defaultStudentPasswordHash,
      department: 'Computer Science & Engineering',
      rollNumber: 'CS2023001',
      academicYear: 'Senior',
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80',
      trustRating: 5.0,
      totalTransactions: 6,
      co2SavedKg: 14.5,
      moneySavedUsd: 85.0,
      itemsCirculated: 5,
    },
    {
      name: 'Rahul Sharma',
      email: 'rahul.sharma@mit.asia',
      passwordHash: studentPasswordHash,
      department: 'Computer Science & Engineering',
      rollNumber: 'CS2023021',
      academicYear: 'Junior',
      avatarUrl: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&w=400&q=80',
      trustRating: 4.9,
      totalTransactions: 12,
      co2SavedKg: 28.0,
      moneySavedUsd: 160.0,
      itemsCirculated: 10,
    },
    {
      name: 'Priya Patel',
      email: 'priya.patel@mit.asia',
      passwordHash: studentPasswordHash,
      department: 'Mechanical Engineering',
      rollNumber: 'ME2022015',
      academicYear: 'Senior',
      avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=400&q=80',
      trustRating: 5.0,
      totalTransactions: 18,
      co2SavedKg: 42.0,
      moneySavedUsd: 240.0,
      itemsCirculated: 15,
    },
    {
      name: 'Amit Deshmukh',
      email: 'amit.deshmukh@mit.asia',
      passwordHash: studentPasswordHash,
      department: 'Electronics & Telecommunication',
      rollNumber: 'ET2024033',
      academicYear: 'Sophomore',
      avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80',
      trustRating: 4.8,
      totalTransactions: 8,
      co2SavedKg: 19.5,
      moneySavedUsd: 110.0,
      itemsCirculated: 7,
    },
    {
      name: 'Neha Kulkarni',
      email: 'neha.kulkarni@mit.asia',
      passwordHash: studentPasswordHash,
      department: 'Civil & Environmental Engineering',
      rollNumber: 'CE2023008',
      academicYear: 'Junior',
      avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80',
      trustRating: 4.9,
      totalTransactions: 14,
      co2SavedKg: 33.0,
      moneySavedUsd: 190.0,
      itemsCirculated: 11,
    },
  ];

  const students: Record<string, any> = {};
  for (const s of studentData) {
    let student = await prisma.user.findUnique({ where: { email: s.email } });
    if (!student) {
      student = await prisma.user.create({
        data: {
          name: s.name,
          email: s.email,
          passwordHash: s.passwordHash,
          role: 'STUDENT',
          collegeId: college.id,
          department: s.department,
          rollNumber: s.rollNumber,
          academicYear: s.academicYear,
          avatarUrl: s.avatarUrl,
          verificationStatus: 'VERIFIED',
          verifiedAt: new Date(),
          trustRating: s.trustRating,
          totalTransactions: s.totalTransactions,
          co2SavedKg: s.co2SavedKg,
          moneySavedUsd: s.moneySavedUsd,
          itemsCirculated: s.itemsCirculated,
          status: 'ACTIVE',
        },
      });
      console.log(`+ Created verified student: ${student.name} (${student.email})`);
    } else {
      console.log(`* Found existing student: ${student.name} (${student.email})`);
    }
    students[s.email] = student;
  }

  // 4. Define items
  const itemsToCreate = [
    {
      title: 'Engineering Mechanics: Statics & Dynamics (14th Ed) - R.C. Hibbeler',
      description: 'Standard textbook for First-Year and Mechanical Engineering core mechanics. Clean pages with minimal pencil notes, crisp binding, and includes formula quick-reference card.',
      category: 'Books',
      condition: 'Good',
      price: 380.0,
      transactionType: TransactionType.SELL,
      courseCode: 'ME 101',
      pickupLocationId: libraryHub?.id,
      pickupLocationName: libraryHub?.name,
      sellerId: students['priya.patel@mit.asia'].id,
      isRecommended: true,
      isNearby: true,
      images: [
        'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=800&q=80',
        'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=800&q=80',
      ],
    },
    {
      title: 'Casio fx-991EX ClassWiz Advanced Scientific Calculator',
      description: 'High-resolution ClassWiz natural display scientific calculator with 552 mathematical functions, matrix/vector calculations, and equation solver. Perfect for mid-semester and end-term exams.',
      category: 'Calculators',
      condition: 'Like New',
      price: 0.0,
      transactionType: TransactionType.BORROW,
      maxBorrowDays: 14,
      courseCode: 'MATH 51',
      pickupLocationId: gateHub?.id,
      pickupLocationName: gateHub?.name,
      sellerId: students['rahul.sharma@mit.asia'].id,
      isRecommended: true,
      isNearby: true,
      images: [
        'https://images.unsplash.com/photo-1594980596870-8aa52a78d8cd?auto=format&fit=crop&w=800&q=80',
      ],
    },
    {
      title: 'Omega Engineering Mini Drafter & Waterproof Sheet Container',
      description: 'Complete engineering drawing kit including steel mini drafter with rigid clamp, set square combo (30°-60° & 45°), protractor, and adjustable waterproof plastic sheet container tube.',
      category: 'Drawing Kits',
      condition: 'Good',
      price: 240.0,
      transactionType: TransactionType.SELL,
      courseCode: 'ARCH 101',
      pickupLocationId: gateHub?.id,
      pickupLocationName: gateHub?.name,
      sellerId: students['neha.kulkarni@mit.asia'].id,
      isRecommended: false,
      isNearby: true,
      images: [
        'https://images.unsplash.com/photo-1581291518857-4e27b48ff24e?auto=format&fit=crop&w=800&q=80',
      ],
    },
    {
      title: 'Arduino Uno R3 Ultimate Sensor & Prototyping Starter Kit',
      description: 'Complete IoT learning kit with ATmega328P microcontroller board, 830-tie-point solderless breadboard, ultrasonic sensor, DHT11 humidity/temperature sensor, 1602 I2C LCD, and 65 jumper wires.',
      category: 'Electronics',
      condition: 'Like New',
      price: 0.0,
      transactionType: TransactionType.EXCHANGE,
      exchangePreferences: 'Looking to exchange for STM32 Nucleo board or Raspberry Pi Zero',
      courseCode: 'EE 108',
      pickupLocationId: csHub?.id,
      pickupLocationName: csHub?.name,
      sellerId: students['amit.deshmukh@mit.asia'].id,
      isRecommended: true,
      isNearby: true,
      images: [
        'https://images.unsplash.com/photo-1553406830-ef2513450d76?auto=format&fit=crop&w=800&q=80',
      ],
    },
    {
      title: 'Introduction to Algorithms (CLRS 3rd Edition) - Cormen, Leiserson, Rivest',
      description: 'The definitive reference on computer algorithms and data structures. Comprehensive coverage of sorting, dynamic programming, graph algorithms, and NP-completeness. Hardcover copy in pristine condition.',
      category: 'Books',
      condition: 'Like New',
      price: 490.0,
      transactionType: TransactionType.SELL,
      courseCode: 'CS 106B',
      pickupLocationId: csHub?.id,
      pickupLocationName: csHub?.name,
      sellerId: students['rahul.sharma@mit.asia'].id,
      isRecommended: true,
      isNearby: true,
      images: [
        'https://images.unsplash.com/photo-1532012164546-f432f2e3777a?auto=format&fit=crop&w=800&q=80',
      ],
    },
    {
      title: '3D Organic Chemistry Molecular Model Student Kit (240 Pieces)',
      description: 'Ball-and-stick and space-filling molecular modeling kit. Ideal for visualizing stereochemistry, chair/boat cyclohexane conformations, enantiomers, and functional groups for Chemistry lab work.',
      category: 'Lab Components',
      condition: 'Like New',
      price: 0.0,
      transactionType: TransactionType.BORROW,
      maxBorrowDays: 21,
      courseCode: 'CHEM 31A',
      pickupLocationId: libraryHub?.id,
      pickupLocationName: libraryHub?.name,
      sellerId: students['neha.kulkarni@mit.asia'].id,
      isRecommended: false,
      isNearby: true,
      images: [
        'https://images.unsplash.com/photo-1532187863486-abf9dbad1b69?auto=format&fit=crop&w=800&q=80',
      ],
    },
    {
      title: 'Digital Multimeter with Auto-Ranging & Continuity Buzzer',
      description: 'Donating my spare digital multimeter to any junior student taking Electrical Engineering or Basic Electronics. Measures AC/DC volts, ohms, diode check, and continuity with audible beep. Works 100% with fresh 9V battery.',
      category: 'Tools',
      condition: 'Good',
      price: 0.0,
      transactionType: TransactionType.DONATE,
      courseCode: 'EE 108',
      pickupLocationId: cafeHub?.id,
      pickupLocationName: cafeHub?.name,
      sellerId: students['amit.deshmukh@mit.asia'].id,
      isRecommended: true,
      isNearby: true,
      images: [
        'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=800&q=80',
      ],
    },
    {
      title: 'Steel Vernier Caliper (0-150mm) & Screw Gauge Combo',
      description: 'High precision 0.02mm stainless steel vernier caliper with thumb lock in padded shockproof case, accompanied by a 0-25mm micrometer screw gauge for Physics and Workshop lab experiments.',
      category: 'Project Materials',
      condition: 'Good',
      price: 190.0,
      transactionType: TransactionType.SELL,
      courseCode: 'PHYS 41',
      pickupLocationId: gateHub?.id,
      pickupLocationName: gateHub?.name,
      sellerId: students['priya.patel@mit.asia'].id,
      isRecommended: false,
      isNearby: true,
      images: [
        'https://images.unsplash.com/photo-1581092335397-9583fe92d232?auto=format&fit=crop&w=800&q=80',
      ],
    },
    {
      title: 'Modern Control Engineering (5th Edition) - Katsuhiko Ogata',
      description: 'Comprehensive textbook covering continuous-time control systems, transient response, root-locus techniques, frequency response, and state-space analysis. Crisp binding with helpful study tags.',
      category: 'Books',
      condition: 'Good',
      price: 320.0,
      transactionType: TransactionType.SELL,
      courseCode: 'EE 108',
      pickupLocationId: libraryHub?.id,
      pickupLocationName: libraryHub?.name,
      sellerId: students['student@mit.asia'].id,
      isRecommended: true,
      isNearby: true,
      images: [
        'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=800&q=80',
      ],
    },
  ];

  console.log('\nCreating items with images...');
  for (const item of itemsToCreate) {
    const { images, ...itemData } = item;
    const createdItem = await prisma.item.create({
      data: {
        ...itemData,
        collegeId: college.id,
        status: 'ACTIVE',
        isAvailable: true,
        images: {
          create: images.map((url, idx) => ({
            url,
            order: idx,
          })),
        },
      },
      include: {
        images: true,
        seller: { select: { name: true, email: true } },
        pickupLocation: { select: { name: true } },
      },
    });

    console.log(`+ Added [${createdItem.transactionType}] ${createdItem.title} (₹${createdItem.price}) by ${createdItem.seller.name}`);
  }

  // Update studentCount and listingCount on College
  const totalStudents = await prisma.user.count({
    where: { collegeId: college.id, role: 'STUDENT' },
  });
  const totalListings = await prisma.item.count({
    where: { collegeId: college.id, status: 'ACTIVE' },
  });

  await prisma.college.update({
    where: { id: college.id },
    data: {
      studentCount: totalStudents,
      listingCount: totalListings,
    },
  });

  console.log(`\nUpdated College counts: ${totalStudents} students, ${totalListings} active listings.`);
  console.log('\n========================================');
  console.log('  ITEM SEEDING SUCCESSFULLY COMPLETED');
  console.log('========================================\n');

  await prisma.$disconnect();
}

seedItems().catch(async (e) => {
  console.error('Error seeding items:', e);
  await prisma.$disconnect();
  process.exit(1);
});
