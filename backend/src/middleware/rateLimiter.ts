import rateLimit from 'express-rate-limit';

export const answerRateLimiter = rateLimit({
  windowMs: 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
