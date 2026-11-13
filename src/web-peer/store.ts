import { isDirectMessageBetween, peerIdSchema, type DirectChatContact, type DirectChatStore, type StoredMessage, type MessageStatus, type ChatAttachment, orderMessages, } from "@ds01/shared";
export class WebStore implements DirectChatStore {
    private contactWrites = Promise.resolve();
    constructor(private scope: string) { }
    private get key() {
        return `ds01-history-v1-${this.scope}`;
    }
    private get contactKey() {
        return `ds01-direct-contacts-v1-${this.scope}`;
    }
    private get blockedKey() {
        return `ds01-direct-blocked-v1-${this.scope}`;
    }
    private read(): StoredMessage[] {
        try {
            const rows: unknown = JSON.parse(localStorage.getItem(this.key) || "[]");
            if (!Array.isArray(rows))
                throw new Error('invalid history');
            return rows.filter((row): row is StoredMessage => !!row?.message && typeof row.message.messageId === 'string' && typeof row.message.sequence === 'number');
        }
        catch {
            throw new Error('Lịch sử cục bộ bị hỏng. Hãy xuất dữ liệu trước khi đặt lại storage.');
        }
    }
    private write(rows: StoredMessage[]) {
        localStorage.setItem(this.key, JSON.stringify(rows.slice(-1000)));
    }
    async put(row: StoredMessage) {
        const rows = this.read();
        const index = rows.findIndex((r) => r.message.messageId === row.message.messageId &&
            r.message.receiverId === row.message.receiverId &&
            r.message.senderId === row.message.senderId);
        if (index >= 0)
            rows[index] = row;
        else
            rows.push(row);
        this.write(rows);
        if (row.status === 'received') {
            const key = `${this.key}-seen`;
            const seen = this.seen();
            seen.add(`${row.message.senderId}:${row.message.messageId}`);
            localStorage.setItem(key, JSON.stringify([...seen].slice(-10000)));
        }
    }
    async putDirect(row: StoredMessage) {
        const currentPeerId = peerIdSchema.parse(this.scope);
        const message = row.message;
        const otherPeerId = message.senderId === currentPeerId
            ? message.receiverId
            : message.senderId;
        peerIdSchema.parse(otherPeerId);
        if (otherPeerId === currentPeerId ||
            !isDirectMessageBetween(message, currentPeerId, otherPeerId))
            throw new Error("direct message does not belong to this store");
        await this.put(row);
    }
    async mark(messageId: string, receiverId: string, status: MessageStatus) {
        const rows = this.read();
        for (const row of rows)
            if (row.message.messageId === messageId &&
                row.message.receiverId === receiverId)
                row.status = status;
        this.write(rows);
    }
    async has(messageId: string, senderId: string) {
        return this.seen().has(`${senderId}:${messageId}`) || this.read().some((r) => r.message.messageId === messageId && r.message.senderId === senderId);
    }
    async list() {
        return orderMessages(this.read());
    }
    async listDirect(peerId: string) {
        const currentPeerId = peerIdSchema.parse(this.scope);
        const otherPeerId = peerIdSchema.parse(peerId);
        if (currentPeerId === otherPeerId)
            throw new Error("direct conversation requires another peer");
        return orderMessages(this.read()
            .filter((row) => isDirectMessageBetween(row.message, currentPeerId, otherPeerId)));
    }
    async listDirectAttachments(peerId: string) {
        return (await this.listDirect(peerId)).filter((row) => row.message.type === "attachment");
    }
    async deleteDirect(peerId: string) {
        const currentPeerId = peerIdSchema.parse(this.scope);
        const otherPeerId = peerIdSchema.parse(peerId);
        if (currentPeerId === otherPeerId)
            throw new Error("direct conversation requires another peer");
        this.write(this.read().filter((row) => !isDirectMessageBetween(row.message, currentPeerId, otherPeerId)));
    }
    async setDirectBlocked(peerId: string, blocked: boolean) {
        const otherPeerId = peerIdSchema.parse(peerId);
        if (otherPeerId === peerIdSchema.parse(this.scope))
            throw new Error("cannot block yourself");
        const rows = new Set<string>(JSON.parse(localStorage.getItem(this.blockedKey) || "[]") as string[]);
        if (blocked)
            rows.add(otherPeerId);
        else
            rows.delete(otherPeerId);
        localStorage.setItem(this.blockedKey, JSON.stringify([...rows].sort()));
    }
    async isDirectBlocked(peerId: string) {
        return (await this.listDirectBlocked()).includes(peerIdSchema.parse(peerId));
    }
    async listDirectBlocked() {
        try {
            const rows = JSON.parse(localStorage.getItem(this.blockedKey) || "[]") as unknown;
            return Array.isArray(rows)
                ? rows.filter((row): row is string => peerIdSchema.safeParse(row).success)
                : [];
        }
        catch {
            return [];
        }
    }
    async saveDirectContact(contact: DirectChatContact) {
        const operation = this.contactWrites.then(() => this.saveContact(contact));
        this.contactWrites = operation.catch(() => { });
        return operation;
    }
    private async saveContact(contact: DirectChatContact) {
        const peerId = peerIdSchema.parse(contact.peerId);
        if (peerId === peerIdSchema.parse(this.scope))
            throw new Error("cannot save yourself");
        const contacts = await this.listDirectContacts();
        const next = [contact, ...contacts.filter((row) => row.peerId !== peerId)];
        localStorage.setItem(this.contactKey, JSON.stringify(next.slice(0, 500)));
    }
    async listDirectContacts(): Promise<DirectChatContact[]> {
        try {
            const rows = JSON.parse(localStorage.getItem(this.contactKey) || "[]") as DirectChatContact[];
            return Array.isArray(rows)
                ? rows
                    .filter((row) => peerIdSchema.safeParse(row.peerId).success &&
                    typeof row.name === "string" &&
                    typeof row.email === "string" &&
                    Number.isSafeInteger(row.updatedAt))
                    .sort((left, right) => right.updatedAt - left.updatedAt)
                : [];
        }
        catch {
            return [];
        }
    }
    async removeDirectContact(peerId: string) {
        const otherPeerId = peerIdSchema.parse(peerId);
        localStorage.setItem(this.contactKey, JSON.stringify((await this.listDirectContacts()).filter((contact) => contact.peerId !== otherPeerId)));
    }
    private seen(): Set<string> {
        try {
            const value: unknown = JSON.parse(localStorage.getItem(`${this.key}-seen`) || '[]');
            return new Set(Array.isArray(value) ? value.filter(item => typeof item === 'string') : []);
        }
        catch {
            return new Set();
        }
    }
    private async files(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('ds01-files-v1', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('files');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
    }
    async putFile(file: ChatAttachment, data: Uint8Array): Promise<void> {
        const db = await this.files();
        try {
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction('files', 'readwrite');
                tx.objectStore('files').put({ file, data }, `${this.scope}:${file.id}`);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error || new Error('file storage aborted'));
            });
        }
        finally {
            db.close();
        }
    }
    async getFile(fileId: string): Promise<{
        file: ChatAttachment;
        data: Uint8Array;
    } | undefined> {
        const db = await this.files();
        try {
            return await new Promise((resolve, reject) => {
                const tx = db.transaction('files', 'readonly');
                const request = tx.objectStore('files').get(`${this.scope}:${fileId}`);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        }
        finally {
            db.close();
        }
    }
}
