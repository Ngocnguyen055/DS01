import 'dotenv/config';
import { io } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
if (args.includes('--help')) {
    console.log('node scripts/load-relay.mjs [--peers 20] [--messages 10] [--concurrency 8] [--signal URL] [--relay URL]');
    process.exit(0);
}
const count = Number(option('--peers', 20)), perPeer = Number(option('--messages', 10)), concurrency = Number(option('--concurrency', 8));
if (!Number.isInteger(count) || count < 3 || count > 100 || !Number.isInteger(perPeer) || perPeer < 1 || perPeer > 100 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 50)
    throw Error('Limits: peers 3..100, messages 1..100, concurrency 1..50');
const signalUrl = option('--signal', process.env.PUBLIC_SIGNAL_URL || 'http://localhost:4001'), relayUrl = option('--relay', process.env.PUBLIC_RELAY_URL || 'http://localhost:4002');
const sockets = [], heartbeats = [], pending = new Map(), peers = [], latencies = [];
let failures = 0, duplicateDeliveries = 0, wireBytes = 0;
const seen = new Set(), suffix = randomUUID().slice(0, 7);
async function connect(url, auth) { const socket = io(url, { autoConnect: false, transports: ['websocket'], reconnection: false, auth }); sockets.push(socket); await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('connect timeout')), 5000); socket.once('connect', () => { clearTimeout(timer); resolve(); }); socket.once('connect_error', error => { clearTimeout(timer); reject(error); }); socket.connect(); }); return socket; }
const deadline = setTimeout(() => { console.error('load experiment deadline exceeded'); for (const socket of sockets)
    socket.disconnect(); process.exit(2); }, 120000);
try {
    for (let index = 0; index < count; index++) {
        const id = `load-${suffix}-${index}`, signal = await connect(signalUrl);
        const registration = await signal.timeout(4000).emitWithAck('peer:register', { peerId: id, identityProof: randomUUID() + randomUUID(), displayName: `Load peer ${index}` });
        if (!registration.ok)
            throw Error(registration.error);
        heartbeats.push(setInterval(() => signal.emit('peer:heartbeat'), 10000));
        const relay = await connect(relayUrl, { token: registration.token });
        relay.on('relay:receive', message => { if (seen.has(message.messageId))
            duplicateDeliveries++; seen.add(message.messageId); pending.get(message.messageId)?.(message.receiverId); });
        peers.push({ id, relay });
    }
    const total = count * perPeer;
    let next = 0;
    const started = performance.now();
    async function worker() {
        while (next < total) {
            const index = next++, sender = peers[index % count], receiver = peers[(index % count + 1) % count];
            const message = { messageId: randomUUID(), sessionId: randomUUID(), senderId: sender.id, receiverId: receiver.id, type: 'text', timestamp: Date.now(), body: `Load experiment ${index}`, mode: 'RELAY', attempt: 1, sequence: Math.floor(index / count) + 1 };
            wireBytes += Buffer.byteLength(JSON.stringify(message));
            const sentAt = performance.now();
            let timer;
            const received = new Promise((resolve, reject) => { timer = setTimeout(() => reject(Error('delivery timeout')), 5000); pending.set(message.messageId, id => id === receiver.id ? resolve() : reject(Error('wrong receiver'))); });
            void received.catch(() => { });
            try {
                const result = await sender.relay.timeout(4000).emitWithAck('relay:send', message);
                if (!result.ok)
                    throw Error(result.error);
                await received;
                latencies.push(performance.now() - sentAt);
            }
            catch {
                failures++;
            }
            finally {
                clearTimeout(timer);
                pending.delete(message.messageId);
            }
        }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    const elapsed = performance.now() - started;
    latencies.sort((a, b) => a - b);
    const percentile = p => latencies.length ? latencies[Math.max(0, Math.ceil(latencies.length * p) - 1)] : null;
    console.log(JSON.stringify({ scope: 'Concurrent application relay envelopes to headless Socket.IO receivers; not WebRTC or browser persistence/app ACK', peers: count, requested: total, concurrency, delivered: latencies.length, failed: failures, duplicateDeliveries, successRate: latencies.length / total, elapsedMs: elapsed, throughputMessagesPerSecond: latencies.length / (elapsed / 1000), p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs: latencies.at(-1) || null, serializedEnvelopeBytes: wireBytes, relayApproxPayloadBytes: wireBytes * 2, measuredAt: new Date().toISOString(), node: process.version, signalHost: new URL(signalUrl).host, relayHost: new URL(relayUrl).host }, null, 2));
    if (failures || duplicateDeliveries)
        process.exitCode = 1;
}
finally {
    clearTimeout(deadline);
    heartbeats.forEach(clearInterval);
    sockets.forEach(socket => socket.disconnect());
}
