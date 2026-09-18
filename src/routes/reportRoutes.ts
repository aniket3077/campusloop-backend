import { Router } from 'express';
import { reportController } from '../controllers/reportController.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';

const router = Router();

router.use(authenticateToken);

// Students can file reports
router.post('/', reportController.createReport);

// Admins can list and update reports
router.get('/', requireRole(['SUPER_ADMIN', 'COLLEGE_ADMIN']), reportController.getReports);
router.patch('/:id/status', requireRole(['SUPER_ADMIN', 'COLLEGE_ADMIN']), reportController.updateReportStatus);
router.patch('/:id/resolve', requireRole(['SUPER_ADMIN', 'COLLEGE_ADMIN']), reportController.updateReportStatus);

export default router;
