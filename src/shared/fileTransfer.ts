import { randomUUID } from './uuid.ts';
import { chatAttachmentSchema, MAX_CHAT_ATTACHMENT_BYTES, type ChatMessage, type FileChunk } from './protocol.ts';
import type { ChatStore, PeerEvent } from './peerTypes.ts';
const CHUNK_BYTES = 2304;
export async function fileHash(data: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(data).buffer);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
type Assembly = {
    chunk: FileChunk;
    senderId: string;
    parts: Map<number, Uint8Array>;
    updated: number;
    bytes: number;
};
export class FileTransfer {
    private assemblies = new Map<string, Assembly>();
    private rejected = new Map<string, number>();
    constructor(private config: {
        store: ChatStore;
        sendChunk: (peerId: string, chunk: FileChunk) => Promise<void>;
        sendAttachment: (peerId: string, file: FileChunk['file']) => Promise<void>;
        emit: (event: PeerEvent) => void;
    }) { }
    private progress(chunk: FileChunk, peerId: string, direction: 'send' | 'receive', progress: number, status: 'transferring' | 'complete' | 'failed', error?: string) {
        this.config.emit({ kind: 'transfer', transfer: { id: chunk.transferId, name: chunk.file.name, peerId, direction, progress, status, error } });
    }
    async send(peerId: string, name: string, mime: string, data: Uint8Array) {
        if (!this.config.store.putFile)
            throw new Error('file storage unsupported');
        if (!data.length || data.length > MAX_CHAT_ATTACHMENT_BYTES)
            throw new Error('File phải từ 1 byte đến 512 KiB');
        const file = { ...chatAttachmentSchema.parse({ id: randomUUID(), name, mime: mime || 'application/octet-stream', size: data.length }), sha256: await fileHash(data) };
        const total = Math.ceil(data.length / CHUNK_BYTES);
        let last: FileChunk = { transferId: file.id, index: 0, total, data: '', file };
        try {
            await this.config.store.putFile(file, data);
            for (let index = 0; index < total; index++) {
                const bytes = data.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
                last = { transferId: file.id, index, total, data: btoa(String.fromCharCode(...bytes)), file };
                this.progress(last, peerId, 'send', Math.round(index / total * 100), 'transferring');
                await this.config.sendChunk(peerId, last);
            }
            await this.config.sendAttachment(peerId, file);
            this.progress(last, peerId, 'send', 100, 'complete');
        }
        catch (error) {
            this.progress(last, peerId, 'send', 0, 'failed', String(error));
            throw error;
        }
    }
    async receive(message: ChatMessage) {
        const chunk = message.fileChunk;
        if (!chunk || !this.config.store.putFile || !this.config.store.getFile)
            throw new Error('file storage unsupported');
        if (chunk.total !== Math.ceil(chunk.file.size / CHUNK_BYTES))
            throw new Error('invalid chunk count');
        const bytes = Uint8Array.from(atob(chunk.data), char => char.charCodeAt(0));
        const expectedSize = chunk.index === chunk.total - 1 ? chunk.file.size - chunk.index * CHUNK_BYTES : CHUNK_BYTES;
        if (bytes.length !== expectedSize)
            throw new Error('invalid chunk size');
        const complete = await this.config.store.getFile(chunk.transferId);
        if (complete) {
            if (complete.file.sha256 !== chunk.file.sha256)
                throw new Error('conflicting file');
            return;
        }
        for (const [key, item] of this.assemblies)
            if (Date.now() - item.updated > 120000)
                this.assemblies.delete(key);
        const key = `${message.senderId}:${chunk.transferId}`;
        for (const [id, at] of this.rejected)
            if (Date.now() - at > 120000)
                this.rejected.delete(id);
        if (this.rejected.has(key))
            throw new Error('file integrity failed; start a new transfer');
        let item = this.assemblies.get(key);
        if (!item) {
            if (this.assemblies.size >= 4)
                throw new Error('too many concurrent files');
            item = { chunk, senderId: message.senderId, parts: new Map(), updated: Date.now(), bytes: 0 };
            this.assemblies.set(key, item);
        }
        if (JSON.stringify(item.chunk.file) !== JSON.stringify(chunk.file) || item.chunk.total !== chunk.total)
            throw new Error('conflicting file metadata');
        const prior = item.parts.get(chunk.index);
        if (prior && (prior.length !== bytes.length || prior.some((byte, index) => byte !== bytes[index])))
            throw new Error('conflicting chunk');
        if (!prior) {
            item.parts.set(chunk.index, bytes);
            item.bytes += bytes.length;
        }
        item.updated = Date.now();
        this.progress(chunk, message.senderId, 'receive', Math.round(item.parts.size / chunk.total * 100), 'transferring');
        if (item.parts.size !== chunk.total)
            return;
        const data = new Uint8Array(chunk.file.size);
        for (let index = 0; index < chunk.total; index++)
            data.set(item.parts.get(index)!, index * CHUNK_BYTES);
        if (item.bytes !== chunk.file.size || await fileHash(data) !== chunk.file.sha256) {
            this.assemblies.delete(key);
            this.rejected.set(key, Date.now());
            if (this.rejected.size > 128)
                this.rejected.delete(this.rejected.keys().next().value!);
            this.progress(chunk, message.senderId, 'receive', 0, 'failed', 'SHA-256 mismatch');
            throw new Error('SHA-256 mismatch');
        }
        await this.config.store.putFile(chunk.file, data);
        this.assemblies.delete(key);
        this.progress(chunk, message.senderId, 'receive', 100, 'complete');
    }
    close() { this.assemblies.clear(); this.rejected.clear(); }
}
