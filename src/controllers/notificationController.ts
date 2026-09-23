import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import prisma from '../config/db.js';
import { recordAuditLog } from '../middleware/audit.js';

export const notificationController = {
  async getNotifications(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const where: any = {};

      if (req.user?.role === 'COLLEGE_ADMIN') {
        where.OR = [
          { targetAudience: 'ALL' },
          ...(req.user.collegeId ? [{ collegeId: req.user.collegeId }] : []),
        ];
      } else if (req.user?.role === 'STUDENT') {
        where.OR = [
          { targetAudience: 'ALL' },
          ...(req.user.collegeId ? [{ collegeId: req.user.collegeId }] : []),
          ...(req.user.id ? [{ userId: req.user.id }] : []),
        ];
      }

      const notifications = await prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { college: { select: { name: true, code: true } } },
      });

      const formatted = notifications.map((n) => ({
        id: n.id,
        title: n.title,
        message: n.message,
        targetAudience: n.targetAudience,
        collegeId: n.collegeId,
        collegeName: n.college?.name || 'Platform Wide',
        scheduledAt: n.scheduledAt?.toISOString(),
        sentAt: (n.sentAt ?? n.createdAt).toISOString(),
        status: n.status,
        createdAt: n.createdAt.toISOString(),
      }));

      res.json(formatted);
    } catch (error) {
      console.error('Get notifications error:', error);
      res.status(500).json({ error: 'Failed to retrieve notifications' });
    }
  },

  async sendAnnouncement(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user || (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'COLLEGE_ADMIN')) {
        res.status(403).json({ error: 'Admin privileges required' });
        return;
      }

      const { title, message, targetAudience, collegeId: reqCollegeId, scheduledAt } = req.body;

      if (!title || !message) {
        res.status(400).json({ error: 'Title and message are required' });
        return;
      }

      // COLLEGE_ADMIN can only broadcast to their college
      let audience = targetAudience || 'COLLEGE';
      let collegeId = reqCollegeId;

      if (req.user.role === 'COLLEGE_ADMIN') {
        audience = 'COLLEGE';
        collegeId = req.user.collegeId;
      }

      const notification = await prisma.notification.create({
        data: {
          title,
          message,
          targetAudience: audience,
          collegeId: audience === 'COLLEGE' ? collegeId : null,
          scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
          status: 'SENT',
        },
      });

      await recordAuditLog({
        admin: req.user,
        action: 'ANNOUNCEMENT_SENT',
        entityType: 'Notification',
        entityId: notification.id,
        metadata: { title, targetAudience: audience, collegeId },
      });

      res.status(201).json(notification);
    } catch (error) {
      console.error('Send announcement error:', error);
      res.status(500).json({ error: 'Failed to send announcement' });
    }
  },
};
