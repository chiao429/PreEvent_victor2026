import { createHash } from 'crypto';
import { IncomingMessage } from 'http';
import { Socket } from 'net';
import { db } from '../lib/firebaseAdmin';

type ClientRole = 'host' | 'display';

type SimulationOverlay = {
  questionId: string;
  optionCounts: Record<string, number>;
  recentTexts: string[];
  totalResponses: number;
};

type Room = {
  clients: Set<SimulationClient>;
  overlays: Map<string, SimulationOverlay>;
};

type SimulationClient = {
  socket: Socket;
  sessionId: string;
  role: ClientRole;
  buffer: Buffer;
};

type SeedCommand = {
  type: 'seed_answers';
  questionId: string;
  questionType: 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'TEXT';
  textAnswers?: string[];
  optionCounts?: Record<string, number>;
};

type LoadTestCommand = {
  type: 'load_test_answers';
  questionId: string;
  questionType: 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'TEXT';
  options?: { id: string; label: string }[];
};

type SimulationCommand = SeedCommand | LoadTestCommand;

const LOAD_TEST_ANSWER_COUNT = 500;
const MAX_RECENT_TEXTS = 200;
const rooms = new Map<string, Room>();

function getRoom(sessionId: string): Room {
  const existing = rooms.get(sessionId);
  if (existing) return existing;
  const room = { clients: new Set<SimulationClient>(), overlays: new Map<string, SimulationOverlay>() };
  rooms.set(sessionId, room);
  return room;
}

function writeFrame(socket: Socket, payload: unknown) {
  const json = Buffer.from(JSON.stringify(payload));
  const length = json.length;
  let header: Buffer;

  if (length < 126) {
    header = Buffer.from([0x81, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  socket.write(Buffer.concat([header, json]));
}

function closeSocket(socket: Socket, code = 1000) {
  const header = Buffer.from([0x88, 0x02]);
  const body = Buffer.alloc(2);
  body.writeUInt16BE(code, 0);
  socket.end(Buffer.concat([header, body]));
}

function parseFrames(client: SimulationClient, onMessage: (message: string) => void) {
  while (client.buffer.length >= 2) {
    const first = client.buffer[0];
    const second = client.buffer[1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let payloadLength = second & 0x7f;
    let offset = 2;

    if (payloadLength === 126) {
      if (client.buffer.length < offset + 2) return;
      payloadLength = client.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLength === 127) {
      if (client.buffer.length < offset + 8) return;
      const longLength = client.buffer.readBigUInt64BE(offset);
      if (longLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        closeSocket(client.socket, 1009);
        return;
      }
      payloadLength = Number(longLength);
      offset += 8;
    }

    const maskLength = masked ? 4 : 0;
    if (client.buffer.length < offset + maskLength + payloadLength) return;

    const mask = masked ? client.buffer.subarray(offset, offset + 4) : null;
    offset += maskLength;
    const payload = Buffer.from(client.buffer.subarray(offset, offset + payloadLength));
    client.buffer = client.buffer.subarray(offset + payloadLength);

    if (opcode === 0x8) {
      closeSocket(client.socket);
      return;
    }
    if (opcode !== 0x1) continue;

    if (mask) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }

    onMessage(payload.toString('utf8'));
  }
}

function mergeOverlay(room: Room, delta: SimulationOverlay): SimulationOverlay {
  const current = room.overlays.get(delta.questionId) ?? {
    questionId: delta.questionId,
    optionCounts: {},
    recentTexts: [],
    totalResponses: 0,
  };
  const optionCounts = { ...current.optionCounts };
  Object.entries(delta.optionCounts).forEach(([optionId, count]) => {
    optionCounts[optionId] = (optionCounts[optionId] ?? 0) + count;
  });

  const next = {
    questionId: delta.questionId,
    optionCounts,
    recentTexts: [...current.recentTexts, ...delta.recentTexts].slice(-MAX_RECENT_TEXTS),
    totalResponses: current.totalResponses + delta.totalResponses,
  };
  room.overlays.set(delta.questionId, next);
  return next;
}

function broadcastOverlay(sessionId: string, overlay: SimulationOverlay) {
  const room = getRoom(sessionId);
  const message = { type: 'simulation_overlay', ...overlay };
  room.clients.forEach((client) => {
    if (client.role === 'display') {
      writeFrame(client.socket, message);
    }
  });
}

function optionCountTotal(optionCounts: Record<string, number>) {
  return Object.values(optionCounts).reduce((sum, count) => sum + Math.max(0, count), 0);
}

function buildSeedOverlay(command: SeedCommand): SimulationOverlay {
  if (command.questionType === 'TEXT') {
    const recentTexts = (command.textAnswers ?? []).filter(Boolean);
    return {
      questionId: command.questionId,
      optionCounts: {},
      recentTexts,
      totalResponses: recentTexts.length,
    };
  }

  const optionCounts = command.optionCounts ?? {};
  return {
    questionId: command.questionId,
    optionCounts,
    recentTexts: [],
    totalResponses: optionCountTotal(optionCounts),
  };
}

function buildLoadTestOverlay(command: LoadTestCommand): SimulationOverlay {
  if (command.questionType === 'TEXT') {
    const recentTexts = Array.from(
      { length: LOAD_TEST_ANSWER_COUNT },
      (_, index) => `壓測回答 ${index + 1}`,
    );
    return {
      questionId: command.questionId,
      optionCounts: {},
      recentTexts,
      totalResponses: LOAD_TEST_ANSWER_COUNT,
    };
  }

  const options = command.options ?? [];
  const optionCounts: Record<string, number> = {};
  if (options.length === 0) {
    return { questionId: command.questionId, optionCounts, recentTexts: [], totalResponses: 0 };
  }

  for (let index = 0; index < LOAD_TEST_ANSWER_COUNT; index += 1) {
    if (command.questionType === 'SINGLE_CHOICE') {
      const option = options[index % options.length];
      optionCounts[option.id] = (optionCounts[option.id] ?? 0) + 1;
      continue;
    }

    const selectedCount = Math.min(options.length, 1 + (index % 3));
    for (let offset = 0; offset < selectedCount; offset += 1) {
      const option = options[(index + offset) % options.length];
      optionCounts[option.id] = (optionCounts[option.id] ?? 0) + 1;
    }
  }

  return {
    questionId: command.questionId,
    optionCounts,
    recentTexts: [],
    totalResponses: LOAD_TEST_ANSWER_COUNT,
  };
}

function handleHostMessage(client: SimulationClient, raw: string) {
  let command: SimulationCommand;
  try {
    command = JSON.parse(raw) as SimulationCommand;
  } catch {
    writeFrame(client.socket, { type: 'error', error: 'Invalid JSON' });
    return;
  }

  if (!command.questionId || !command.questionType) {
    writeFrame(client.socket, { type: 'error', error: 'Invalid simulation command' });
    return;
  }

  const room = getRoom(client.sessionId);
  const delta = command.type === 'load_test_answers'
    ? buildLoadTestOverlay(command)
    : command.type === 'seed_answers'
      ? buildSeedOverlay(command)
      : null;

  if (!delta) {
    writeFrame(client.socket, { type: 'error', error: 'Unsupported simulation command' });
    return;
  }

  const overlay = mergeOverlay(room, delta);
  broadcastOverlay(client.sessionId, overlay);
  writeFrame(client.socket, {
    type: 'ack',
    command: command.type,
    inserted: delta.totalResponses,
  });
}

async function verifyHostToken(sessionId: string, token: string | null): Promise<boolean> {
  if (!token) return false;
  const sessionDoc = await db.collection('sessions').doc(sessionId).get();
  return sessionDoc.exists && sessionDoc.data()?.hostToken === token;
}

function acceptWebSocket(req: IncomingMessage, socket: Socket) {
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string') {
    socket.destroy();
    return false;
  }

  const accept = createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');

  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '',
    '',
  ].join('\r\n'));
  return true;
}

export async function handleSimulationUpgrade(req: IncomingMessage, socket: Socket): Promise<boolean> {
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.url ?? '/', `http://${host}`);
  const match = url.pathname.match(/^\/api\/ws\/sessions\/([^/]+)\/simulation$/);
  if (!match) return false;

  const sessionId = decodeURIComponent(match[1]);
  const role = url.searchParams.get('role') as ClientRole | null;
  if (role !== 'host' && role !== 'display') {
    socket.destroy();
    return true;
  }

  if (role === 'host') {
    try {
      const ok = await verifyHostToken(sessionId, url.searchParams.get('token'));
      if (!ok) {
        socket.destroy();
        return true;
      }
    } catch (err) {
      console.error('[simulation-ws] auth error:', err);
      socket.destroy();
      return true;
    }
  }

  if (!acceptWebSocket(req, socket)) return true;

  const client: SimulationClient = { socket, sessionId, role, buffer: Buffer.alloc(0) };
  const room = getRoom(sessionId);
  room.clients.add(client);

  if (role === 'display') {
    room.overlays.forEach((overlay) => {
      writeFrame(socket, { type: 'simulation_overlay', ...overlay });
    });
  }

  socket.on('data', (chunk) => {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    parseFrames(client, (message) => {
      if (client.role === 'host') {
        handleHostMessage(client, message);
      }
    });
  });

  socket.on('close', () => {
    room.clients.delete(client);
    if (room.clients.size === 0 && room.overlays.size === 0) {
      rooms.delete(sessionId);
    }
  });

  socket.on('error', () => {
    room.clients.delete(client);
  });

  return true;
}
