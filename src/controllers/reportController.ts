import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import prisma from '../config/db.js';
import { recordAuditLog } from '../middleware/audit.js';
import { verifyEntityCollegeOwnership } from '../middleware/rbac.js';

export const reportController = {
  async getReports(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { status, collegeId: queryCollegeId } = req.query;

      const where: any = {};

      if (req.user?.role === 'COLLEGE_ADMIN') {
        where.OR = [
          { reporter: { collegeId: req.user.collegeId } },
          { listing: { collegeId: req.user.collegeId } },
          { transaction: { collegeId: req.user.collegeId } },
        ];
      } else if (queryCollegeId && queryCollegeId !== 'ALL') {
        where.OR = [
          { reporter: { collegeId: queryCollegeId } },
          { listing: { collegeId: queryCollegeId } },
          { transaction: { collegeId: queryCollegeId } },
        ];
      }

      if (status && status !== 'ALL') {
        where.status = status;
      }

      const reports = await prisma.report.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          reporter: { select: { id: true, name: true, email: true, college: { select: { name: true } } } },
          reportedUser: { select: { id: true, name: true, email: true } },
          listing: { select: { id: true, title: true, price: true } },
          transaction: { select: { id: true, agreedPrice: true, status: true } },
          resolvedBy: { select: { id: true, name: true } },
        },
      });

      const formatted = reports.map((r) => ({
        id: r.id,
        reporterId: r.reporterId,
        reporterName: r.reporter.name,
        reporterEmail: r.reporter.email,
        collegeName: r.reporter.college?.name || 'Campus',
        reportedUserId: r.reportedUserId,
        reportedUserName: r.reportedUser?.name,
        listingId: r.listingId,
        listingTitle: r.listing?.title,
        transactionId: r.transactionId,
        reason: r.reason,
        description: r.description,
        status: r.status,
        priority: r.priority,
        notes: r.notes,
        resolvedBy: r.resolvedBy?.name,
        resolvedAt: r.resolvedAt?.toISOString(),
        createdAt: r.createdAt.toISOString(),
      }));

      res.json(formatted);
    } catch (error) {
      console.error('Get reports error:', error);
      res.status(500).json({ error: 'Failed to retrieve reports' });
    }
  },

  async createReport(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { reportedUserId, listingId, transactionId, reason, description, priority } = req.body;

      if (!reason || !description) {
        res.status(400).json({ error: 'Reason and description are required' });
        return;
      }

      const report = await prisma.report.create({
        data: {
          reporterId: req.user.id,
          reportedUserId: reportedUserId || null,
          listingId: listingId || null,
          transactionId: transactionId || null,
          reason,
          description,
          priority: priority || 'MEDIUM',
          status: 'OPEN',
        },
      });

      res.status(201).json(report);
    } catch (error) {
      console.error('Create report error:', error);
      res.status(500).json({ error: 'Failed to create report' });
    }
  },

  async updateReportStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user || (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'COLLEGE_ADMIN')) {
        res.status(403).json({ error: 'Admin privileges required' });
        return;
      }

      const { id } = req.params;
      const { status, notes, resolutionNote, priority } = req.body;
      const actualNotes = notes ?? resolutionNote;

      if (!['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED'].includes(status)) {
        res.status(400).json({ error: 'Invalid report status' });
        return;
      }

      if (req.user.role === 'COLLEGE_ADMIN') {
        const isOwner = await verifyEntityCollegeOwnership('report', id, req.user);
        if (!isOwner) {
          res.status(403).json({ error: 'Forbidden: Cannot manage reports outside your college' });
          return;
        }
      }

      const updateData: any = { status };
      if (actualNotes !== undefined) updateData.notes = actualNotes;
      if (priority) updateData.priority = priority;

      if (status === 'RESOLVED' || status === 'REJECTED') {
        updateData.resolvedById = req.user.id;
        updateData.resolvedAt = new Date();
      }

      const updated = await prisma.report.update({
        where: { id },
        data: updateData,
      });

      await recordAuditLog({
        admin: req.user,
        action: `REPORT_${status}`,
        entityType: 'Report',
        entityId: id,
        metadata: { status, notes },
      });

      res.json(updated);
    } catch (error) {
      console.error('Update report error:', error);
      res.status(500).json({ error: 'Failed to update report' });
    }
  },
};
