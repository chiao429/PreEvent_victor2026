import { Request, Response, NextFunction } from 'express';
import { db } from '../lib/firebaseAdmin';

export async function requireHostToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  const sessionId = req.params.id;

  try {
    const sessionDoc = await db.collection('sessions').doc(sessionId).get();
    if (!sessionDoc.exists) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const data = sessionDoc.data();
    if (data?.hostToken !== token) {
      res.status(403).json({ error: 'Invalid host token' });
      return;
    }

    next();
  } catch (err) {
    console.error('[auth] error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
