import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { sessionRouter } from './routes/sessions';
import { questionRouter } from './routes/questions';
import { answerRouter } from './routes/answers';

const app = express();
const PORT = process.env.PORT ?? 8080;

app.use(cors({ origin: '*' }));
app.use(express.json());

app.use('/api/sessions', sessionRouter);
app.use('/api/sessions', questionRouter);
app.use('/api/sessions', answerRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
});
