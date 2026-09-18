import { Router } from 'express';
import multer from 'multer';
import { uploadController } from '../controllers/uploadController.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max limit
  },
});

const uploadFields = upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'file', maxCount: 1 },
]);

// Upload image route: supports both multipart form-data (field: "image" or "file") and JSON with base64
router.post(
  '/',
  (req, res, next) => {
    uploadFields(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      if (req.files) {
        const files = req.files as { [fieldname: string]: Express.Multer.File[] };
        req.file = files.image?.[0] || files.file?.[0];
      }
      next();
    });
  },
  uploadController.uploadImage
);

export default router;
