import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import prisma from '../config/db.js';
import { recordAuditLog } from '../middleware/audit.js';
import { verifyEntityCollegeOwnership } from '../middleware/rbac.js';

export const studentController = {
  async getStudents(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { search, status, verificationStatus, collegeId: queryCollegeId } = req.query;

      const where: any = {
        role: 'STUDENT',
      };

      // Strict college scoping for COLLEGE_ADMIN
      if (req.user?.role === 'COLLEGE_ADMIN') {
        where.collegeId = req.user.collegeId;
      } else if (queryCollegeId && queryCollegeId !== 'ALL') {
        where.collegeId = queryCollegeId;
      }

      if (status && status !== 'ALL') {
        where.status = status;
      }

      if (verificationStatus && verificationStatus !== 'ALL') {
        where.verificationStatus = verificationStatus;
      }

      if (search && typeof search === 'string') {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { rollNumber: { contains: search, mode: 'insensitive' } },
          { department: { contains: search, mode: 'insensitive' } },
        ];
      }

      const students = await prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          college: { select: { id: true, name: true, code: true } },
          _count: {
            select: {
              ownedItems: true,
              buyerTransactions: true,
              sellerTransactions: true,
            },
          },
        },
      });

      const formatted = students.map((s) => {
        const displayStatus = s.status === 'SUSPENDED'
          ? 'SUSPENDED'
          : (s.verificationStatus === 'VERIFIED' ? 'VERIFIED' : s.verificationStatus);

        return {
          id: s.id,
          fullName: s.name,
          name: s.name,
          email: s.email,
          collegeId: s.collegeId,
          collegeName: s.college?.name || 'Unassigned',
          collegeCode: s.college?.code,
          department: s.department || 'General',
          academicYear: s.academicYear || '1st Year',
          graduationYear: s.academicYear ? parseInt(s.academicYear) || new Date().getFullYear() + 2 : new Date().getFullYear() + 2,
          rollNumber: s.rollNumber || 'N/A',
          status: displayStatus,
          verificationStatus: s.verificationStatus,
          verificationNote: s.verificationNote,
          idCardUrl: s.avatarUrl || (s.verificationNote?.startsWith('http') ? s.verificationNote : undefined),
          avatarUrl: s.avatarUrl,
          trustScore: Math.round(s.trustRating * 20), // 0-100 scale for admin UI
          trustRating: s.trustRating,
          activeListingsCount: s._count.ownedItems,
          totalTransactionsCount: s._count.buyerTransactions + s._count.sellerTransactions,
          itemsShared: s.itemsCirculated || s._count.ownedItems,
          itemsBorrowed: s._count.buyerTransactions,
          strikes: s.strikes,
          co2SavedKg: s.co2SavedKg,
          moneySavedUsd: s.moneySavedUsd,
          itemsCirculated: s.itemsCirculated,
          joinedAt: s.createdAt.toISOString(),
          createdAt: s.createdAt.toISOString(),
        };
      });

      res.json(formatted);
    } catch (error) {
      console.error('Get students error:', error);
      res.status(500).json({ error: 'Failed to retrieve students' });
    }
  },

  async getStudentById(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      // Check college ownership
      if (req.user?.role === 'COLLEGE_ADMIN') {
        const isOwner = await verifyEntityCollegeOwnership('student', id, req.user);
        if (!isOwner) {
          res.status(403).json({ error: 'Forbidden: You cannot access students from other colleges' });
          return;
        }
      }

      const student = await prisma.user.findUnique({
        where: { id },
        include: {
          college: true,
          ownedItems: { take: 10, orderBy: { createdAt: 'desc' } },
          receivedRatings: { take: 10, orderBy: { createdAt: 'desc' }, include: { rater: { select: { name: true } } } },
          _count: {
            select: {
              ownedItems: true,
              buyerTransactions: true,
              sellerTransactions: true,
            },
          },
        },
      });

      if (!student) {
        res.status(404).json({ error: 'Student not found' });
        return;
      }

      const displayStatus = student.status === 'SUSPENDED'
        ? 'SUSPENDED'
        : (student.verificationStatus === 'VERIFIED' ? 'VERIFIED' : student.verificationStatus);

      res.json({
        id: student.id,
        fullName: student.name,
        name: student.name,
        email: student.email,
        collegeId: student.collegeId,
        collegeName: student.college?.name,
        department: student.department,
        academicYear: student.academicYear,
        graduationYear: student.academicYear ? parseInt(student.academicYear) || new Date().getFullYear() + 2 : new Date().getFullYear() + 2,
        rollNumber: student.rollNumber,
        status: displayStatus,
        verificationStatus: student.verificationStatus,
        verificationNote: student.verificationNote,
        idCardUrl: student.avatarUrl || (student.verificationNote?.startsWith('http') ? student.verificationNote : undefined),
        avatarUrl: student.avatarUrl,
        trustScore: Math.round(student.trustRating * 20),
        trustRating: student.trustRating,
        itemsShared: student.itemsCirculated || student._count.ownedItems,
        itemsBorrowed: student._count.buyerTransactions,
        totalTransactions: student._count.buyerTransactions + student._count.sellerTransactions,
        strikes: student.strikes,
        co2SavedKg: student.co2SavedKg,
        moneySavedUsd: student.moneySavedUsd,
        itemsCirculated: student.itemsCirculated,
        joinedAt: student.createdAt.toISOString(),
        recentListings: student.ownedItems,
        ratings: student.receivedRatings,
      });
    } catch (error) {
      console.error('Get student by id error:', error);
      res.status(500).json({ error: 'Failed to retrieve student details' });
    }
  },

  async updateVerificationStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { status, note } = req.body;

      if (!['VERIFIED', 'REJECTED', 'PENDING', 'ID_PENDING', 'UNVERIFIED'].includes(status)) {
        res.status(400).json({ error: 'Invalid verification status' });
        return;
      }

      if (req.user?.role === 'COLLEGE_ADMIN') {
        const isOwner = await verifyEntityCollegeOwnership('student', id, req.user);
        if (!isOwner) {
          res.status(403).json({ error: 'Forbidden: Cannot modify student from another college' });
          return;
        }
      }

      const updated = await prisma.user.update({
        where: { id },
        data: {
          verificationStatus: status,
          verificationNote: note || undefined,
          verifiedAt: status === 'VERIFIED' ? new Date() : undefined,
        },
      });

      if (req.user) {
        await recordAuditLog({
          admin: req.user,
          action: status === 'VERIFIED' ? 'STUDENT_VERIFIED' : 'STUDENT_VERIFICATION_REJECTED',
          entityType: 'User',
          entityId: id,
          metadata: { newStatus: status, note },
        });
      }

      res.json({
        id: updated.id,
        fullName: updated.name,
        verificationStatus: updated.verificationStatus,
        status: updated.status,
      });
    } catch (error) {
      console.error('Update verification status error:', error);
      res.status(500).json({ error: 'Failed to update verification status' });
    }
  },

  async updateAccountStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { status, note } = req.body;

      const validStatuses = ['ACTIVE', 'SUSPENDED', 'VERIFIED', 'REJECTED', 'PENDING', 'ID_PENDING', 'UNVERIFIED'];
      if (!validStatuses.includes(status)) {
        res.status(400).json({ error: 'Invalid account or verification status' });
        return;
      }

      if (req.user?.role === 'COLLEGE_ADMIN') {
        const isOwner = await verifyEntityCollegeOwnership('student', id, req.user);
        if (!isOwner) {
          res.status(403).json({ error: 'Forbidden: Cannot modify student from another college' });
          return;
        }
      }

      const updateData: any = {};
      if (['ACTIVE', 'SUSPENDED'].includes(status)) {
        updateData.status = status;
      } else {
        updateData.verificationStatus = status;
        if (status === 'VERIFIED') {
          updateData.status = 'ACTIVE';
          updateData.verifiedAt = new Date();
        }
        if (note) updateData.verificationNote = note;
      }

      const updated = await prisma.user.update({
        where: { id },
        data: updateData,
      });

      if (req.user) {
        await recordAuditLog({
          admin: req.user,
          action: status === 'ACTIVE' ? 'STUDENT_REACTIVATED' : 'STUDENT_SUSPENDED',
          entityType: 'User',
          entityId: id,
          metadata: { newStatus: status },
        });
      }

      res.json({
        id: updated.id,
        status: updated.status,
      });
    } catch (error) {
      console.error('Update account status error:', error);
      res.status(500).json({ error: 'Failed to update account status' });
    }
  },

  async addStrike(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      if (req.user?.role === 'COLLEGE_ADMIN') {
        const isOwner = await verifyEntityCollegeOwnership('student', id, req.user);
        if (!isOwner) {
          res.status(403).json({ error: 'Forbidden: Cannot modify student from another college' });
          return;
        }
      }

      const student = await prisma.user.findUnique({ where: { id } });
      if (!student) {
        res.status(404).json({ error: 'Student not found' });
        return;
      }

      const newStrikes = student.strikes + 1;
      const newStatus = newStrikes >= 3 ? 'SUSPENDED' : student.status;
      const newTrustRating = Math.max(1.0, student.trustRating - 1.0);

      const updated = await prisma.user.update({
        where: { id },
        data: {
          strikes: newStrikes,
          status: newStatus,
          trustRating: newTrustRating,
        },
      });

      if (req.user) {
        await recordAuditLog({
          admin: req.user,
          action: 'STUDENT_STRIKE_ADDED',
          entityType: 'User',
          entityId: id,
          metadata: { reason, totalStrikes: newStrikes, autoSuspended: newStrikes >= 3 },
        });
      }

      res.json({
        id: updated.id,
        strikes: updated.strikes,
        status: updated.status,
        trustScore: Math.round(updated.trustRating * 20),
      });
    } catch (error) {
      console.error('Add strike error:', error);
      res.status(500).json({ error: 'Failed to add strike' });
    }
  },
};
