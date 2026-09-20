import { Response } from 'express';

export interface ChatEvent {
  event: 'message:new' | 'message:read' | 'typing:status' | 'connected' | 'ping';
  conversationId: string;
  data: any;
  timestamp: string;
}

interface ConnectedClient {
  userId: string;
  res: Response;
}

class RealtimeChatService {
  // Map of conversationId -> Set of ConnectedClient
  private conversations = new Map<string, Set<ConnectedClient>>();
  private keepAliveTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.startKeepAlive();
  }

  private startKeepAlive(): void {
    // Send periodic SSE comment ping every 25s to keep connections alive through Cloud Run & proxies
    this.keepAliveTimer = setInterval(() => {
      for (const [convId, clients] of this.conversations.entries()) {
        for (const client of clients) {
          try {
            client.res.write(`: ping\n\n`);
          } catch {
            this.removeClient(convId, client.res);
          }
        }
      }
    }, 25000);

    if (this.keepAliveTimer.unref) {
      this.keepAliveTimer.unref();
    }
  }

  /**
   * Registers a client response stream for SSE
   */
  public addClient(conversationId: string, userId: string, res: Response): void {
    if (!this.conversations.has(conversationId)) {
      this.conversations.set(conversationId, new Set());
    }

    const client: ConnectedClient = { userId, res };
    this.conversations.get(conversationId)!.add(client);

    // Write initial connection handshake
    const initialPayload: ChatEvent = {
      event: 'connected',
      conversationId,
      data: { userId, status: 'streaming' },
      timestamp: new Date().toISOString(),
    };

    res.write(`event: ${initialPayload.event}\ndata: ${JSON.stringify(initialPayload)}\n\n`);

    // Clean up when client disconnects
    res.on('close', () => {
      this.removeClient(conversationId, res);
    });
  }

  /**
   * Removes client from the active conversation pool
   */
  public removeClient(conversationId: string, res: Response): void {
    const clients = this.conversations.get(conversationId);
    if (!clients) return;

    for (const client of clients) {
      if (client.res === res) {
        clients.delete(client);
        break;
      }
    }

    if (clients.size === 0) {
      this.conversations.delete(conversationId);
    }
  }

  /**
   * Dispatches a real-time event to all connected clients in a conversation in 0ms
   */
  public broadcast(
    conversationId: string,
    event: ChatEvent['event'],
    data: any,
    excludeUserId?: string
  ): void {
    const clients = this.conversations.get(conversationId);
    if (!clients || clients.size === 0) return;

    const payload: ChatEvent = {
      event,
      conversationId,
      data,
      timestamp: new Date().toISOString(),
    };

    const sseMessage = `event: ${payload.event}\ndata: ${JSON.stringify(payload)}\n\n`;

    for (const client of clients) {
      if (excludeUserId && client.userId === excludeUserId) {
        continue;
      }
      try {
        client.res.write(sseMessage);
      } catch (err) {
        this.removeClient(conversationId, client.res);
      }
    }
  }

  /**
   * Returns active listener count for a conversation
   */
  public getListenerCount(conversationId: string): number {
    return this.conversations.get(conversationId)?.size ?? 0;
  }
}

export const realtimeChatService = new RealtimeChatService();
