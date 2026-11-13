import { randomUUID } from "./uuid.ts";
import { parseMessage, peerIdSchema, type ChatAttachment, type ChatMessage, type DeliveryMode, type Group, type FileChunk, } from "./protocol.ts";
import type { ChatStore, PeerEvent } from "./peerTypes.ts";
type PendingAck = {
    resolve: () => void;
    reject: (error: Error) => void;
    sessionId: string;
    timer?: ReturnType<typeof setTimeout>;
};
type MessageDeliveryConfig = {
    peerId: string;
    store: ChatStore;
    ackTimeoutMs?: number;
    getGroup: (groupId: string) => Group | undefined;
    syncProjectGroup: (projectId: string) => Promise<Group>;
    authorizeGroup: (groupId: string, otherPeerId: string) => Promise<Group>;
    selectMode: (receiverId: string) => Promise<DeliveryMode>;
    transport: (message: ChatMessage, mode: DeliveryMode) => Promise<void>;
    emit: (event: PeerEvent) => void;
    log: (text: string) => void;
    onFileChunk?: (message: ChatMessage) => Promise<void>;
};
/** Implements message identity, ordering, ACK/retry, deduplication and fan-out. */
export class MessageDelivery {
    private pending = new Map<string, PendingAck>();
    private sequence = new Map<string, number>();
    private sessionIds = new Map<string, string>();
    private initialized?: Promise<void>;
    private clock = 0;
    private closed = false;
    private incoming = Promise.resolve();
    private cancel!: (error: Error) => void;
    private cancelled!: Promise<never>;
    constructor(private config: MessageDeliveryConfig) { this.open(); }
    private open() {
        this.closed = false;
        this.cancelled = new Promise<never>((_resolve, reject) => { this.cancel = reject; });
        void this.cancelled.catch(() => { });
    }
    private wait<T>(operation: Promise<T>): Promise<T> { return Promise.race([operation, this.cancelled]); }
    private assertOpen() {
        if (this.closed)
            throw new Error('peer disconnected');
    }
    async recover() {
        this.initialized ??= (async () => {
            for (const row of await this.config.store.list()) {
                const m = row.message;
                this.clock = Math.max(this.clock, m.logicalTime ?? m.timestamp);
                if (m.senderId !== this.config.peerId)
                    continue;
                const key = m.groupId || [m.senderId, m.receiverId].sort().join(':');
                this.sequence.set(key, Math.max(this.sequence.get(key) || 0, m.sequence));
                if (!m.groupId)
                    this.sessionIds.set(key, m.sessionId);
                if (row.status === 'pending' || row.status === 'sent') {
                    await this.config.store.mark(m.messageId, m.receiverId, 'failed');
                    this.config.emit({ kind: 'message', message: { message: m, status: 'failed' } });
                }
            }
        })();
        return this.initialized;
    }
    async send(receiverId: string, body: string, groupId?: string | null, messageId = randomUUID(), sequenceOverride?: number, attachments?: ChatAttachment[], fileChunk?: FileChunk): Promise<void> {
        this.assertOpen();
        await this.recover();
        this.assertOpen();
        if (!body.trim() && !attachments?.length && !fileChunk)
            throw new Error("empty message");
        if (attachments?.length && groupId)
            throw new Error("attachments are only supported in direct chat");
        if (groupId && !this.config.getGroup(groupId)?.members.includes(receiverId))
            throw new Error("receiver not in group");
        const conversationKey = groupId || [this.config.peerId, receiverId].sort().join(":");
        const sequence = sequenceOverride ?? (this.sequence.get(conversationKey) || 0) + 1;
        if (sequenceOverride === undefined)
            this.sequence.set(conversationKey, sequence);
        let sessionId = groupId || this.sessionIds.get(conversationKey);
        if (!sessionId) {
            sessionId = randomUUID();
            this.sessionIds.set(conversationKey, sessionId);
        }
        const message = parseMessage({
            messageId,
            sessionId,
            senderId: this.config.peerId,
            receiverId,
            groupId,
            type: fileChunk ? 'file-chunk' : attachments?.length ? "attachment" : "text",
            timestamp: Date.now(),
            body,
            attachments,
            mode: "RELAY",
            attempt: 1,
            sequence,
            logicalTime: this.clock = Math.max(Date.now(), this.clock + 1),
            fileChunk,
        });
        if (!fileChunk) {
            await this.config.store.put({ message, status: "pending" });
            this.config.emit({
                kind: "message",
                message: { message, status: "pending" },
            });
        }
        let mode: DeliveryMode = 'RELAY';
        try {
            mode = await this.wait(this.config.selectMode(receiverId));
        }
        catch (error) {
            this.config.log(`DIRECT selection failed: ${String(error)}`);
        }
        this.config.emit({ kind: "mode", peerId: receiverId, mode });
        for (let attempt = 1; attempt <= 3; attempt++) {
            const packet = { ...message, mode, attempt };
            try {
                this.assertOpen();
                let armTimeout=()=>{};
                const ack = new Promise<void>((resolve, reject) => {
                    const key = `${messageId}:${receiverId}`;
                    this.pending.set(key, { resolve, reject, sessionId: message.sessionId });
                    armTimeout=()=>{
                        const waiting=this.pending.get(key);
                        if(waiting)waiting.timer=setTimeout(()=>{this.pending.delete(key);reject(new Error('ACK timeout'));},this.config.ackTimeoutMs || 2000);
                    };
                });
                void ack.catch(() => { });
                await this.wait(this.config.transport(packet, mode));
                this.assertOpen();
                if (!fileChunk) {
                    await this.config.store.put({ message: packet, status: "sent" });
                    this.config.emit({
                        kind: "message",
                        message: { message: packet, status: "sent" },
                    });
                }
                armTimeout();
                await this.wait(ack);
                this.assertOpen();
                if (!fileChunk) {
                    await this.config.store.mark(messageId, receiverId, "delivered");
                    this.config.emit({
                        kind: "message",
                        message: { message: packet, status: "delivered" },
                    });
                }
                return;
            }
            catch (error) {
                const pending = this.pending.get(`${messageId}:${receiverId}`);
                if (pending) {
                    clearTimeout(pending.timer);
                    this.pending.delete(`${messageId}:${receiverId}`);
                }
                this.config.log(`send attempt ${attempt} failed: ${String(error)}`);
                if (this.closed)
                    break;
                mode = "RELAY";
                this.config.emit({ kind: "mode", peerId: receiverId, mode });
            }
        }
        if (!fileChunk) {
            await this.config.store.mark(messageId, receiverId, "failed");
            this.config.emit({
                kind: "message",
                message: { message: { ...message, mode }, status: "failed" },
            });
        }
        throw new Error(`delivery failed to ${receiverId}`);
    }
    async sendDirect(receiverId: string, body: string): Promise<void> {
        peerIdSchema.parse(receiverId);
        if (receiverId === this.config.peerId)
            throw new Error("cannot chat with yourself");
        if (await this.config.store.isDirectBlocked?.(receiverId))
            throw new Error("peer is blocked");
        await this.send(receiverId, body);
    }
    async sendDirectAttachment(receiverId: string, attachments: ChatAttachment[], caption = ""): Promise<void> {
        peerIdSchema.parse(receiverId);
        if (receiverId === this.config.peerId)
            throw new Error("cannot chat with yourself");
        if (await this.config.store.isDirectBlocked?.(receiverId))
            throw new Error("peer is blocked");
        await this.send(receiverId, caption.trim(), undefined, randomUUID(), undefined, attachments);
    }
    async sendGroup(groupId: string, body: string): Promise<Record<string, string>> {
        await this.recover();
        const group = this.config.getGroup(groupId);
        if (!group || !group.members.includes(this.config.peerId))
            throw new Error("not a group member");
        const current = group.projectId
            ? await this.config.syncProjectGroup(group.projectId)
            : group;
        if (current.archived)
            throw new Error("project archived");
        const messageId = randomUUID();
        const sequence = (this.sequence.get(groupId) || 0) + 1;
        this.sequence.set(groupId, sequence);
        const recipients = current.members.filter((peerId) => peerId !== this.config.peerId);
        if (!recipients.length)
            throw new Error('add another member before sending');
        const results = await Promise.allSettled(recipients.map((peerId) => this.send(peerId, body, groupId, messageId, sequence)));
        return Object.fromEntries(recipients.map((peerId, index) => [peerId, results[index].status]));
    }
    receive(raw: unknown, mode: DeliveryMode, expectedSender?: string): Promise<void> {
        const job = this.incoming.then(() => this.receiveOne(raw, mode, expectedSender));
        this.incoming = job.catch(() => { });
        return job;
    }
    private async receiveOne(raw: unknown, mode: DeliveryMode, expectedSender?: string) {
        try {
            if (this.closed)
                return;
            const message = parseMessage(raw);
            this.clock = Math.max(this.clock, message.logicalTime ?? message.timestamp) + 1;
            if (message.receiverId !== this.config.peerId ||
                message.mode !== mode ||
                (expectedSender && message.senderId !== expectedSender))
                throw new Error("wrong receiver, sender or mode");
            if (!message.groupId &&
                (await this.config.store.isDirectBlocked?.(message.senderId)))
                throw new Error("sender blocked");
            this.config.emit({ kind: "mode", peerId: message.senderId, mode });
            if (message.groupId)
                await this.config.authorizeGroup(message.groupId, message.senderId);
            if (message.type === "ack") {
                const pending = this.pending.get(`${message.ackFor}:${message.senderId}`);
                if (pending && pending.sessionId === message.sessionId) {
                    clearTimeout(pending.timer);
                    this.pending.delete(`${message.ackFor}:${message.senderId}`);
                    pending.resolve();
                }
                return;
            }
            if (!message.groupId) {
                const key = [this.config.peerId, message.senderId].sort().join(":");
                if (!this.sessionIds.has(key))
                    this.sessionIds.set(key, message.sessionId);
            }
            if (message.type === 'file-chunk') {
                if (!this.config.onFileChunk)
                    throw new Error('file transfer unsupported');
                await this.config.onFileChunk(message);
            }
            if (message.type === 'attachment')
                for (const file of message.attachments || [])
                    if (file.sha256) {
                        const stored = await this.config.store.getFile?.(file.id);
                        if (!stored || stored.file.sha256 !== file.sha256 || stored.data.length !== file.size)
                            throw new Error('file bytes missing or unverified');
                    }
            const duplicate = message.type === 'file-chunk' || await this.config.store.has(message.messageId, message.senderId);
            if (!duplicate) {
                await this.config.store.put({ message, status: "received" });
                this.config.emit({
                    kind: "message",
                    message: { message, status: "received" },
                });
            }
            const ack: ChatMessage = {
                messageId: randomUUID(),
                sessionId: message.sessionId,
                senderId: this.config.peerId,
                receiverId: message.senderId,
                groupId: message.groupId,
                type: "ack",
                timestamp: Date.now(),
                body: "",
                mode,
                ackFor: message.messageId,
                attempt: 1,
                sequence: message.sequence,
            };
            try {
                await this.config.transport(ack, mode);
            }
            catch {
                await this.config.transport({ ...ack, mode: "RELAY" }, "RELAY");
            }
        }
        catch (error) {
            this.config.log(`receive rejected: ${String(error)}`);
        }
    }
    close() {
        this.closed = true;
        const error = new Error('peer disconnected');
        this.cancel(error);
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pending.clear();
    }
}
