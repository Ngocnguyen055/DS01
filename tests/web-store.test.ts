import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { WebStore } from '../src/web-peer/store.ts';
import type { ChatMessage } from '../src/shared/protocol.ts';

let values: Map<string, string>;
beforeEach(() => {
    values = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
    });
});
afterEach(() => vi.unstubAllGlobals());
function message(receiverId = 'user_bob'): ChatMessage {
    return { messageId: randomUUID(), sessionId: randomUUID(), senderId: 'user_alice', receiverId,
        timestamp: Date.now(), logicalTime: 1, sequence: 1, body: 'account-scoped history', type: 'text', mode: 'RELAY', attempt: 1 };
}

describe('B6 local history and recipient receipts', () => {
    it('restores history, delivery receipts, contacts and block settings in a new store instance', async () => {
        const store = new WebStore('user_alice'), packet = message();
        await store.put({ message: packet, status: 'pending' });
        await store.mark(packet.messageId, packet.receiverId, 'delivered');
        await store.saveDirectContact({ peerId: 'user_bob', name: 'Bob', email: '', updatedAt: Date.now() });
        await store.setDirectBlocked('user_bob', true);
        const reloaded = new WebStore('user_alice');
        expect(await reloaded.list()).toEqual([{ message: packet, status: 'delivered' }]);
        expect(await reloaded.listDirectContacts()).toMatchObject([{ peerId: 'user_bob', name: 'Bob' }]);
        expect(await reloaded.isDirectBlocked('user_bob')).toBe(true);
    });

    it('separates two accounts and keeps the original history when switching back', async () => {
        const alice = new WebStore('user_alice'), carol = new WebStore('user_carol');
        const packet = message();
        await alice.put({ message: packet, status: 'sent' });
        await alice.saveDirectContact({ peerId: 'user_bob', name: 'Bob', email: '', updatedAt: Date.now() });
        expect(await carol.list()).toEqual([]);
        expect(await carol.listDirectContacts()).toEqual([]);
        await carol.put({ message: { ...message('user_carol'), senderId: 'user_bob' }, status: 'received' });
        expect(await new WebStore('user_alice').list()).toEqual([{ message: packet, status: 'sent' }]);
        expect(await carol.list()).toHaveLength(1);
    });

    it('updates the receipt for only one recipient and restores dedup keys after reload', async () => {
        const store = new WebStore('user_alice'), first = { ...message(), groupId: randomUUID() };
        const second = { ...first, receiverId: 'user_carol' };
        await Promise.all([store.put({ message: first, status: 'sent' }), store.put({ message: second, status: 'failed' })]);
        await store.mark(first.messageId, 'user_bob', 'delivered');
        const rows = await new WebStore('user_alice').list();
        expect(rows.map(row => [row.message.receiverId, row.status])).toEqual([['user_bob', 'delivered'], ['user_carol', 'failed']]);
        const bob = new WebStore('user_bob');
        await bob.put({ message: first, status: 'received' });
        expect(await new WebStore('user_bob').has(first.messageId, first.senderId)).toBe(true);
    });

    it.each([null, { message: { sequence: 1, messageId: randomUUID() }, status: 'received' },
        { message: message(), status: 'unknown' }])('reports malformed history without overwriting it: %#', async bad => {
        const key = 'ds01-history-v1-user_alice', raw = JSON.stringify([{ message: message(), status: 'sent' }, bad]);
        values.set(key, raw);
        const store = new WebStore('user_alice');
        await expect(store.list()).rejects.toThrow('Lịch sử cục bộ bị hỏng');
        await expect(store.put({ message: message(), status: 'sent' })).rejects.toThrow('Lịch sử cục bộ bị hỏng');
        expect(values.get(key)).toBe(raw);
    });
});
