import prisma from '../src/config/db.js';

async function main() {
  console.log('Finding and removing duplicate items...');

  const items = await prisma.item.findMany({
    orderBy: { createdAt: 'asc' }, // oldest first
    include: {
      images: true,
      offers: true,
      requests: true,
      transactions: true,
      conversations: true,
    },
  });

  const seen = new Map<string, typeof items[0]>();
  const toDeleteIds: string[] = [];

  for (const item of items) {
    const key = `${item.sellerId}_${item.title.toLowerCase().trim()}_${item.price}`;
    if (!seen.has(key)) {
      seen.set(key, item);
    } else {
      // This is a duplicate!
      console.log(`Duplicate found: [${item.id}] "${item.title}" (Original: [${seen.get(key)!.id}])`);
      toDeleteIds.push(item.id);
    }
  }

  console.log(`Found ${toDeleteIds.length} duplicate items to remove.`);

  for (const id of toDeleteIds) {
    // Check if any relations exist
    const item = items.find((i) => i.id === id)!;
    console.log(`Checking relations for ${id}: offers=${item.offers.length}, requests=${item.requests.length}, tx=${item.transactions.length}, convs=${item.conversations.length}`);

    // Re-link conversations/offers if needed, or delete duplicate
    if (item.conversations.length > 0) {
      // Point conversations to original
      const original = seen.get(`${item.sellerId}_${item.title.toLowerCase().trim()}_${item.price}`)!;
      await prisma.conversation.updateMany({
        where: { itemId: id },
        data: { itemId: original.id },
      });
    }

    if (item.offers.length > 0) {
      const original = seen.get(`${item.sellerId}_${item.title.toLowerCase().trim()}_${item.price}`)!;
      await prisma.offer.updateMany({
        where: { itemId: id },
        data: { itemId: original.id },
      });
    }

    // Delete item images
    await prisma.itemImage.deleteMany({ where: { itemId: id } });

    // Delete the duplicate item
    await prisma.item.delete({ where: { id } });
    console.log(`Deleted duplicate item ${id}`);
  }

  console.log('Cleanup completed successfully!');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
