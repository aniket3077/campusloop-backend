import { Router } from 'express';
import { conversationController } from '../controllers/conversationController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

router.use(authenticateToken);

router.get('/', conversationController.getConversations);
router.post('/', conversationController.createOrGetConversation);
router.get('/:id/messages', conversationController.getMessages);
router.post('/:id/messages', conversationController.sendMessage);
router.patch('/:id/read', conversationController.markAsRead);
router.post('/:id/read', conversationController.markAsRead);
router.post('/:id/typing', conversationController.setTyping);
router.get('/:id/stream', conversationController.streamConversation);

export default router;
