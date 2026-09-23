import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import prisma from '../config/db.js';
import { generateQrVerificationCode } from '../utils/qr.js';

export const offerController = {
  async createOffer(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { itemId, conversationId, offeredPrice, message } = req.body;

      if (!itemId || offeredPrice === undefined) {
        res.status(400).json({ error: 'Item ID and offered price are required' });
        return;
      }

      const item = await prisma.item.findUnique({ where: { id: itemId } });
      if (!item) {
        res.status(404).json({ error: 'Item not found' });
        return;
      }

      if (item.sellerId === req.user.id) {
        res.status(400).json({ error: 'Cannot make an offer on your own item' });
        return;
      }

      const offer = await prisma.offer.create({
        data: {
          itemId,
          conversationId: conversationId || null,
          buyerId: req.user.id,
          sellerId: item.sellerId,
          originalPrice: item.price,
          offeredPrice: parseFloat(offeredPrice),
          message: message || null,
          status: 'PENDING',
        },
      });

      // Post offer message into conversation if available
      if (conversationId) {
        await prisma.message.create({
          data: {
            conversationId,
            senderId: req.user.id,
            text: `Proposed an offer: ₹${offer.offeredPrice.toFixed(2)}${message ? ` - "${message}"` : ''}`,
            type: 'OFFER',
            metadata: {
              offerId: offer.id,
              offeredPrice: offer.offeredPrice,
              status: offer.status,
            },
          },
        });
      }

      // Instagram-style: notify the SELLER (receiver) only, never the buyer (sender)
      prisma.notification.create({
        data: {
          title: `New price offer from ${req.user.name || 'Campus Student'}`,
          message: `Offered ₹${offer.offeredPrice.toFixed(0)} on "${item.title}"`,
          targetAudience: 'USER',
          userId: item.sellerId,
          status: 'SENT',
        },
      }).catch((err) => console.error('Failed to create offer notification for seller:', err));

      res.status(201).json(offer);
    } catch (error) {
      console.error('Create offer error:', error);
      res.status(500).json({ error: 'Failed to create offer' });
    }
  },

  async acceptOffer(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const offer = await prisma.offer.findUnique({
        where: { id },
        include: { item: true },
      });

      if (!offer) {
        res.status(404).json({ error: 'Offer not found' });
        return;
      }

      // Can be accepted by seller (if buyer initiated) or buyer (if seller countered)
      const isSeller = offer.sellerId === req.user.id;
      const isBuyer = offer.buyerId === req.user.id;

      if (!isSeller && !isBuyer) {
        res.status(403).json({ error: 'You are not a participant in this offer' });
        return;
      }

      if (offer.status !== 'PENDING' && offer.status !== 'COUNTERED') {
        res.status(400).json({ error: `Cannot accept offer in ${offer.status} status` });
        return;
      }

      // The final agreed price:
      const finalPrice = offer.counterPrice !== null && offer.status === 'COUNTERED'
        ? offer.counterPrice
        : offer.offeredPrice;

      // Update offer status
      const updatedOffer = await prisma.offer.update({
        where: { id },
        data: { status: 'ACCEPTED' },
      });

      // Find or create transaction and LOCK agreed price
      let transaction = await prisma.transaction.findFirst({
        where: {
          itemId: offer.itemId,
          buyerId: offer.buyerId,
          sellerId: offer.sellerId,
          status: { in: ['REQUESTED', 'NEGOTIATING', 'AGREED'] },
        },
      });

      const qrCode = generateQrVerificationCode(offer.itemId, offer.buyerId, offer.sellerId);

      if (transaction) {
        transaction = await prisma.transaction.update({
          where: { id: transaction.id },
          data: {
            agreedPrice: finalPrice, // STRICT: lock agreed price from offer
            status: 'AGREED',
            qrVerificationCode: qrCode,
          },
        });
      } else {
        transaction = await prisma.transaction.create({
          data: {
            itemId: offer.itemId,
            buyerId: offer.buyerId,
            sellerId: offer.sellerId,
            collegeId: offer.item.collegeId,
            transactionType: offer.item.transactionType,
            agreedPrice: finalPrice, // STRICT: lock agreed price from offer
            status: 'AGREED',
            pickupLocationId: offer.item.pickupLocationId,
            qrVerificationCode: qrCode,
          },
        });
      }

      // Notify conversation
      if (offer.conversationId) {
        await prisma.message.create({
          data: {
            conversationId: offer.conversationId,
            senderId: req.user.id,
            text: `Offer ACCEPTED at ₹${finalPrice.toFixed(2)}! Transaction created (ID: ${transaction.id}).`,
            type: 'OFFER',
            metadata: {
              offerId: offer.id,
              transactionId: transaction.id,
              agreedPrice: finalPrice,
              status: 'ACCEPTED',
            },
          },
        });
      }

      // Instagram-style: notify the RECEIVER only, never the acceptor (sender)
      const recipientId = isSeller ? offer.buyerId : offer.sellerId;
      prisma.notification.create({
        data: {
          title: 'Offer Accepted! 🎉',
          message: `${req.user.name || 'User'} accepted your offer of ₹${finalPrice.toFixed(0)} on "${offer.item.title}"`,
          targetAudience: 'USER',
          userId: recipientId,
          status: 'SENT',
        },
      }).catch((err) => console.error('Failed to create accept offer notification:', err));

      res.json({
        offer: updatedOffer,
        transaction,
        message: `Offer accepted at ₹${finalPrice}. Transaction price locked.`,
      });
    } catch (error) {
      console.error('Accept offer error:', error);
      res.status(500).json({ error: 'Failed to accept offer' });
    }
  },

  async rejectOffer(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const offer = await prisma.offer.findUnique({ where: { id } });

      if (!offer) {
        res.status(404).json({ error: 'Offer not found' });
        return;
      }

      if (offer.sellerId !== req.user.id && offer.buyerId !== req.user.id) {
        res.status(403).json({ error: 'You are not a participant in this offer' });
        return;
      }

      const updated = await prisma.offer.update({
        where: { id },
        data: { status: 'REJECTED' },
      });

      if (offer.conversationId) {
        await prisma.message.create({
          data: {
            conversationId: offer.conversationId,
            senderId: req.user.id,
            text: `Declined offer of ₹${offer.offeredPrice.toFixed(2)}.`,
            type: 'OFFER',
            metadata: { offerId: offer.id, status: 'REJECTED' },
          },
        });
      }

      // Instagram-style: notify the RECEIVER only, never the decliner (sender)
      const rejectRecipientId = offer.sellerId === req.user.id ? offer.buyerId : offer.sellerId;
      prisma.notification.create({
        data: {
          title: 'Offer Declined',
          message: `${req.user.name || 'User'} declined your offer of ₹${offer.offeredPrice.toFixed(0)}`,
          targetAudience: 'USER',
          userId: rejectRecipientId,
          status: 'SENT',
        },
      }).catch((err) => console.error('Failed to create reject offer notification:', err));

      res.json(updated);
    } catch (error) {
      console.error('Reject offer error:', error);
      res.status(500).json({ error: 'Failed to reject offer' });
    }
  },

  async counterOffer(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const { counterPrice, message } = req.body;

      if (counterPrice === undefined) {
        res.status(400).json({ error: 'Counter price is required' });
        return;
      }

      const parentOffer = await prisma.offer.findUnique({ where: { id } });
      if (!parentOffer) {
        res.status(404).json({ error: 'Parent offer not found' });
        return;
      }

      // Mark parent as COUNTERED
      await prisma.offer.update({
        where: { id },
        data: {
          status: 'COUNTERED',
          counterPrice: parseFloat(counterPrice),
          counterBy: req.user.id,
        },
      });

      // Create new child counter offer
      const newOffer = await prisma.offer.create({
        data: {
          itemId: parentOffer.itemId,
          conversationId: parentOffer.conversationId,
          buyerId: parentOffer.buyerId,
          sellerId: parentOffer.sellerId,
          originalPrice: parentOffer.originalPrice,
          offeredPrice: parseFloat(counterPrice),
          status: 'PENDING',
          parentOfferId: parentOffer.id,
          message: message || null,
        },
      });

      if (parentOffer.conversationId) {
        await prisma.message.create({
          data: {
            conversationId: parentOffer.conversationId,
            senderId: req.user.id,
            text: `Proposed counteroffer: ₹${newOffer.offeredPrice.toFixed(2)}${message ? ` - "${message}"` : ''}`,
            type: 'OFFER',
            metadata: {
              offerId: newOffer.id,
              parentOfferId: parentOffer.id,
              offeredPrice: newOffer.offeredPrice,
              status: 'COUNTERED',
            },
          },
        });
      }

      // Instagram-style: notify the RECEIVER only, never the counter-proposer (sender)
      const counterRecipientId = parentOffer.sellerId === req.user.id ? parentOffer.buyerId : parentOffer.sellerId;
      prisma.notification.create({
        data: {
          title: 'Counteroffer Received 🔄',
          message: `${req.user.name || 'User'} countered with ₹${newOffer.offeredPrice.toFixed(0)}`,
          targetAudience: 'USER',
          userId: counterRecipientId,
          status: 'SENT',
        },
      }).catch((err) => console.error('Failed to create counter offer notification:', err));

      res.status(201).json(newOffer);
    } catch (error) {
      console.error('Counter offer error:', error);
      res.status(500).json({ error: 'Failed to counter offer' });
    }
  },
};
