import dotenv from 'dotenv';
dotenv.config();

export const ENV = {
  PORT: parseInt(process.env.PORT || '5000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/campusloop_db?schema=public',
  JWT_SECRET: process.env.JWT_SECRET || 'campusloop_jwt_secret_dev_key_2026_super_secure_academic',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  GCP_API_KEY: process.env.GCP_API_KEY || '',
  GCP_PROJECT_ID: process.env.GCP_PROJECT_ID || 'garbage-fa1b3',
  CLOUD_RUN_URL: process.env.CLOUD_RUN_URL || 'https://campusloop-backend-1035058975798.europe-west1.run.app',
};
