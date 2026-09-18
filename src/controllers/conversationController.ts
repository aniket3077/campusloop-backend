import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import prisma from '../config/db.js';

export const conversationController = {
  async getConversations(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const conversations = await prisma.conversation.findMany({
        where: {
          OR: [{ participantAId: req.user.id }, { participantBId: req.user.id }],
        },
        include: {
          participantA: {
            select: {
              id: true,
              name: true,
              email: true,
              trustRating: true,
              verificationStatus: true,
              department: true,
              avatarUrl: true,
              college: { select: { name: true } },
            },
          },
          participantB: {
            select: {
              id: true,
              name: true,
              email: true,
              trustRating: true,
              verificationStatus: true,
              department: true,
              avatarUrl: true,
              college: { select: { name: true } },
            },
          },
          item: {
            select: {
              id: true,
              title: true,
              price: true,
              category: true,
              transactionType: true,
              images: { take: 1, orderBy: { order: 'asc' } },
            },
          },
          messages: {
            take: 1,
            orderBy: { createdAt: 'desc' },
          },
          offers: {
            take: 1,
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { lastMessageAt: 'desc' },
      });

      const formatted = conversations.map((c) => {
        const otherParticipant = c.participantAId === req.user?.id ? c.participantB : c.participantA;
        const lastMsg = c.messages[0];
        const latestOffer = c.offers[0];

        return {
          id: c.id,
          itemId: c.itemId || '',
          resourceId: c.itemId || '',
          itemTitle: c.item?.title || 'Campus Item',
          resourceTitle: c.item?.title || 'Campus Item',
          itemPrice: c.item?.price ?? 0,
          resourcePrice: c.item?.price ?? 0,
          itemCategory: c.item?.category || 'General',
          resourceType: c.item?.transactionType || c.item?.category || 'SELL',
          itemImageUrl: c.item?.images[0]?.url || null,
          resourceImageUrl: c.item?.images[0]?.url || null,
          participant: {
            id: otherParticipant?.id || '',
            name: otherParticipant?.name || 'Campus Student',
            email: otherParticipant?.email || '',
            trustRating: otherParticipant?.trustRating ?? 5.0,
            isVerifiedStudent: otherParticipant?.verificationStatus === 'VERIFIED',
            university: otherParticipant?.college?.name || 'MIT CSN',
            department: otherParticipant?.department || 'Student',
            avatarUrl: otherParticipant?.avatarUrl || null,
          },
          otherParticipantName: otherParticipant?.name || 'Campus Student',
          isVerifiedStudent: otherParticipant?.verificationStatus === 'VERIFIED',
          lastMessage: lastMsg?.text || 'Chat initiated',
          lastMessageTime: (lastMsg?.createdAt || c.lastMessageAt).toISOString(),
          unreadCount: 0,
          activeOffer: latestOffer ? {
            offerId: latestOffer.id,
            offeredPrice: latestOffer.offeredPrice,
            status: latestOffer.status,
            isBuyer: latestOffer.buyerId === req.user?.id,
          } : null,
        };
      });

      res.json(formatted);
    } catch (error) {
      console.error('Get conversations error:', error);
      res.status(500).json({ error: 'Failed to retrieve conversations' });
    }
  },

  async createOrGetConversation(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      let { itemId, sellerId, initialMessage } = req.body;

      // 1. Resolve sellerId from item if not provided
      let validItem = null;
      if (itemId) {
        validItem = await prisma.item.findUnique({
          where: { id: itemId },
          include: {
            images: { take: 1, orderBy: { order: 'asc' } },
          },
        });
        if (validItem && !sellerId) {
          sellerId = validItem.sellerId;
        }
      }

      // 2. Resolve seller user record
      let resolvedSeller = null;
      if (sellerId) {
        resolvedSeller = await prisma.user.findFirst({
          where: {
            OR: [
              { id: sellerId },
              { email: sellerId },
              { name: sellerId },
            ],
          },
          include: { college: { select: { name: true } } },
        });
      }

      if (!resolvedSeller) {
        // If still not resolved and item exists, use item's seller
        if (validItem) {
          resolvedSeller = await prisma.user.findUnique({
            where: { id: validItem.sellerId },
            include: { college: { select: { name: true } } },
          });
        }
      }

      if (!resolvedSeller) {
        res.status(400).json({ error: 'Valid seller could not be determined' });
        return;
      }

      const targetSellerId = resolvedSeller.id;

      // If user is starting conversation with themselves, return existing conversation if any
      if (targetSellerId === req.user.id) {
        const existingSelfConv = await prisma.conversation.findFirst({
          where: {
            OR: [
              { participantAId: req.user.id },
              { participantBId: req.user.id },
            ],
            itemId: validItem ? validItem.id : undefined,
          },
          include: {
            participantA: {
              select: {
                id: true, name: true, email: true, trustRating: true,
                verificationStatus: true, department: true, avatarUrl: true,
                college: { select: { name: true } },
              },
            },
            participantB: {
              select: {
                id: true, name: true, email: true, trustRating: true,
                verificationStatus: true, department: true, avatarUrl: true,
                college: { select: { name: true } },
              },
            },
            item: {
              select: {
                id: true, title: true, price: true, category: true,
                transactionType: true, images: { take: 1 },
              },
            },
            messages: { take: 1, orderBy: { createdAt: 'desc' } },
          },
        });

        if (existingSelfConv) {
          const other = existingSelfConv.participantAId === req.user.id ? existingSelfConv.participantB : existingSelfConv.participantA;
          res.status(200).json({
            id: existingSelfConv.id,
            itemId: existingSelfConv.itemId,
            resourceId: existingSelfConv.itemId,
            itemTitle: existingSelfConv.item?.title,
            resourceTitle: existingSelfConv.item?.title,
            itemPrice: existingSelfConv.item?.price,
            resourcePrice: existingSelfConv.item?.price,
            itemCategory: existingSelfConv.item?.category,
            resourceType: existingSelfConv.item?.transactionType,
            itemImageUrl: existingSelfConv.item?.images?.[0]?.url,
            resourceImageUrl: existingSelfConv.item?.images?.[0]?.url,
            participant: {
              id: other?.id || req.user.id,
              name: other?.name || 'Campus Student',
              email: other?.email || '',
              trustRating: other?.trustRating ?? 5.0,
              isVerifiedStudent: other?.verificationStatus === 'VERIFIED',
              university: other?.college?.name || 'MIT CSN',
              department: other?.department || 'Student',
              avatarUrl: other?.avatarUrl,
            },
            otherParticipantName: other?.name || 'Campus Student',
            isVerifiedStudent: other?.verificationStatus === 'VERIFIED',
            lastMessage: existingSelfConv.messages[0]?.text || 'Chat initiated',
            lastMessageTime: existingSelfConv.lastMessageAt.toISOString(),
            unreadCount: 0,
          });
          return;
        }

        res.status(400).json({ error: 'Cannot start conversation with yourself' });
        return;
      }

      // 3. Find existing conversation between these two students
      let conversation = await prisma.conversation.findFirst({
        where: {
          AND: [
            validItem ? { itemId: validItem.id } : {},
            {
              OR: [
                { participantAId: req.user.id, participantBId: targetSellerId },
                { participantAId: targetSellerId, participantBId: req.user.id },
              ],
            },
          ],
        },
        include: {
          participantA: {
            select: {
              id: true, name: true, email: true, trustRating: true,
              verificationStatus: true, department: true, avatarUrl: true,
              college: { select: { name: true } },
            },
          },
          participantB: {
            select: {
              id: true, name: true, email: true, trustRating: true,
              verificationStatus: true, department: true, avatarUrl: true,
              college: { select: { name: true } },
            },
          },
          item: {
            select: {
              id: true, title: true, price: true, category: true,
              transactionType: true, images: { take: 1 },
            },
          },
          messages: {
            take: 1,
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      // 4. Create new conversation if not found
      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            itemId: validItem ? validItem.id : null,
            participantAId: req.user.id,
            participantBId: targetSellerId,
          },
          include: {
            participantA: {
              select: {
                id: true, name: true, email: true, trustRating: true,
                verificationStatus: true, department: true, avatarUrl: true,
                college: { select: { name: true } },
              },
            },
            participantB: {
              select: {
                id: true, name: true, email: true, trustRating: true,
                verificationStatus: true, department: true, avatarUrl: true,
                college: { select: { name: true } },
              },
            },
            item: {
              select: {
                id: true, title: true, price: true, category: true,
                transactionType: true, images: { take: 1 },
              },
            },
            messages: {
              take: 1,
              orderBy: { createdAt: 'desc' },
            },
          },
        });

        // Insert initial system/inquiry message
        const hasInitialMessage = typeof initialMessage === 'string' && initialMessage.trim().length > 0;
        const welcomeText = hasInitialMessage
          ? initialMessage.trim()
          : (validItem ? `Hi ${resolvedSeller.name}! I saw your listing "${validItem.title}". Is it still available on campus?` : 'Started a conversation.');

        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            senderId: req.user.id,
            text: welcomeText,
            type: 'TEXT',
          },
        });
      }

      const other = conversation.participantAId === req.user.id ? conversation.participantB : conversation.participantA;

      res.status(200).json({
        id: conversation.id,
        itemId: conversation.itemId || '',
        resourceId: conversation.itemId || '',
        itemTitle: conversation.item?.title || validItem?.title || 'Campus Item',
        resourceTitle: conversation.item?.title || validItem?.title || 'Campus Item',
        itemPrice: conversation.item?.price ?? validItem?.price ?? 0,
        resourcePrice: conversation.item?.price ?? validItem?.price ?? 0,
        itemCategory: conversation.item?.category || validItem?.category || 'General',
        resourceType: conversation.item?.transactionType || validItem?.transactionType || 'SELL',
        itemImageUrl: conversation.item?.images?.[0]?.url || validItem?.images?.[0]?.url || null,
        resourceImageUrl: conversation.item?.images?.[0]?.url || validItem?.images?.[0]?.url || null,
        participant: {
          id: other?.id || targetSellerId,
          name: other?.name || resolvedSeller.name,
          email: other?.email || resolvedSeller.email,
          trustRating: other?.trustRating ?? resolvedSeller.trustRating ?? 5.0,
          isVerifiedStudent: (other?.verificationStatus ?? resolvedSeller.verificationStatus) === 'VERIFIED',
          university: other?.college?.name || resolvedSeller.college?.name || 'MIT CSN',
          department: other?.department || resolvedSeller.department || 'Student',
          avatarUrl: other?.avatarUrl || resolvedSeller.avatarUrl || null,
        },
        otherParticipantName: other?.name || resolvedSeller.name,
        isVerifiedStudent: (other?.verificationStatus ?? resolvedSeller.verificationStatus) === 'VERIFIED',
        lastMessage: conversation.messages?.[0]?.text || 'Chat initiated',
        lastMessageTime: conversation.lastMessageAt.toISOString(),
        unreadCount: 0,
      });
    } catch (error) {
      console.error('Create conversation error:', error);
      res.status(500).json({ error: 'Failed to create conversation' });
    }
  },

  async getMessages(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      // Handle if conversation does not exist or client ID passed
      const conversation = await prisma.conversation.findUnique({
        where: { id },
      });

      if (!conversation) {
        res.json([]);
        return;
      }

      const messages = await prisma.message.findMany({
        where: { conversationId: id },
        orderBy: { createdAt: 'asc' },
        include: {
          sender: { select: { id: true, name: true } },
        },
      });

      const formatted = messages.map((m) => {
        const meta = m.metadata as any;
        return {
          id: m.id,
          conversationId: m.conversationId,
          senderId: m.senderId,
          senderName: m.sender?.name || 'Campus Student',
          text: m.text,
          type: m.type,
          priceOffer: meta?.priceOffer ?? meta?.offeredPrice ?? null,
          isOffer: m.type === 'OFFER' || !!meta?.priceOffer || !!meta?.offeredPrice,
          offerStatus: meta?.status || (m.type === 'OFFER' ? 'PENDING' : null),
          metadata: m.metadata,
          isMe: m.senderId === req.user?.id,
          timestamp: m.createdAt.toISOString(),
        };
      });

      res.json(formatted);
    } catch (error) {
      console.error('Get messages error:', error);
      res.status(500).json({ error: 'Failed to retrieve messages' });
    }
  },

  async sendMessage(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const { text, type, metadata, itemId, sellerId } = req.body;

      if (!text || text.trim() === '') {
        res.status(400).json({ error: 'Message cannot be empty' });
        return;
      }

      // Check if conversation exists by direct UUID
      let conversation = await prisma.conversation.findUnique({
        where: { id },
      });

      // If not found (e.g. client ID format conv_<itemId>_<timestamp>), resolve or create
      if (!conversation) {
        let targetItemId: string | null = itemId || null;
        if (!targetItemId && id.startsWith('conv_')) {
          const parts = id.split('_');
          if (parts.length >= 2) {
            targetItemId = parts[1];
          }
        }

        if (targetItemId) {
          conversation = await prisma.conversation.findFirst({
            where: {
              itemId: targetItemId,
              OR: [{ participantAId: req.user.id }, { participantBId: req.user.id }],
            },
          });
        }

        // Auto-create if sellerId is provided or can be found from item
        if (!conversation && (sellerId || targetItemId)) {
          let resolvedSellerId = sellerId;
          if (!resolvedSellerId && targetItemId) {
            const item = await prisma.item.findUnique({ where: { id: targetItemId } });
            if (item) resolvedSellerId = item.sellerId;
          }

          if (resolvedSellerId && resolvedSellerId !== req.user.id) {
            conversation = await prisma.conversation.create({
              data: {
                itemId: targetItemId || null,
                participantAId: req.user.id,
                participantBId: resolvedSellerId,
              },
            });
          }
        }
      }

      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      const messageType = type || (metadata?.priceOffer ? 'OFFER' : 'TEXT');

      const message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: req.user.id,
          text: text.trim(),
          type: messageType,
          metadata: metadata || undefined,
        },
        include: { sender: { select: { id: true, name: true } } },
      });

      // Update last message timestamp
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
      });

      const meta = message.metadata as any;
      res.status(201).json({
        id: message.id,
        conversationId: conversation.id,
        senderId: message.senderId,
        senderName: message.sender?.name || req.user.name || 'Me',
        text: message.text,
        type: message.type,
        priceOffer: meta?.priceOffer ?? meta?.offeredPrice ?? null,
        isOffer: message.type === 'OFFER' || !!meta?.priceOffer || !!meta?.offeredPrice,
        offerStatus: meta?.status || (message.type === 'OFFER' ? 'PENDING' : null),
        metadata: message.metadata,
        isMe: true,
        timestamp: message.createdAt.toISOString(),
      });
    } catch (error) {
      console.error('Send message error:', error);
      res.status(500).json({ error: 'Failed to send message' });
    }
  },
};

