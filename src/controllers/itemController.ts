import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import prisma from '../config/db.js';
import { recordAuditLog } from '../middleware/audit.js';
import { verifyEntityCollegeOwnership } from '../middleware/rbac.js';

export const itemController = {
  async getItems(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const {
        search,
        category,
        transactionType,
        condition,
        collegeId: queryCollegeId,
        minPrice,
        maxPrice,
        status,
        isDigital,
      } = req.query;

      const where: any = {};

      // For public/student users, show ACTIVE by default
      if (status && status !== 'ALL') {
        where.status = status;
      } else if (!req.user || req.user.role === 'STUDENT') {
        where.status = 'ACTIVE';
      }

      // College scoping:
      if (req.user?.role === 'COLLEGE_ADMIN') {
        where.collegeId = req.user.collegeId;
      } else if (queryCollegeId && queryCollegeId !== 'ALL') {
        where.collegeId = queryCollegeId;
      }

      if (category && category !== 'ALL') {
        where.category = { equals: category, mode: 'insensitive' };
      }

      if (transactionType && transactionType !== 'ALL') {
        where.transactionType = transactionType;
      }

      if (condition && condition !== 'ALL') {
        where.condition = { equals: condition, mode: 'insensitive' };
      }

      if (isDigital !== undefined) {
        where.isDigital = isDigital === 'true';
      }

      if (minPrice || maxPrice) {
        where.price = {};
        if (minPrice) where.price.gte = parseFloat(minPrice as string);
        if (maxPrice) where.price.lte = parseFloat(maxPrice as string);
      }

      if (search && typeof search === 'string') {
        where.OR = [
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { category: { contains: search, mode: 'insensitive' } },
          { courseCode: { contains: search, mode: 'insensitive' } },
        ];
      }

      const items = await prisma.item.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          seller: {
            select: {
              id: true,
              name: true,
              email: true,
              trustRating: true,
              verificationStatus: true,
              totalTransactions: true,
            },
          },
          college: { select: { id: true, name: true, code: true } },
          images: { orderBy: { order: 'asc' } },
          pickupLocation: true,
          _count: { select: { offers: true, requests: true, reports: true } },
        },
      });

      const formatted = items.map((i) => ({
        id: i.id,
        title: i.title,
        description: i.description,
        category: i.category,
        condition: i.condition,
        price: i.price,
        type: i.transactionType,
        transactionType: i.transactionType,
        resourceType: i.transactionType,
        sellerId: i.sellerId,
        ownerId: i.sellerId,
        studentId: i.sellerId,
        ownerName: i.seller.name,
        sellerName: i.seller.name,
        studentName: i.seller.name,
        ownerEmail: i.seller.email,
        studentEmail: i.seller.email,
        sellerRating: i.seller.trustRating,
        isVerifiedSeller: i.seller.verificationStatus === 'VERIFIED',
        collegeId: i.collegeId,
        collegeName: i.college.name,
        collegeCode: i.college.code,
        university: i.college.name,
        status: i.status,
        isAvailable: i.isAvailable,
        isRecommended: i.isRecommended,
        isNearby: i.isNearby,
        isDigital: i.isDigital,
        digitalProvider: i.digitalProvider,
        exchangePreferences: i.exchangePreferences,
        exchangeForRequirement: i.exchangePreferences,
        maxBorrowDays: i.maxBorrowDays,
        courseCode: i.courseCode,
        depositAmount: 0,
        viewCount: 15,
        timesShared: i.seller.totalTransactions || 0,
        pickupLocation: i.pickupLocation?.name || i.pickupLocationName || 'Campus Main Hub',
        pickupLocationId: i.pickupLocationId,
        imageUrls: i.images.length > 0 ? i.images.map((img) => img.url) : ['https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c'],
        images: i.images.map((img) => img.url),
        reportCount: i._count.reports,
        offerCount: i._count.offers,
        createdAt: i.createdAt.toISOString(),
        updatedAt: i.updatedAt ? i.updatedAt.toISOString() : i.createdAt.toISOString(),
      }));

      res.json(formatted);
    } catch (error) {
      console.error('Get items error:', error);
      res.status(500).json({ error: 'Failed to retrieve marketplace items' });
    }
  },

  async getItemById(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const item = await prisma.item.findUnique({
        where: { id },
        include: {
          seller: {
            select: {
              id: true,
              name: true,
              email: true,
              trustRating: true,
              verificationStatus: true,
              totalTransactions: true,
            },
          },
          college: true,
          images: { orderBy: { order: 'asc' } },
          pickupLocation: true,
        },
      });

      if (!item) {
        res.status(404).json({ error: 'Item not found' });
        return;
      }

      // Check college access for COLLEGE_ADMIN
      if (req.user?.role === 'COLLEGE_ADMIN' && req.user.collegeId !== item.collegeId) {
        res.status(403).json({ error: 'Forbidden: Access to items from other colleges is denied' });
        return;
      }

      res.json({
        id: item.id,
        title: item.title,
        description: item.description,
        category: item.category,
        condition: item.condition,
        price: item.price,
        type: item.transactionType,
        transactionType: item.transactionType,
        resourceType: item.transactionType,
        sellerId: item.sellerId,
        ownerId: item.sellerId,
        studentId: item.sellerId,
        ownerName: item.seller.name,
        sellerName: item.seller.name,
        studentName: item.seller.name,
        ownerEmail: item.seller.email,
        studentEmail: item.seller.email,
        sellerRating: item.seller.trustRating,
        isVerifiedSeller: item.seller.verificationStatus === 'VERIFIED',
        collegeId: item.collegeId,
        collegeName: item.college.name,
        status: item.status,
        isAvailable: item.isAvailable,
        isDigital: item.isDigital,
        digitalProvider: item.digitalProvider,
        exchangePreferences: item.exchangePreferences,
        maxBorrowDays: item.maxBorrowDays,
        courseCode: item.courseCode,
        depositAmount: 0,
        viewCount: 15,
        timesShared: item.seller.totalTransactions || 0,
        pickupLocation: item.pickupLocation?.name || item.pickupLocationName || 'Campus Main Hub',
        pickupLocationId: item.pickupLocationId,
        imageUrls: item.images.length > 0 ? item.images.map((img) => img.url) : ['https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c'],
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt ? item.updatedAt.toISOString() : item.createdAt.toISOString(),
      });
    } catch (error) {
      console.error('Get item by id error:', error);
      res.status(500).json({ error: 'Failed to retrieve item' });
    }
  },

  async createItem(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const {
        title,
        description,
        category,
        condition,
        price,
        transactionType,
        exchangePreferences,
        maxBorrowDays,
        courseCode,
        isDigital,
        digitalProvider,
        pickupLocationId,
        pickupLocationName,
        images,
      } = req.body;

      if (!title || !category || !condition || !transactionType) {
        res.status(400).json({ error: 'Missing required listing fields' });
        return;
      }

      // Determine college from user
      const user = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (!user || !user.collegeId) {
        res.status(400).json({ error: 'You must belong to a registered college to create listings' });
        return;
      }

      const item = await prisma.item.create({
        data: {
          title,
          description: description || '',
          category,
          condition,
          price: parseFloat(price) || 0.0,
          transactionType,
          exchangePreferences: exchangePreferences || null,
          maxBorrowDays: maxBorrowDays ? parseInt(maxBorrowDays) : null,
          courseCode: courseCode ? courseCode.toUpperCase() : null,
          isDigital: Boolean(isDigital),
          digitalProvider: digitalProvider || null,
          collegeId: user.collegeId,
          sellerId: user.id,
          pickupLocationId: pickupLocationId || null,
          pickupLocationName: pickupLocationName || null,
          status: 'ACTIVE',
        },
      });

      // Add images
      if (Array.isArray(images) && images.length > 0) {
        for (let i = 0; i < images.length; i++) {
          await prisma.itemImage.create({
            data: {
              itemId: item.id,
              url: images[i],
              order: i,
            },
          });
        }
      }

      // Update college listing count
      await prisma.college.update({
        where: { id: user.collegeId },
        data: { listingCount: { increment: 1 } },
      });

      // Fetch fully populated item with images and seller info
      const completeItem = await prisma.item.findUnique({
        where: { id: item.id },
        include: {
          seller: {
            select: {
              id: true,
              name: true,
              email: true,
              trustRating: true,
              verificationStatus: true,
              totalTransactions: true,
            },
          },
          college: { select: { id: true, name: true, code: true } },
          images: { orderBy: { order: 'asc' } },
          pickupLocation: true,
        },
      });

      if (!completeItem) {
        res.status(201).json(item);
        return;
      }

      const imageUrls = completeItem.images.map((img) => img.url);

      res.status(201).json({
        id: completeItem.id,
        title: completeItem.title,
        description: completeItem.description,
        category: completeItem.category,
        condition: completeItem.condition,
        price: completeItem.price,
        type: completeItem.transactionType,
        transactionType: completeItem.transactionType,
        resourceType: completeItem.transactionType,
        sellerId: completeItem.sellerId,
        ownerId: completeItem.sellerId,
        studentId: completeItem.sellerId,
        sellerName: completeItem.seller.name,
        ownerName: completeItem.seller.name,
        studentName: completeItem.seller.name,
        sellerRating: completeItem.seller.trustRating,
        isVerifiedSeller: completeItem.seller.verificationStatus === 'VERIFIED',
        collegeId: completeItem.collegeId,
        collegeName: completeItem.college.name,
        university: completeItem.college.name,
        status: completeItem.status,
        isAvailable: completeItem.isAvailable,
        isRecommended: completeItem.isRecommended,
        isNearby: completeItem.isNearby,
        isDigital: completeItem.isDigital,
        digitalProvider: completeItem.digitalProvider,
        exchangePreferences: completeItem.exchangePreferences,
        maxBorrowDays: completeItem.maxBorrowDays,
        courseCode: completeItem.courseCode,
        depositAmount: 0,
        pickupLocation: completeItem.pickupLocation?.name || completeItem.pickupLocationName || 'Campus Main Hub',
        pickupLocationId: completeItem.pickupLocationId,
        imageUrls: imageUrls.length > 0 ? imageUrls : ['https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c'],
        images: imageUrls,
        createdAt: completeItem.createdAt.toISOString(),
        updatedAt: completeItem.updatedAt.toISOString(),
      });
    } catch (error) {
      console.error('Create item error:', error);
      res.status(500).json({ error: 'Failed to create listing' });
    }
  },

  async updateItem(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const item = await prisma.item.findUnique({ where: { id } });

      if (!item) {
        res.status(404).json({ error: 'Item not found' });
        return;
      }

      // Only seller or Admin can update
      if (item.sellerId !== req.user.id && req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'COLLEGE_ADMIN') {
        res.status(403).json({ error: 'Forbidden: You do not own this listing' });
        return;
      }

      const updated = await prisma.item.update({
        where: { id },
        data: req.body,
      });

      res.json(updated);
    } catch (error) {
      console.error('Update item error:', error);
      res.status(500).json({ error: 'Failed to update item' });
    }
  },

  async moderateItem(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { status } = req.body; // ACTIVE, HIDDEN, REMOVED, PENDING_MODERATION

      if (!req.user || (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'COLLEGE_ADMIN')) {
        res.status(403).json({ error: 'Admin privileges required' });
        return;
      }

      if (req.user.role === 'COLLEGE_ADMIN') {
        const isOwner = await verifyEntityCollegeOwnership('item', id, req.user);
        if (!isOwner) {
          res.status(403).json({ error: 'Forbidden: Cannot moderate listing from another college' });
          return;
        }
      }

      const updated = await prisma.item.update({
        where: { id },
        data: {
          status,
          isAvailable: status === 'ACTIVE',
        },
      });

      await recordAuditLog({
        admin: req.user,
        action: status === 'REMOVED' ? 'LISTING_REMOVED' : status === 'HIDDEN' ? 'LISTING_HIDDEN' : 'LISTING_RESTORED',
        entityType: 'Item',
        entityId: id,
        metadata: { newStatus: status, title: updated.title },
      });

      res.json(updated);
    } catch (error) {
      console.error('Moderate item error:', error);
      res.status(500).json({ error: 'Failed to moderate listing' });
    }
  },

  async deleteItem(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      // Soft deletion preferred
      await itemController.moderateItem(
        Object.assign(req, { body: { status: 'REMOVED' } }),
        res
      );
    } catch (error) {
      console.error('Delete item error:', error);
      res.status(500).json({ error: 'Failed to delete listing' });
    }
  },
};
