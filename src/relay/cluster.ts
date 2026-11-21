import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import express, { type Express } from 'express';
import type { Socket } from 'socket.io';
import { z } from 'zod';
import { serviceLog } from '../server-kit/runtime.ts';
import { RelayJournal } from './journal.ts';

export type ClusterOptions = { nodeId: string; secret: string; url: () => string; members?: string[]; routes?: Record<string, string>; statePath?: string; intervalMs?: number };
const normalize = (url: string) => url.replace(/\/$/, '');
export class RelayCluster {
    readonly journal: RelayJournal;
    private seen = new Map<string, number>();
    private busy = false;
    private timer?: ReturnType<typeof setInterval>;
    private closed = false;
    private lifetime = new AbortController();
    constructor(private app: Express, private connections: Map<string, Socket>, private options: ClusterOptions, private deliver: () => Promise<void>) {
        this.journal = new RelayJournal(options.nodeId, options.statePath);
        app.post('/cluster/rpc', (req, res, next) => {
            if (!/^\d{13}$/.test(String(req.header('x-ds01-time'))) || !/^[a-f\d-]{36}$/.test(String(req.header('x-ds01-nonce'))) || !/^[a-f\d]{64}$/.test(String(req.header('x-ds01-mac')))) return res.sendStatus(403);
            next();
        }, express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
            try {
                const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '', time = String(req.header('x-ds01-time')), nonce = String(req.header('x-ds01-nonce'));
                if (Math.abs(Date.now() - Number(time)) > 30000 || this.seen.has(nonce) || !this.equal(this.mac(time, nonce, body), String(req.header('x-ds01-mac')))) return res.sendStatus(403);
                this.seen.set(nonce, Date.now());
                if (this.seen.size > 10000) this.seen.delete(this.seen.keys().next().value!);
                const result = JSON.stringify(await this.rpc(JSON.parse(body)));
                res.setHeader('x-ds01-mac', this.mac(time, nonce, result));
                res.type('json').send(result);
            } catch (error) { serviceLog('relay', 'CLUSTER_REJECT', error instanceof Error ? error.message : 'invalid cluster request', options.nodeId); res.status(400).json({ error: 'invalid cluster request' }); }
        });
        this.timer = setInterval(() => { void this.synchronize().catch(error => serviceLog('relay', 'CLUSTER_ERROR', String(error), options.nodeId)); }, options.intervalMs ?? 2000);
        this.timer.unref();
    }
    private mac(time: string, nonce: string, body: string) { return createHmac('sha256', this.options.secret).update(`${time}\n${nonce}\n${body}`).digest('hex'); }
    private equal(a: string, b: string) { return /^[a-f\d]{64}$/.test(b) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); }
    members() { return [...new Set([this.options.url(), ...(this.options.members || [])].map(normalize))].sort(); }
    async request(url: string, payload: unknown, publicProbe = false): Promise<Record<string, unknown>> {
        if (!this.members().includes(normalize(url))) throw Error('untrusted cluster member');
        const body = JSON.stringify(payload), time = String(Date.now()), nonce = randomUUID();
        const endpoint = !publicProbe && this.options.routes?.[normalize(url)] || url;
        const response = await fetch(`${normalize(endpoint)}/cluster/rpc`, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', 'x-ds01-time': time, 'x-ds01-nonce': nonce, 'x-ds01-mac': this.mac(time, nonce, body) }, body, signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(1500)]) });
        if (!response.ok) throw Error('cluster member unavailable');
        const bytes = await response.text();
        if (Buffer.byteLength(bytes) > 1048576 || !this.equal(this.mac(time, nonce, bytes), String(response.headers.get('x-ds01-mac')))) throw Error('invalid cluster response');
        return JSON.parse(bytes);
    }
    private async rpc(input: unknown): Promise<Record<string, unknown>> {
        const request = z.object({ action: z.literal('state'), after: z.string().max(200).optional() }).strict().parse(input);
        return this.journal.page(request.after);
    }
    async synchronize() {
        if (this.busy || this.closed) return;
        this.busy = true;
        try {
            await Promise.allSettled(this.members().filter(url => normalize(url) !== normalize(this.options.url())).map(async url => {
                let after: string | null = '';
                for (let page = 0; page < 40 && after !== null; page++) {
                    const result = await this.request(url, { action: 'state', after });
                    if (!Array.isArray(result.entries)) throw Error('invalid replica state');
                    if (this.journal.merge(result.entries)) serviceLog('relay', 'REPLICA_MERGE', `${url} records=${result.entries.length}`, this.options.nodeId);
                    after = typeof result.after === 'string' ? result.after : null;
                }
            }));
            if (this.closed) return;
            this.journal.prune();
            for (const [nonce, time] of this.seen) if (Date.now() - time > 30000) this.seen.delete(nonce);
            await this.deliver();
        } finally { this.busy = false; }
    }
    close() { this.closed = true; this.lifetime.abort(); clearInterval(this.timer); }
}
