import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID, createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { type Socket } from 'socket.io-client';
import { PeerClient, type ChatStore, type StoredMessage, type ChatMessage, type PeerConfig, type ChatAttachment, type PeerEvent } from '../src/shared/index.ts';
import { type IdentityStore, type DeviceIdentity, type PublicIdentity } from '../src/shared/secure.ts';
import { RelayJournal } from '../src/relay/journal.ts';
import { createSignaling } from '../src/signaling/index.ts';
import { createRelay } from '../src/relay/index.ts';
import { MessageDelivery } from '../src/shared/messageDelivery.ts';

class Store implements ChatStore, IdentityStore {
    rows: StoredMessage[] = [];
    identity?: DeviceIdentity;
    pins = new Map<string, PublicIdentity>();
    files = new Map<string, { file: ChatAttachment; data: Uint8Array }>();
    async put(row: StoredMessage) { const i = this.rows.findIndex(x => x.message.messageId === row.message.messageId && x.message.receiverId === row.message.receiverId && x.message.senderId === row.message.senderId); if (i < 0) this.rows.push(row); else this.rows[i] = row; }
    async mark(id: string, receiver: string, status: StoredMessage['status']) { for (const row of this.rows) if (row.message.messageId === id && row.message.receiverId === receiver) row.status = status; }
    async has(id: string, sender: string) { return this.rows.some(x => x.message.messageId === id && x.message.senderId === sender); }
    async list() { return this.rows; }
    async getIdentity() { return this.identity; }
    async putIdentity(value: DeviceIdentity) { this.identity = value; }
    async getPin(id: string) { return this.pins.get(id); }
    async putPin(id: string, value: PublicIdentity) { this.pins.set(id, value); }
    async putFile(file: ChatAttachment, data: Uint8Array) { this.files.set(file.id, { file, data: new Uint8Array(data) }); }
    async getFile(id: string) { return this.files.get(id); }
}
const peers: PeerClient[] = [], services: { close: () => Promise<void> }[] = [], sockets: Socket[] = [], folders: string[] = [];
async function start<T extends { httpServer: ReturnType<typeof createServer>; close: () => Promise<void> }>(service: T) { services.push(service); await new Promise<void>(r => service.httpServer.listen(0, '127.0.0.1', r)); return `http://127.0.0.1:${(service.httpServer.address() as AddressInfo).port}`; }
async function stop(service: { close: () => Promise<void> }) { await service.close(); services.splice(services.indexOf(service), 1); }
async function wait(check: () => boolean, ms = 6000) { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw Error('advanced condition timeout'); await new Promise(r => setTimeout(r, 20)); } }
function folder() { const path = mkdtempSync(join(tmpdir(), 'ds01-advanced-')); folders.push(path); return path; }
function message(): ChatMessage { return { messageId: randomUUID(), sessionId: randomUUID(), senderId: 'peer-a', receiverId: 'peer-b', type: 'text', body: 'private nội dung 123', timestamp: Date.now(), sequence: 1, mode: 'RELAY', attempt: 1 }; }
function makePeer(id: string, store: Store, signalUrl: string, relayUrl: string, options: Partial<PeerConfig> = {}) {
    const events: PeerEvent[] = [];
    const peer = new PeerClient({ peerId: id, identityProof: 'advanced-proof-' + id, signalUrl, relayUrl, rtc: class {} as unknown as PeerConfig['rtc'], forceRelay: true, encryption: true, identityStore: store, store, ackTimeoutMs: 500, requestTimeoutMs: 1500, onEvent: e => events.push(e), ...options });
    peers.push(peer); return { peer, events };
}
afterEach(async () => {
    peers.splice(0).forEach(p => p.close()); sockets.splice(0).forEach(s => s.disconnect());
    for (const service of services.splice(0).reverse()) await service.close();
    for (const path of folders.splice(0)) { const checked = resolve(path); if (dirname(checked) !== resolve(tmpdir()) || !basename(checked).startsWith('ds01-advanced-')) throw Error('invalid cleanup path'); rmSync(checked, { recursive: true, force: true }); }
});

describe('advanced encryption and replica consistency', () => {
    it('reports an expired offline mailbox as unconfirmed and still accepts a later valid receiver ACK', async () => {
        const store = new Store(), logs: string[] = [];
        const delivery = new MessageDelivery({ peerId: 'peer-a', store, getGroup: () => undefined, syncProjectGroup: async () => { throw Error('unused'); }, authorizeGroup: async () => { throw Error('unused'); }, selectMode: async () => 'RELAY', transport: async () => ({ queued: true, expiresAt: Date.now() + 40 }), emit: () => {}, log: value => logs.push(value) });
        try {
            await delivery.sendDirect('peer-b', 'bounded offline mail'); expect(store.rows[0].status).toBe('queued');
            await wait(() => store.rows[0].status === 'failed'); expect(logs.some(x => x.includes('DELIVERY_ERROR'))).toBe(true);
            const original = store.rows[0].message;
            await delivery.receive({ ...original, messageId: randomUUID(), senderId: 'peer-b', receiverId: 'peer-a', type: 'ack', body: '', ackFor: original.messageId, ackRequested: false }, 'RELAY');
            expect(store.rows[0].status).toBe('delivered');
        } finally { delivery.close(); }
    });
    it('converges concurrent queue writes and deletion regardless of replica merge order', () => {
        const a = new RelayJournal('node-a'), b = new RelayJournal('node-b'), c = new RelayJournal('node-c'), packet = message();
        a.enqueue(packet); b.enqueue({ ...packet, attempt: 2 });
        b.acknowledge(packet.senderId, packet.messageId, packet.receiverId);
        c.merge([...b.entries.values()]); c.merge([...a.entries.values()]);
        a.merge([...b.entries.values()]); b.merge([...a.entries.values()]);
        expect([a, b, c].map(x => x.pending().length)).toEqual([0, 0, 0]);
        expect([...a.entries.values()]).toEqual([...b.entries.values()]);
    });
    it('persists mailbox state, rejects conflicting IDs and enforces capacity and TTL', () => {
        const path = join(folder(), 'relay.json'), journal = new RelayJournal('node-a', path, 1), packet = message();
        journal.enqueue(packet, 1000);
        expect(new RelayJournal('node-a', path).pending()).toHaveLength(1);
        expect(() => journal.enqueue({ ...packet, body: 'changed' })).toThrow('conflicting');
        expect(() => journal.enqueue(message())).toThrow('mailbox full');
        const expired = new RelayJournal('expiry'); expired.enqueue(packet, -1); expired.prune(); expect(expired.pending()).toHaveLength(0);
    });
});

describe('advanced features over real HTTP and Socket.IO', () => {
    it('replicates encrypted offline mail and ACKs across relay failure and sender restart', async () => {
        const path = folder(), signal = createSignaling(), signalUrl = await start(signal);
        const relayA = createRelay(undefined, undefined, undefined, { statePath: join(path, 'a.json'), offlineQueue: true, clusterIntervalMs: 60000 });
        const urlA = await start(relayA);
        const relayB = createRelay(undefined, undefined, undefined, { statePath: join(path, 'b.json'), offlineQueue: true, clusterUrls: [urlA], clusterIntervalMs: 60000 }), urlB = await start(relayB);
        const a = new Store(), b = new Store();
        const alice = makePeer('peer-a', a, signalUrl, urlA), bob = makePeer('peer-b', b, signalUrl, urlA);
        await alice.peer.connect(); await bob.peer.connect(); await wait(() => relayA.connections.size === 2);
        bob.peer.close(); await wait(() => !relayA.connections.has('peer-b'));
        await alice.peer.send('peer-b', 'offline-secret'); expect(a.rows[0].status).toBe('queued');
        alice.peer.close(); await relayB.cluster.synchronize(); expect(relayB.cluster.journal.pending()).toHaveLength(1);
        expect(readFileSync(join(path, 'b.json'), 'utf8')).not.toContain('offline-secret');
        await stop(relayA);
        const bobRestored = makePeer('peer-b', b, signalUrl, urlB); await bobRestored.peer.connect();
        await wait(() => b.rows.some(x => x.message.body === 'offline-secret' && x.status === 'received'));
        await wait(() => relayB.cluster.journal.pending().some(x => (x.value as {traffic:string}).traffic === 'ack'));
        const aliceRestored = makePeer('peer-a', a, signalUrl, urlB); await aliceRestored.peer.connect();
        await wait(() => a.rows[0].status === 'delivered');
        expect(b.rows.filter(x => x.message.body === 'offline-secret')).toHaveLength(1);
        await wait(() => relayB.cluster.journal.pending().length === 0);
    }, 15000);
    it('requires cluster authentication and rejects replay and arbitrary member URLs', async () => {
        const relay = createRelay(), url = await start(relay);
        expect((await fetch(url + '/cluster/rpc', { method: 'POST', headers: {'content-type':'application/json'}, body: '{}' })).status).toBe(403);
        const body = JSON.stringify({ action: 'state' }), time = String(Date.now()), nonce = randomUUID();
        const mac = createHmac('sha256', process.env.PEER_SECRET!).update(`${time}\n${nonce}\n${body}`).digest('hex');
        const options = { method: 'POST', headers: { 'content-type':'application/json', 'x-ds01-time':time, 'x-ds01-nonce':nonce, 'x-ds01-mac':mac }, body };
        expect((await fetch(url + '/cluster/rpc', options)).status).toBe(200);
        expect((await fetch(url + '/cluster/rpc', options)).status).toBe(403);
        await expect(relay.cluster.request('http://127.0.0.1:1', { action: 'state' })).rejects.toThrow('untrusted');
    });
});
