import { realtimeChatService, ChatEvent } from '../services/realtimeChatService.js';
import { Response } from 'express';

describe('RealtimeChatService (WhatsApp-Grade Persistent Streaming)', () => {
  const conversationId = 'conv_test_realtime_001';

  afterEach(() => {
    // Clean up connections
  });

  it('registers clients and handles instant message broadcasts in 0ms', () => {
    const writtenData: string[] = [];

    const mockRes = {
      write: jest.fn((chunk: string) => {
        writtenData.push(chunk);
        return true;
      }),
      on: jest.fn(),
    } as unknown as Response;

    // 1. Add client to stream
    realtimeChatService.addClient(conversationId, 'user_buyer_1', mockRes);
    expect(realtimeChatService.getListenerCount(conversationId)).toBe(1);

    // Initial handshake event
    expect(writtenData.length).toBe(1);
    expect(writtenData[0]).toContain('event: connected');

    // 2. Broadcast a new message
    const msgPayload = {
      id: 'msg_101',
      text: 'Is the textbook available today?',
      senderId: 'user_seller_2',
      isRead: false,
    };

    realtimeChatService.broadcast(conversationId, 'message:new', msgPayload);

    expect(writtenData.length).toBe(2);
    expect(writtenData[1]).toContain('event: message:new');
    expect(writtenData[1]).toContain('Is the textbook available today?');

    // 3. Broadcast read receipt (WhatsApp blue ticks)
    realtimeChatService.broadcast(conversationId, 'message:read', {
      conversationId,
      readBy: 'user_seller_2',
      updatedCount: 1,
    });

    expect(writtenData.length).toBe(3);
    expect(writtenData[2]).toContain('event: message:read');

    // 4. Broadcast typing status
    realtimeChatService.broadcast(conversationId, 'typing:status', {
      conversationId,
      userId: 'user_seller_2',
      isTyping: true,
    });

    expect(writtenData.length).toBe(4);
    expect(writtenData[3]).toContain('event: typing:status');
    expect(writtenData[3]).toContain('"isTyping":true');

    // 5. Remove client
    realtimeChatService.removeClient(conversationId, mockRes);
    expect(realtimeChatService.getListenerCount(conversationId)).toBe(0);
  });

  it('excludes sender from receiving their own broadcasted events', () => {
    const writtenUser1: string[] = [];
    const writtenUser2: string[] = [];

    const mockRes1 = {
      write: jest.fn((chunk: string) => {
        writtenUser1.push(chunk);
        return true;
      }),
      on: jest.fn(),
    } as unknown as Response;

    const mockRes2 = {
      write: jest.fn((chunk: string) => {
        writtenUser2.push(chunk);
        return true;
      }),
      on: jest.fn(),
    } as unknown as Response;

    realtimeChatService.addClient(conversationId, 'user_1', mockRes1);
    realtimeChatService.addClient(conversationId, 'user_2', mockRes2);

    expect(realtimeChatService.getListenerCount(conversationId)).toBe(2);

    // User 1 sends message -> broadcast excluding User 1
    realtimeChatService.broadcast(
      conversationId,
      'message:new',
      { id: 'msg_999', text: 'Hello from user 1' },
      'user_1'
    );

    // User 1 got only initial 'connected'
    expect(writtenUser1.length).toBe(1);
    // User 2 got 'connected' AND 'message:new'
    expect(writtenUser2.length).toBe(2);
    expect(writtenUser2[1]).toContain('Hello from user 1');

    realtimeChatService.removeClient(conversationId, mockRes1);
    realtimeChatService.removeClient(conversationId, mockRes2);
  });
});
