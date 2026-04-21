require('dotenv').config();
const express = require('express');
const winston = require('winston');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());


const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'logger-service' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

app.post('/api/log', (req, res) => {
  const { level, message, service, meta } = req.body;

  if (!level || !message) {
    return res.status(400).json({ error: 'Level and message are required' });
  }

  // Ghi lại log thông qua winston
  logger.log({
    level: level.toLowerCase(),
    message,
    defaultMeta: { service: service || 'unknown-service' },
    ...meta
  });

  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`[Logger] Service is running on port ${PORT}`);
});
