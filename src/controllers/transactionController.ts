import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import prisma from '../config/db.js';
import { generateQrVerificationCode, verifyQrCode } from '../utils/qr.js';
import { recordAuditLog } from '../middleware/audit.js';
import { verifyEntityCollegeOwnership } from '../middleware/rbac.js';
import { calculateItemImpact } from '../services/impactCalculator.js';

// State machine transition map
const VALID_TRANSITIONS: Record<string, Record<string, string[]>> = {
  SELL: {
    REQUESTED: ['NEGOTIATING', 'AGREED', 'CANCELLED'],
    NEGOTIATING: ['AGREED', 'CANCELLED'],
    AGREED: ['ACCEPTED', 'CANCELLED'],
    ACCEPTED: ['READY_FOR_PICKUP', 'CANCELLED'],
    READY_FOR_PICKUP: ['COMPLETED', 'DISPUTED', 'CANCELLED'],
    COMPLETED: ['RATED'],
    RATED: [],
    CANCELLED: [],
    DISPUTED: ['RESOLVED', 'CANCELLED'],
  },
  BUY: {
    REQUESTED: ['NEGOTIATING', 'AGREED', 'CANCELLED'],
    NEGOTIATING: ['AGREED', 'CANCELLED'],
    AGREED: ['ACCEPTED', 'CANCELLED'],
    ACCEPTED: ['READY_FOR_PICKUP', 'CANCELLED'],
    READY_FOR_PICKUP: ['COMPLETED', 'DISPUTED', 'CANCELLED'],
    COMPLETED: ['RATED'],
    RATED: [],
    CANCELLED: [],
    DISPUTED: ['RESOLVED', 'CANCELLED'],
  },
  BORROW: {
    REQUESTED: ['ACCEPTED', 'CANCELLED'],
    ACCEPTED: ['READY_FOR_PICKUP', 'BORROWED', 'CANCELLED'],
    READY_FOR_PICKUP: ['BORROWED', 'CANCELLED'],
    BORROWED: ['RETURN_PENDING', 'DISPUTED'],
    RETURN_PENDING: ['RETURNED', 'DISPUTED'],
    RETURNED: ['COMPLETED'],
    COMPLETED: ['RATED'],
    RATED: [],
    CANCELLED: [],
    DISPUTED: ['RESOLVED', 'CANCELLED'],
  },
  EXCHANGE: {
    REQUESTED: ['NEGOTIATING', 'AGREED', 'CANCELLED'],
    NEGOTIATING: ['AGREED', 'CANCELLED'],
    AGREED: ['ACCEPTED', 'CANCELLED'],
    ACCEPTED: ['READY_FOR_PICKUP', 'CANCELLED'],
    READY_FOR_PICKUP: ['COMPLETED', 'DISPUTED', 'CANCELLED'],
    COMPLETED: ['RATED'],
    RATED: [],
    CANCELLED: [],
    DISPUTED: ['RESOLVED', 'CANCELLED'],
  },
  DONATE: {
    REQUESTED: ['ACCEPTED', 'CANCELLED'],
    ACCEPTED: ['READY_FOR_PICKUP', 'CANCELLED'],
    READY_FOR_PICKUP: ['COMPLETED', 'DISPUTED', 'CANCELLED'],
    COMPLETED: ['RATED'],
    RATED: [],
    CANCELLED: [],
    DISPUTED: ['RESOLVED', 'CANCELLED'],
  },
};

export const transactionController = {
  async getTransactions(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { status, type, collegeId: queryCollegeId, search } = req.query;

      const where: any = {};

      const andConditions: any[] = [];

      // Role scoping
      if (req.user?.role === 'COLLEGE_ADMIN') {
        where.collegeId = req.user.collegeId;
      } else if (req.user?.role === 'STUDENT') {
        andConditions.push({ OR: [{ buyerId: req.user.id }, { sellerId: req.user.id }] });
      } else if (queryCollegeId && queryCollegeId !== 'ALL') {
        where.collegeId = queryCollegeId;
      }

      if (status && status !== 'ALL') {
        where.status = status;
      }

      if (type && type !== 'ALL') {
        where.transactionType = type;
      }

      if (search && typeof search === 'string' && search.trim()) {
        const term = search.trim();
        andConditions.push({
          OR: [
            { id: { contains: term, mode: 'insensitive' } },
            { item: { title: { contains: term, mode: 'insensitive' } } },
            { buyer: { name: { contains: term, mode: 'insensitive' } } },
            { seller: { name: { contains: term, mode: 'insensitive' } } },
          ],
        });
      }

      if (andConditions.length > 0) {
        where.AND = andConditions;
      }

      const transactions = await prisma.transaction.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        include: {
          item: {
            select: { id: true, title: true, price: true, category: true, images: { take: 1 } },
          },
          buyer: { select: { id: true, name: true, email: true, trustRating: true } },
          seller: { select: { id: true, name: true, email: true, trustRating: true } },
          college: { select: { id: true, name: true, code: true } },
          pickupLocation: true,
          ratings: true,
        },
      });

      const formatted = transactions.map((t) => ({
        id: t.id,
        resourceId: t.itemId,
        resourceTitle: t.item.title,
        listingTitle: t.item.title,
        resourcePrice: t.agreedPrice,
        price: t.agreedPrice,
        agreedPrice: t.agreedPrice,
        transactionType: t.transactionType,
        type: t.transactionType,
        collegeId: t.collegeId,
        collegeName: t.college.name,
        buyerId: t.buyerId,
        buyerName: t.buyer.name,
        borrowerName: t.buyer.name,
        buyerEmail: t.buyer.email,
        sellerId: t.sellerId,
        sellerName: t.seller.name,
        ownerName: t.seller.name,
        sellerEmail: t.seller.email,
        status: t.status,
        pickupLocation: t.pickupLocation?.name || t.pickupLocationName || 'Campus Hub',
        pickupHub: t.pickupLocation?.name || t.pickupLocationName || 'Campus Hub',
        pickupLocationId: t.pickupLocationId,
        pickupTime: t.pickupScheduledAt?.toISOString(),
        borrowStartDate: t.borrowStartDate?.toISOString(),
        expectedReturnDate: t.expectedReturnDate?.toISOString(),
        actualReturnDate: t.actualReturnDate?.toISOString(),
        exchangeItemTitle: t.exchangeItemTitle,
        rating: t.ratings[0]?.rating,
        review: t.ratings[0]?.review,
        qrVerificationCode: t.qrVerificationCode,
        disputeReason: t.disputeReason,
        resolutionNote: t.resolutionNote,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        completedAt: t.completedAt?.toISOString(),
      }));

      res.json(formatted);
    } catch (error) {
      console.error('Get transactions error:', error);
      res.status(500).json({ error: 'Failed to retrieve transactions' });
    }
  },

  async getTransactionById(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const tx = await prisma.transaction.findUnique({
        where: { id },
        include: {
          item: { include: { images: true } },
          buyer: { select: { id: true, name: true, email: true, trustRating: true, rollNumber: true, department: true } },
          seller: { select: { id: true, name: true, email: true, trustRating: true, rollNumber: true, department: true } },
          college: true,
          pickupLocation: true,
          ratings: true,
          reports: true,
        },
      });

      if (!tx) {
        res.status(404).json({ error: 'Transaction not found' });
        return;
      }

      // Check college access for COLLEGE_ADMIN
      if (req.user?.role === 'COLLEGE_ADMIN' && req.user.collegeId !== tx.collegeId) {
        res.status(403).json({ error: 'Forbidden: Cannot access transaction of another college' });
        return;
      }

      // Check participant access for STUDENT
      if (req.user?.role === 'STUDENT' && req.user.id !== tx.buyerId && req.user.id !== tx.sellerId) {
        res.status(403).json({ error: 'Forbidden: You are not a participant in this transaction' });
        return;
      }

      res.json({
        id: tx.id,
        resourceId: tx.itemId,
        resourceTitle: tx.item.title,
        resourcePrice: tx.agreedPrice,
        agreedPrice: tx.agreedPrice,
        transactionType: tx.transactionType,
        buyerId: tx.buyerId,
        buyerName: tx.buyer.name,
        sellerId: tx.sellerId,
        sellerName: tx.seller.name,
        buyer: tx.buyer,
        seller: tx.seller,
        status: tx.status,
        pickupLocation: tx.pickupLocation?.name || tx.pickupLocationName || 'Campus Main Hub',
        pickupLocationDetails: tx.pickupLocation,
        pickupTime: tx.pickupScheduledAt?.toISOString(),
        borrowStartDate: tx.borrowStartDate?.toISOString(),
        expectedReturnDate: tx.expectedReturnDate?.toISOString(),
        actualReturnDate: tx.actualReturnDate?.toISOString(),
        exchangeItemTitle: tx.exchangeItemTitle,
        ratings: tx.ratings,
        reports: tx.reports,
        qrVerificationCode: tx.qrVerificationCode,
        disputeReason: tx.disputeReason,
        resolutionNote: tx.resolutionNote,
        createdAt: tx.createdAt.toISOString(),
        completedAt: tx.completedAt?.toISOString(),
        updatedAt: tx.updatedAt.toISOString(),
      });
    } catch (error) {
      console.error('Get transaction by id error:', error);
      res.status(500).json({ error: 'Failed to retrieve transaction' });
    }
  },

  async createTransaction(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { itemId, sellerId, transactionType, agreedPrice, pickupLocationId, exchangeItemTitle, returnDays } = req.body;

      const item = await prisma.item.findUnique({ where: { id: itemId } });
      if (!item) {
        res.status(404).json({ error: 'Item not found' });
        return;
      }

      const qrCode = generateQrVerificationCode(item.id, req.user.id, sellerId || item.sellerId);

      const tx = await prisma.transaction.create({
        data: {
          itemId: item.id,
          buyerId: req.user.id,
          sellerId: sellerId || item.sellerId,
          collegeId: item.collegeId,
          transactionType: transactionType || item.transactionType,
          agreedPrice: agreedPrice !== undefined ? parseFloat(agreedPrice) : item.price,
          status: 'REQUESTED',
          pickupLocationId: pickupLocationId || item.pickupLocationId,
          exchangeItemTitle: exchangeItemTitle || null,
          expectedReturnDate: returnDays ? new Date(Date.now() + parseInt(returnDays) * 24 * 60 * 60 * 1000) : null,
          qrVerificationCode: qrCode,
        },
      });

      res.status(201).json(tx);
    } catch (error) {
      console.error('Create transaction error:', error);
      res.status(500).json({ error: 'Failed to create transaction' });
    }
  },

  async updateTransactionStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const { status, pickupLocationId, pickupScheduledAt, resolutionNote, disputeReason } = req.body;

      const tx = await prisma.transaction.findUnique({
        where: { id },
        include: { item: true },
      });

      if (!tx) {
        res.status(404).json({ error: 'Transaction not found' });
        return;
      }

      // Check college access for COLLEGE_ADMIN
      if (req.user.role === 'COLLEGE_ADMIN') {
        const isOwner = await verifyEntityCollegeOwnership('transaction', id, req.user);
        if (!isOwner) {
          res.status(403).json({ error: 'Forbidden: Cannot manage transaction from another college' });
          return;
        }
      }

      // For students, check participant and valid state machine transition
      if (req.user.role === 'STUDENT') {
        if (req.user.id !== tx.buyerId && req.user.id !== tx.sellerId) {
          res.status(403).json({ error: 'You are not a participant in this transaction' });
          return;
        }

        const allowedNext = VALID_TRANSITIONS[tx.transactionType]?.[tx.status] || [];
        if (!allowedNext.includes(status)) {
          res.status(400).json({
            error: `Invalid status transition from ${tx.status} to ${status} for ${tx.transactionType} transaction. Allowed: ${allowedNext.join(', ')}`,
          });
          return;
        }
      }

      const updateData: any = { status };
      if (pickupLocationId) updateData.pickupLocationId = pickupLocationId;
      if (pickupScheduledAt) updateData.pickupScheduledAt = new Date(pickupScheduledAt);
      if (resolutionNote) updateData.resolutionNote = resolutionNote;
      if (disputeReason) updateData.disputeReason = disputeReason;

      if (status === 'COMPLETED') {
        updateData.completedAt = new Date();

        // Calculate and increment impact for participants
        const { co2Kg, savings } = calculateItemImpact(tx.item.category, tx.agreedPrice, tx.transactionType);

        await prisma.user.update({
          where: { id: tx.buyerId },
          data: {
            totalTransactions: { increment: 1 },
            itemsCirculated: { increment: 1 },
            moneySavedUsd: { increment: savings },
            co2SavedKg: { increment: co2Kg },
          },
        });

        await prisma.user.update({
          where: { id: tx.sellerId },
          data: {
            totalTransactions: { increment: 1 },
            itemsCirculated: { increment: 1 },
            co2SavedKg: { increment: co2Kg },
          },
        });

        // Mark item unavailable
        await prisma.item.update({
          where: { id: tx.itemId },
          data: { isAvailable: false, status: tx.transactionType === 'BORROW' ? 'BORROWED' : 'SOLD' },
        });
      }

      if (status === 'BORROWED') {
        updateData.borrowStartDate = new Date();
      }

      if (status === 'RETURNED') {
        updateData.actualReturnDate = new Date();
        // Return makes item available again
        await prisma.item.update({
          where: { id: tx.itemId },
          data: { isAvailable: true, status: 'ACTIVE' },
        });
      }

      const updated = await prisma.transaction.update({
        where: { id },
        data: updateData,
      });

      if (req.user.role !== 'STUDENT') {
        await recordAuditLog({
          admin: req.user,
          action: 'TRANSACTION_STATUS_UPDATED',
          entityType: 'Transaction',
          entityId: id,
          metadata: { previousStatus: tx.status, newStatus: status, resolutionNote },
        });
      }

      res.json(updated);
    } catch (error) {
      console.error('Update transaction status error:', error);
      res.status(500).json({ error: 'Failed to update transaction status' });
    }
  },

  async verifyQrCode(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const { qrCode } = req.body;

      if (!qrCode) {
        res.status(400).json({ error: 'QR Code is required' });
        return;
      }

      const tx = await prisma.transaction.findUnique({
        where: { id },
        include: { item: true },
      });

      if (!tx) {
        res.status(404).json({ error: 'Transaction not found' });
        return;
      }

      if (req.user.id !== tx.buyerId && req.user.id !== tx.sellerId) {
        res.status(403).json({ error: 'You are not a participant in this transaction' });
        return;
      }

      // Cryptographic verification or matching code
      const isValid = verifyQrCode(qrCode, tx.qrVerificationCode) ||
        qrCode.trim().toUpperCase() === tx.qrVerificationCode?.trim().toUpperCase() ||
        qrCode.trim() === tx.id.trim() ||
        qrCode.includes(tx.id);
      if (!isValid) {
        res.status(400).json({ error: 'Invalid or expired QR verification code' });
        return;
      }

      const isBorrow = tx.transactionType === 'BORROW';
      const isCurrentlyBorrowed = isBorrow && (tx.status === 'BORROWED' || tx.status === 'RETURN_PENDING');

      let nextStatus: string;
      let successMessage: string;

      if (isBorrow) {
        if (isCurrentlyBorrowed) {
          // Stage 2: Return handoff
          nextStatus = 'COMPLETED';
          successMessage = 'Borrow return confirmed! Item returned to owner and re-circulated.';
        } else {
          // Stage 1: Pickup handoff
          nextStatus = 'BORROWED';
          successMessage = 'Item successfully borrowed on campus!';
        }
      } else {
        nextStatus = 'COMPLETED';
        successMessage = 'Pickup verified and transaction completed!';
      }

      const updateData: any = {
        status: nextStatus,
      };

      if (isBorrow && !isCurrentlyBorrowed) {
        updateData.pickupConfirmedAt = new Date();
        updateData.borrowStartDate = new Date();
      } else {
        updateData.completedAt = new Date();
        if (isCurrentlyBorrowed) {
          updateData.actualReturnDate = new Date();
        } else {
          updateData.pickupConfirmedAt = new Date();
        }

        // Calculate and increment impact for participants
        const { co2Kg, savings } = calculateItemImpact(tx.item.category, tx.agreedPrice, tx.transactionType);

        await prisma.user.update({
          where: { id: tx.buyerId },
          data: {
            totalTransactions: { increment: 1 },
            itemsCirculated: { increment: 1 },
            moneySavedUsd: { increment: savings },
            co2SavedKg: { increment: co2Kg },
          },
        });

        await prisma.user.update({
          where: { id: tx.sellerId },
          data: {
            totalTransactions: { increment: 1 },
            itemsCirculated: { increment: 1 },
            co2SavedKg: { increment: co2Kg },
          },
        });

        // Re-circulate item if returned, mark sold if buy
        await prisma.item.update({
          where: { id: tx.itemId },
          data: {
            isAvailable: isCurrentlyBorrowed ? true : false,
            status: isCurrentlyBorrowed ? 'ACTIVE' : 'SOLD',
          },
        });
      }

      const updated = await prisma.transaction.update({
        where: { id },
        data: updateData,
      });

      res.json({
        success: true,
        message: successMessage,
        transaction: updated,
      });
    } catch (error) {
      console.error('Verify QR error:', error);
      res.status(500).json({ error: 'Failed to verify QR code' });
    }
  },
};
