import 'dotenv/config';
import { createServer } from 'http';
import { Socket } from 'net';
import express from 'express';
import cors from 'cors';
import { sessionRouter } from './routes/sessions';
import { questionRouter } from './routes/questions';
import { answerRouter } from './routes/answers';
import { handleSimulationUpgrade } from './ws/simulation';

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

const server = createServer(app);

server.on('upgrade', (req, socket) => {
  const netSocket = socket as Socket;
  handleSimulationUpgrade(req, netSocket).then((handled) => {
    if (!handled) {
      netSocket.destroy();
    }
  }).catch((err) => {
    console.error('[server] websocket upgrade error:', err);
    netSocket.destroy();
  });
});

server.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
});
