import prisma from '../src/config/db.js';

async function main() {
  const items = await prisma.item.findMany({
    select: {
      id: true,
      title: true,
      price: true,
      sellerId: true,
      seller: { select: { name: true, email: true } },
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  console.log(`TOTAL ITEMS IN DB: ${items.length}`);
  for (const i of items) {
    console.log(`- [${i.id}] "${i.title}" (₹${i.price}) by ${i.seller?.name} (${i.seller?.email}) created: ${i.createdAt.toISOString()}`);
  }

  // Check duplicates by title + sellerId
  const seen = new Map<string, string[]>();
  for (const i of items) {
    const key = `${i.title.toLowerCase().trim()}_${i.sellerId}`;
    if (!seen.has(key)) {
      seen.set(key, []);
    }
    seen.get(key)!.push(i.id);
  }

  console.log('\nDUPLICATE CHECK:');
  for (const [key, ids] of seen.entries()) {
    if (ids.length > 1) {
      console.log(`DUPLICATE FOUND: key="${key}" count=${ids.length} ids=${ids.join(', ')}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
