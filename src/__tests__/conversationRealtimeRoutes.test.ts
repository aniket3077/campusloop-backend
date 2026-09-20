import request from 'supertest';
import app from '../app.js';
import prisma from '../config/db.js';
import { generateToken } from '../utils/token.js';
import { realtimeChatService } from '../services/realtimeChatService.js';

describe('Conversation Real-Time & WhatsApp-Grade Routes', () => {
  let user1Token: string;
  let user2Token: string;
  let user1Id: string;
  let user2Id: string;
  let conversationId: string;

  beforeAll(async () => {
    // Pick or create 2 test users
    const users = await prisma.user.findMany({ take: 2 });
    if (users.length >= 2) {
      user1Id = users[0].id;
      user2Id = users[1].id;
    } else {
      user1Id = 'test_user_rt_1';
      user2Id = 'test_user_rt_2';
    }

    user1Token = generateToken({
      id: user1Id,
      email: 'student1@campusloop.in',
      role: 'STUDENT',
      name: 'Student One',
    });

    user2Token = generateToken({
      id: user2Id,
      email: 'student2@campusloop.in',
      role: 'STUDENT',
      name: 'Student Two',
    });

    // Create test conversation
    let conv = await prisma.conversation.findFirst({
      where: {
        OR: [
          { participantAId: user1Id, participantBId: user2Id },
          { participantAId: user2Id, participantBId: user1Id },
        ],
      },
    });

    if (!conv) {
      conv = await prisma.conversation.create({
        data: {
          participantAId: user1Id,
          participantBId: user2Id,
        },
      });
    }

    conversationId = conv.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('POST /api/conversations/:id/typing updates typing status in 0ms', async () => {
    const broadcastSpy = jest.spyOn(realtimeChatService, 'broadcast');

    const res = await request(app)
      .post(`/api/conversations/${conversationId}/typing`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ isTyping: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.isTyping).toBe(true);

    expect(broadcastSpy).toHaveBeenCalledWith(
      conversationId,
      'typing:status',
      expect.objectContaining({
        conversationId,
        userId: user1Id,
        isTyping: true,
      }),
      user1Id
    );

    broadcastSpy.mockRestore();
  });

  it('POST /api/conversations/:id/messages creates message with isRead: false and broadcasts in real-time', async () => {
    const broadcastSpy = jest.spyOn(realtimeChatService, 'broadcast');

    const res = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ text: 'Testing real-time WhatsApp speed broadcast' });

    expect(res.status).toBe(201);
    expect(res.body.text).toBe('Testing real-time WhatsApp speed broadcast');
    expect(res.body.isRead).toBe(false);
    expect(res.body.isMe).toBe(true);

    // Verify broadcast event was dispatched
    expect(broadcastSpy).toHaveBeenCalledWith(
      conversationId,
      'message:new',
      expect.objectContaining({
        conversationId,
        text: 'Testing real-time WhatsApp speed broadcast',
        isRead: false,
      }),
      user1Id
    );

    broadcastSpy.mockRestore();
  });

  it('PATCH /api/conversations/:id/read marks messages as read and broadcasts read receipt', async () => {
    const broadcastSpy = jest.spyOn(realtimeChatService, 'broadcast');

    // User 2 reads messages sent by User 1
    const res = await request(app)
      .patch(`/api/conversations/${conversationId}/read`)
      .set('Authorization', `Bearer ${user2Token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.readAt).toBeDefined();

    expect(broadcastSpy).toHaveBeenCalledWith(
      conversationId,
      'message:read',
      expect.objectContaining({
        conversationId,
        readBy: user2Id,
      }),
      user2Id
    );

    broadcastSpy.mockRestore();
  });
});
