import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';
import logger from './logger.js';

dotenv.config();

// PostgreSQL connection
const sequelize = new Sequelize(
  process.env.DB_NAME || 'zentag_video',
  process.env.DB_USER || 'postgres',
  process.env.DB_PASSWORD || 'password',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: (msg) => logger.debug(msg),
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    define: {
      timestamps: true,
      underscored: true,
      freezeTableName: true,
    },
  }
);

// Test connection
export const connectDB = async () => {
  try {
    await sequelize.authenticate();
    logger.info('✅ PostgreSQL Database connected successfully');
    
    // Sync models (only in development)
    if (process.env.NODE_ENV === 'development') {
      await sequelize.sync({ alter: true });
      logger.info('📊 Database models synchronized');
    }
  } catch (error) {
    logger.error('❌ Unable to connect to database:', error);
    throw error;
  }
};

export { sequelize };
