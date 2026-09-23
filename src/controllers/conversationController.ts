import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import prisma from '../config/db.js';
import { realtimeChatService } from '../services/realtimeChatService.js';

async function resolveConversationRecord(
  id: string,
  userId?: string,
  itemId?: string | null
): Promise<{ id: string; participantAId: string; participantBId: string; itemId: string | null } | null> {
  // 1. Direct UUID lookup
  let conversation = await prisma.conversation.findUnique({
    where: { id },
    select: { id: true, participantAId: true, participantBId: true, itemId: true },
  });
  if (conversation) return conversation;

  // 2. Client temporary ID format: conv_<itemId>_<timestamp>
  let targetItemId = itemId || null;
  if (!targetItemId && id.startsWith('conv_')) {
    const parts = id.split('_');
    if (parts.length >= 2) {
      targetItemId = parts[1];
    }
  }

  if (targetItemId) {
    if (userId) {
      conversation = await prisma.conversation.findFirst({
        where: {
          itemId: targetItemId,
          OR: [{ participantAId: userId }, { participantBId: userId }],
        },
        select: { id: true, participantAId: true, participantBId: true, itemId: true },
      });
    } else {
      conversation = await prisma.conversation.findFirst({
        where: { itemId: targetItemId },
        select: { id: true, participantAId: true, participantBId: true, itemId: true },
      });
    }
    if (conversation) return conversation;
  }

  return null;
}

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

      // Handle if conversation does not exist or client ID passed (conv_<itemId>_<timestamp>)
      const conversation = await resolveConversationRecord(id, req.user?.id);

      if (!conversation) {
        res.json([]);
        return;
      }

      const messages = await prisma.message.findMany({
        where: { conversationId: conversation.id },
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
          isRead: meta?.isRead === true,
          readAt: meta?.readAt || null,
          timestamp: m.createdAt.toISOString(),
        };
      });

      // Auto-mark unread peer messages as read when recipient loads conversation
      if (req.user) {
        const unreadPeerMsgs = messages.filter(
          (m) => m.senderId !== req.user?.id && !(m.metadata as any)?.isRead
        );

        if (unreadPeerMsgs.length > 0) {
          const readAt = new Date().toISOString();
          Promise.all(
            unreadPeerMsgs.map((m) => {
              const meta = (m.metadata as any) || {};
              return prisma.message.update({
                where: { id: m.id },
                data: { metadata: { ...meta, isRead: true, readAt } },
              });
            })
          )
            .then(() => {
              realtimeChatService.broadcast(
                conversation.id,
                'message:read',
                { conversationId: conversation.id, readBy: req.user!.id, readAt, count: unreadPeerMsgs.length },
                req.user!.id
              );
              if (conversation.id !== id) {
                realtimeChatService.broadcast(
                  id,
                  'message:read',
                  { conversationId: conversation.id, readBy: req.user!.id, readAt, count: unreadPeerMsgs.length },
                  req.user!.id
                );
              }
            })
            .catch((e) => console.error('Auto-mark read error:', e));
        }
      }

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

      // Check if conversation exists by direct UUID or temporary client ID
      let conversation = await resolveConversationRecord(id, req.user.id, itemId);

      // If not found, resolve item/seller and auto-create
      if (!conversation) {
        let targetItemId: string | null = itemId || null;
        if (!targetItemId && id.startsWith('conv_')) {
          const parts = id.split('_');
          if (parts.length >= 2) {
            targetItemId = parts[1];
          }
        }

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
            select: { id: true, participantAId: true, participantBId: true, itemId: true },
          });
        }
      }

      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      const messageType = type || (metadata?.priceOffer ? 'OFFER' : 'TEXT');
      const messageMetadata = {
        ...(typeof metadata === 'object' && metadata !== null ? metadata : {}),
        isRead: false,
      };

      const message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: req.user.id,
          text: text.trim(),
          type: messageType,
          metadata: messageMetadata,
        },
        include: { sender: { select: { id: true, name: true } } },
      });

      // Update last message timestamp
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
      });

      const meta = message.metadata as any;
      const formattedMessage = {
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
        isMe: false,
        isRead: false,
        timestamp: message.createdAt.toISOString(),
      };

      // 0ms Real-Time Push to active listeners (WhatsApp style)
      realtimeChatService.broadcast(
        conversation.id,
        'message:new',
        formattedMessage,
        req.user.id
      );
      if (conversation.id !== id) {
        realtimeChatService.broadcast(
          id,
          'message:new',
          formattedMessage,
          req.user.id
        );
      }

      // Instagram-style: notify the RECEIVER only, never the sender
      const recipientId = conversation.participantAId === req.user.id
        ? conversation.participantBId
        : conversation.participantAId;

      if (recipientId && recipientId !== req.user.id) {
        prisma.notification.create({
          data: {
            title: `Message from ${req.user.name || 'Campus Student'}`,
            message: text.trim().length > 120 ? text.trim().substring(0, 117) + '...' : text.trim(),
            targetAudience: 'USER',
            userId: recipientId,
            status: 'SENT',
          },
        }).catch((err) => console.error('Failed to create message notification for recipient:', err));
      }

      res.status(201).json({
        ...formattedMessage,
        isMe: true,
      });
    } catch (error) {
      console.error('Send message error:', error);
      res.status(500).json({ error: 'Failed to send message' });
    }
  },

  async markAsRead(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;

      const conversation = await resolveConversationRecord(id, req.user.id);

      if (!conversation) {
        // Idempotent success: draft conversations have 0 unread messages in the database
        res.status(200).json({ success: true, updatedCount: 0, readAt: new Date().toISOString() });
        return;
      }

      const readAt = new Date().toISOString();

      // Find all unread messages sent by peer
      const unreadMessages = await prisma.message.findMany({
        where: {
          conversationId: conversation.id,
          senderId: { not: req.user.id },
        },
        select: { id: true, metadata: true },
      });

      let updatedCount = 0;
      for (const msg of unreadMessages) {
        const meta = (msg.metadata as any) || {};
        if (!meta.isRead) {
          await prisma.message.update({
            where: { id: msg.id },
            data: {
              metadata: {
                ...meta,
                isRead: true,
                readAt,
              },
            },
          });
          updatedCount++;
        }
      }

      // Broadcast read receipt in 0ms (WhatsApp double cyan ticks)
      realtimeChatService.broadcast(
        conversation.id,
        'message:read',
        {
          conversationId: conversation.id,
          readBy: req.user.id,
          readAt,
          updatedCount,
        },
        req.user.id
      );
      if (conversation.id !== id) {
        realtimeChatService.broadcast(
          id,
          'message:read',
          {
            conversationId: conversation.id,
            readBy: req.user.id,
            readAt,
            updatedCount,
          },
          req.user.id
        );
      }

      res.json({ success: true, updatedCount, readAt });
    } catch (error) {
      console.error('Mark as read error:', error);
      res.status(500).json({ error: 'Failed to mark messages as read' });
    }
  },

  async setTyping(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;
      const { isTyping } = req.body;

      realtimeChatService.broadcast(
        id,
        'typing:status',
        {
          conversationId: id,
          userId: req.user.id,
          userName: req.user.name,
          isTyping: !!isTyping,
        },
        req.user.id
      );

      const conversation = await resolveConversationRecord(id, req.user.id);
      if (conversation && conversation.id !== id) {
        realtimeChatService.broadcast(
          conversation.id,
          'typing:status',
          {
            conversationId: conversation.id,
            userId: req.user.id,
            userName: req.user.name,
            isTyping: !!isTyping,
          },
          req.user.id
        );
      }

      res.json({ success: true, isTyping: !!isTyping });
    } catch (error) {
      console.error('Set typing error:', error);
      res.status(500).json({ error: 'Failed to update typing status' });
    }
  },

  async streamConversation(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { id } = req.params;

      const conversation = await resolveConversationRecord(id, req.user.id);

      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      if (conversation.participantAId !== req.user.id && conversation.participantBId !== req.user.id) {
        res.status(403).json({ error: 'Forbidden: Not a participant in this conversation' });
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders?.();

      realtimeChatService.addClient(conversation.id, req.user.id, res);
      if (conversation.id !== id) {
        realtimeChatService.addClient(id, req.user.id, res);
      }
    } catch (error) {
      console.error('Stream conversation error:', error);
      res.status(500).end();
    }
  },
};

