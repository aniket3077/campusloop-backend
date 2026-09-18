import { Router } from 'express';
import { impactController } from '../controllers/impactController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

router.use(authenticateToken);

router.get('/', impactController.getImpact);
router.get('/summary', impactController.getImpactSummary);
router.get('/departments', impactController.getImpactByDepartment);
router.get('/user', impactController.getUserImpact);

export default router;
