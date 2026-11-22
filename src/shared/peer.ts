import { SecureChannel, publicIdentitySchema } from './secure.ts';
import { MediaSession } from './media.ts';
import { GroupMediaSession } from './groupMedia.ts';
import { RelayMedia } from './relayMedia.ts';
import type { MediaFrame, MediaLink } from './mediaProtocol.ts';
import type { GroupCallContext } from './groupCallProtocol.ts';
import { io, type Socket } from "socket.io-client";
import { DirectTransport, type SignalKind, type SignalPacket, } from "./directTransport.ts";
import { MessageDelivery } from "./messageDelivery.ts";
import { FileTransfer } from './fileTransfer.ts';
import { peerIdSchema, peerDiscoverySchema, type ChatAttachment, type ChatMessage, type DeliveryMode, type Group, type PeerDiscovery, type PeerProfile, } from "./protocol.ts";
import type { PeerConfig, PeerEvent } from "./peerTypes.ts";
export type { ChatStore, DirectChatContact, DirectChatStore, MessageStatus, PeerConfig, PeerEvent, RTCFactory, StoredMessage, } from "./peerTypes.ts";
type Ack = {
    ok: boolean;
    error?: string;
    token?: string;
    peers?: string[];
    groups?: Group[];
    group?: Group;
    peer?: PeerDiscovery;
    key?: unknown;
    queued?: boolean;
    expiresAt?: number;
    rooms?: import('./groupCallProtocol.ts').GroupCallRoom[];
    room?: import('./groupCallProtocol.ts').GroupCallRoom;
};
export class PeerClient {
    private started = false;
    readonly peerId: string;
    private signal?: Socket;
    private relays = new Map<string, Socket>();
    private activeRelay?: string;
    private relayWaiters = new Set<() => void>();
    private signalState: 'connecting' | 'online' | 'reconnecting' | 'offline' = 'offline';
    private reconnectTimer?: ReturnType<typeof setTimeout>;
    private refreshTimer?: ReturnType<typeof setInterval>;
    private registration?: Promise<void>;
    private cancelConnect?: (error: Error) => void;
    private files: FileTransfer;
    private peers: string[] = [];
    private groups = new Map<string, Group>();
    private directTransport: DirectTransport;
    private delivery: MessageDelivery;
    private heartbeat?: ReturnType<typeof setInterval>;
    private closed = false;
    readonly secure: SecureChannel;
    readonly media: MediaSession;
    readonly groupMedia: GroupMediaSession;
    forceRelay: boolean;
    disconnectDirect(peerId: string) {
        peerIdSchema.parse(peerId);
        return !this.closed && this.directTransport.disconnect(peerId);
    }
    constructor(private config: PeerConfig) {
        this.peerId = config.peerId;
        this.forceRelay = !!config.forceRelay;
        this.secure = new SecureChannel(config.peerId, async peerId => {
            if (!this.signal?.connected) throw Error('security key directory unavailable');
            const response = await this.call(this.signal, 'key:lookup', peerId);
            if (!response.ok) throw Error(response.error || 'security key unavailable');
            return publicIdentitySchema.parse(response.key);
        }, config.identityStore);
        const mediaOptions = { rtc: config.rtc, iceServers: config.iceServers, policy: config.rtcPolicy, devices: config.mediaDevices,
            prepare: async () => {
                if (config.encryption) return;
                if (!this.signal?.connected) throw Error('signaling unavailable');
                const response = await this.call(this.signal, 'key:publish', await this.secure.publicIdentity());
                if (!response.ok) throw Error(response.error || 'cannot publish call security key');
            },
            cipher: (peerId: string, callId: string) => this.secure.mediaCipher(peerId, callId), log: (text: string) => this.log(text) };
        this.media = new MediaSession({ ...mediaOptions, busy: () => this.groupMedia?.isActive(),
            relay: (peerId, callId) => this.openMediaRelay(peerId, callId),
            send: (to, data) => this.sendSignal(to, 'media', data), emit: call => this.emit({ kind: 'call', call }) });
        this.groupMedia = new GroupMediaSession({ peerId: this.peerId, devices: config.mediaDevices, busy: () => this.media.isActive(),
            control: async input => {
                if (!this.signal?.connected) throw Error('Cuộc gọi nhóm cần kết nối signaling.');
                const response = await this.call(this.signal, 'group-call:control', input);
                if (!response.ok) throw Error(response.error || 'group call unavailable');
                return response;
            },
            create: (_peerId, scope, stream, context, emit) => new MediaSession({ ...mediaOptions, stream: async () => stream,
                driver: options => new RelayMedia(options, context),
                relay: (peerId, callId) => this.openMediaRelay(peerId, callId, { groupId: scope.groupId, roomId: scope.roomId }),
                send: (to, data) => this.sendSignal(to, 'media', { ...data, group: scope }), emit }),
            emit: (groupCall, groupCalls) => this.emit({ kind: 'group-call', groupCall, groupCalls }), log: text => this.log(text),
        });
        this.directTransport = new DirectTransport({
            peerId: this.peerId,
            rtc: config.rtc,
            iceServers: config.iceServers,
            timeoutMs: config.directTimeoutMs,
            policy: config.rtcPolicy,
            sendSignal: (to, kind, data) => this.sendSignal(to, kind, data),
            onMessage: (raw, expectedSender, route) => {
                void this.receive(raw, route, expectedSender);
            },
            onMode: (peerId, mode) => this.emit({ kind: "mode", peerId, mode }),
            log: (text) => this.log(text),
        });
        this.delivery = new MessageDelivery({
            peerId: this.peerId,
            store: config.store,
            ackTimeoutMs: config.ackTimeoutMs,
            getGroup: (groupId) => this.groups.get(groupId),
            syncProjectGroup: (projectId) => this.syncProjectGroup(projectId),
            authorizeGroup: (groupId, otherPeerId) => this.authorizeGroup(groupId, otherPeerId),
            selectMode: async (receiverId) => {
                if (!this.forceRelay && this.signal?.connected) {
                    try {
                        if (!(await this.lookupPeer(receiverId)).online)
                            return 'RELAY';
                    }
                    catch (error) {
                        this.log(`lookup failed: ${String(error)}`);
                        return 'RELAY';
                    }
                }
                return (await this.directTransport.ensure(receiverId, this.forceRelay))
                    ? this.directTransport.mode(receiverId)
                    : "RELAY";
            },
            transport: (message, mode) => this.transport(message, mode),
            emit: (event) => this.emit(event),
            log: (text) => this.log(text),
            onFileChunk: message => this.files.receive(message),
        });
        this.files = new FileTransfer({
            store: config.store,
            sendChunk: (peerId, chunk) => this.delivery.send(peerId, '', undefined, undefined, undefined, undefined, chunk),
            sendAttachment: (peerId, file) => this.delivery.sendDirectAttachment(peerId, [file]),
            emit: event => this.emit(event),
        });
    }
    private emit(event: PeerEvent) {
        this.config.onEvent(event);
    }
    private log(text: string) {
        this.emit({ kind: "log", text });
    }
    private connection() {
        for (const check of this.relayWaiters) check();
        this.emit({ kind: 'connection', connection: { signaling: this.signalState, relays: [...this.relays.values()].filter(socket => socket.connected).length, activeRelay: this.activeRelay } });
    }
    private async waitForRelay() {
        if (this.closed) throw new Error('peer disconnected');
        if ([...this.relays.values()].some(socket => socket.connected)) return;
        this.log('waiting for outbound relay connection');
        await new Promise<void>((resolve, reject) => {
            const finish = (error?: Error) => {
                clearTimeout(timer);
                this.relayWaiters.delete(check);
                if (error) reject(error);
                else resolve();
            };
            const check = () => {
                if (this.closed) finish(new Error('peer disconnected'));
                else if ([...this.relays.values()].some(socket => socket.connected)) finish();
            };
            const timer = setTimeout(() => finish(new Error('relay connection timeout')), this.config.requestTimeoutMs ?? 4000);
            this.relayWaiters.add(check);
            check();
        });
    }
    getOnlinePeers() {
        return [...this.peers];
    }
    getGroups() {
        return [...this.groups.values()];
    }
    async lookupPeer(peerId: string): Promise<PeerDiscovery> {
        peerIdSchema.parse(peerId);
        if (!this.signal?.connected)
            throw new Error("signaling unavailable");
        const result = await this.call(this.signal, "peer:lookup", { peerId });
        if (!result.ok)
            throw new Error(result.error || "peer lookup failed");
        const peer = peerDiscoverySchema.parse(result.peer);
        if (peer.peerId !== peerId)
            throw new Error("peer lookup identity mismatch");
        return peer;
    }
    private async call(socket: Socket, event: string, payload: unknown): Promise<Ack> {
        if (this.closed || !socket.connected) throw new Error('connection unavailable');
        return await new Promise((resolve, reject) => {
            socket
                .timeout(this.config.requestTimeoutMs ?? 4000)
                .emit(event, payload, (error: Error | null, result: Ack) => error ? reject(error) : resolve(result));
        });
    }
    async connect() {
        if (this.started || this.closed)
            throw new Error('Create a new PeerClient after closing a session');
        this.started = true;
        this.closed = false;
        await this.delivery.recover();
        if (this.closed) throw new Error('peer disconnected');
        this.signalState = 'connecting';
        this.connection();
        this.signal = io(this.config.signalUrl, {
            autoConnect: false,
            reconnection: true,
        });
        let ready!: () => void, fail!: (error: Error) => void;
        const initial = new Promise<void>((resolve, reject) => { ready = resolve; fail = reject; });
        this.cancelConnect = fail;
        const timer = setTimeout(() => fail(new Error('signaling timeout')), 8000);
        this.signal.on('connect', () => {
            void this.register().then(ready).catch(error => {
                this.log(`register failed: ${String(error)}`);
                this.signalState = 'offline';
                this.connection();
                this.signal?.disconnect();
                fail(error instanceof Error ? error : new Error(String(error)));
            });
        });
        this.signal.on('connect_error', error => { this.log(`signaling error: ${error.message}`); this.signalState = 'reconnecting'; this.connection(); });
        this.signal.on('auth:expired', () => { this.close(); this.emit({ kind: 'auth-expired' }); });
        this.signal.on("presence", (peers: string[]) => {
            this.peers = peers;
            this.emit({ kind: "presence", peers });
        });
        this.signal.on('peer:profiles', (profiles: PeerProfile[]) => this.emit({ kind: 'presence', peers: this.peers, profiles }));
        this.signal.on("group:update", (group: Group) => {
            if (group.members.includes(this.peerId))
                this.groups.set(group.id, group);
            else
                this.groups.delete(group.id);
            this.groupMedia.membership(group);
            this.emit({ kind: "group", group });
        });
        this.signal.on('group-call:update', (raw: unknown) => { if (!this.closed) try { this.groupMedia.update(raw); } catch { this.log('invalid group call roster'); } });
        this.signal.on("signal:receive", (packet: SignalPacket) => {
            if (packet.kind === 'media') { void this.receiveMedia(packet.from, packet.data); return; }
            void this.directTransport
                .receiveSignal(packet)
                .catch((error: unknown) => this.log(`signal error: ${String(error)}`));
        });
        this.signal.on('disconnect', reason => {
            this.groupMedia.offline();
            this.log(`signaling disconnected: ${reason}`);
            this.signalState = this.closed ? 'offline' : 'reconnecting';
            this.peers = [];
            this.emit({ kind: 'presence', peers: [] });
            this.connection();
            if (!this.closed && reason === 'io server disconnect')
                this.reconnectTimer = setTimeout(() => {
                    if (!this.closed)
                        this.signal?.connect();
                }, 1000);
        });
        this.signal.connect();
        try {
            await initial;
            if (this.closed) throw new Error('peer disconnected');
        }
        catch (error) { this.close(); throw error; }
        finally {
            clearTimeout(timer);
            this.cancelConnect = undefined;
        }
        this.heartbeat = setInterval(() => {
            if (this.signal?.connected)
                this.signal.emit("peer:heartbeat");
        }, 10000);
        this.refreshTimer = setInterval(() => {
            if (this.signal?.connected)
                void this.register().catch(error => this.log(String(error)));
        }, 6 * 60 * 60 * 1000);
    }
    private async register() {
        this.registration ??= this.registerOnce().finally(() => { this.registration = undefined; });
        return this.registration;
    }
    private async registerOnce() {
        if (!this.signal || this.closed)
            return;
        const response = await this.call(this.signal, "peer:register", {
            peerId: this.peerId,
            identityProof: this.config.identityProof,
            displayName: this.config.displayName,
        });
        if (!response.ok || !response.token)
            throw new Error(response.error || "registration failed");
        if (this.closed)
            return;
        if (this.config.encryption) {
            const published = await this.call(this.signal, 'key:publish', await this.secure.publicIdentity());
            if (!published.ok) throw Error(published.error || 'cannot publish security key');
        }
        this.peers = response.peers || [];
        this.groups = new Map((response.groups || []).map((group) => [group.id, group]));
        this.emit({ kind: "presence", peers: this.peers });
        for (const group of this.groups.values())
            this.emit({ kind: "group", group });
        for (const socket of this.relays.values())
            socket.disconnect();
        this.relays.clear();
        this.activeRelay = undefined;
        for (const url of [...new Set([this.config.relayUrl, ...(this.config.relayUrls || [])].map(url => url.replace(/\/$/, '')))].slice(0, 4)) {
            const socket = io(url, {
                auth: { token: response.token },
                reconnection: true,
            });
            this.relays.set(url, socket);
            socket.on("relay:receive", (raw: unknown) => {
                void this.receive(raw, "RELAY");
            });
            socket.on('media:frame', (frame: unknown) => { this.media.receiveFrame(frame); this.groupMedia.receiveFrame(frame); });
            socket.on('connect', () => { if(!this.activeRelay || url===this.config.relayUrl.replace(/\/$/,''))this.activeRelay=url; this.log('relay connected'); this.connection(); });
            socket.on('disconnect', () => {
                if (this.activeRelay === url)
                    this.activeRelay = [...this.relays].find(([, item]) => item.connected)?.[0];
                this.log('relay disconnected');
                this.connection();
            });
            socket.on('connect_error', error => { this.log(`relay error: ${error.message}`); this.connection(); });
        }
        void this.groupMedia.refresh().catch(error => this.log('group call discovery: ' + String(error)));
        this.signalState = 'online';
        this.connection();
    }
    async createGroup(members: string[], name?: string): Promise<Group> {
        if (!this.signal)
            throw new Error("not connected");
        const result = await this.call(this.signal, "group:create", { members, name });
        if (!result.ok || !result.group)
            throw new Error(result.error || "group creation failed");
        return result.group;
    }
    async syncProjectGroup(projectId: string): Promise<Group> {
        if (!this.signal?.connected)
            throw new Error("signaling unavailable");
        const result = await this.call(this.signal, "project:group", { projectId });
        if (!result.ok || !result.group)
            throw new Error(result.error || "project group access denied");
        this.groups.set(result.group.id, result.group);
        this.emit({ kind: "group", group: result.group });
        return result.group;
    }
    private async authorizeGroup(groupId: string, otherPeerId: string) {
        if (!this.signal?.connected)
            throw new Error("group authorization unavailable");
        const result = await this.call(this.signal, "group:authorize", {
            groupId,
            otherPeerId,
        });
        if (!result.ok || !result.group)
            throw new Error(result.error || "group access denied");
        this.groups.set(groupId, result.group);
        if (result.group.archived)
            throw new Error("project archived");
        return result.group;
    }
    async changeGroup(groupId: string, memberId: string, action: "add" | "remove"): Promise<Group> {
        if (!this.signal)
            throw new Error("not connected");
        const group = this.groups.get(groupId);
        if (!group)
            throw new Error("group unknown");
        const result = await this.call(this.signal, "group:change", {
            groupId,
            memberId,
            action,
            version: group.version,
        });
        if (!result.ok || !result.group)
            throw new Error(result.error || "group change failed");
        return result.group;
    }
    private async sendSignal(to: string, kind: SignalKind, data: unknown) {
        if (!this.signal?.connected)
            throw new Error("signaling unavailable");
        const result = await this.call(this.signal, "signal:send", {
            to,
            kind,
            data,
        });
        if (!result.ok)
            throw new Error(result.error || "signal rejected");
    }
    private async transport(message: ChatMessage, mode: DeliveryMode): Promise<void | { queued: true; expiresAt?: number }> {
        const packet = this.config.encryption ? await this.secure.seal({ ...message, mode }) : { ...message, mode };


        if (packet.groupId)
            await this.authorizeGroup(packet.groupId, packet.receiverId);
        if (mode === "DIRECT" || mode === 'TURN') {
            this.directTransport.send(packet.receiverId, packet);
            this.log(`${mode} SEND ${packet.messageId} -> ${packet.receiverId}`);
        }
        else {
            await this.waitForRelay();
            let failure = 'relay unavailable';
            const candidates = [...this.relays].sort(([a], [b]) => Number(b === this.activeRelay) - Number(a === this.activeRelay));
            for (const [url, socket] of candidates) {
                if (!socket.connected)
                    continue;
                try {
                    const response = await this.call(socket, 'relay:send', packet);
                    if (!response.ok) {
                        failure = response.error || 'relay rejected';
                        continue;
                    }
                    this.activeRelay = url;
                    this.connection();
                    this.log(`RELAY SEND ${packet.messageId} -> ${packet.receiverId} via ${url}`);
                    return response.queued ? { queued: true, expiresAt: response.expiresAt } : undefined;
                }
                catch (error) {
                    failure = String(error);
                    this.log(`relay failover: ${failure}`);
                }
            }
            throw new Error(failure);
        }
    }
    async send(receiverId: string, body: string, groupId?: string | null, messageId?: string, sequenceOverride?: number, attachments?: ChatAttachment[]): Promise<void> {
        return this.delivery.send(receiverId, body, groupId, messageId, sequenceOverride, attachments);
    }
    /** Personal conversation; DIRECT is attempted first, with RELAY fallback. */
    async sendDirect(receiverId: string, body: string): Promise<void> {
        return this.delivery.sendDirect(receiverId, body);
    }
    async sendDirectAttachment(receiverId: string, attachments: ChatAttachment[], caption = ""): Promise<void> {
        return this.delivery.sendDirectAttachment(receiverId, attachments, caption);
    }
    async sendFile(receiverId: string, name: string, mime: string, data: Uint8Array) {
        peerIdSchema.parse(receiverId);
        if (receiverId === this.peerId || await this.config.store.isDirectBlocked?.(receiverId))
            throw new Error('invalid or blocked recipient');
        return this.files.send(receiverId, name, mime, data);
    }
    async retry(messageId: string, receiverId: string) {
        return this.delivery.retry(messageId, receiverId);
    }
    async sendGroup(groupId: string, body: string): Promise<Record<string, string>> {
        return this.delivery.sendGroup(groupId, body);
    }
    /** Single inbound boundary kept here so tests can inject a forged transport packet. */
    private async receive(raw: unknown, mode: DeliveryMode, expectedSender?: string) {
        try {
            const message = this.config.encryption ? await this.secure.open(raw) : raw as ChatMessage;
            await this.delivery.receive(message, mode, expectedSender);
            if (mode === 'RELAY' && message && typeof message === 'object') {
                const rows = await this.config.store.list();
                const accepted = message.type === 'ack' ? rows.some(row => row.message.messageId === message.ackFor && row.message.receiverId === message.senderId && row.status === 'delivered')
                    : rows.some(row => row.message.messageId === message.messageId && row.message.senderId === message.senderId && row.status === 'received');
                if (accepted) await Promise.allSettled([...this.relays.values()].filter(socket => socket.connected).map(socket => this.call(socket, 'relay:consumed', { messageId: message.messageId, senderId: message.senderId })));
            }
        } catch (error) { this.log(`secure receive rejected: ${String(error)}`); }
    }
    private async openMediaRelay(peerId: string, callId: string, group?: GroupCallContext): Promise<MediaLink> {
        await this.waitForRelay();
        let stopped = false, refreshing = false;
        const opened = new Set<Socket>(), input = { callId, to: peerId, ...(group ? { group } : {}) };
        const refresh = async () => {
            if (stopped || refreshing) return;
            refreshing = true;
            try {
                await Promise.allSettled([...this.relays.values()].filter(socket => socket.connected).map(async socket => {
                    try {
                        const response = await this.call(socket, 'media:open', input);
                        if (stopped) { if (response.ok) void this.call(socket, 'media:close', input).catch(() => {}); return; }
                        if (response.ok) opened.add(socket); else opened.delete(socket);
                    } catch { opened.delete(socket); }
                }));
            } finally { refreshing = false; }
        };
        await refresh();
        if (!opened.size || this.closed) {
            stopped = true;
            for (const socket of opened) void this.call(socket, 'media:close', input).catch(() => {});
            throw Error('Không mở được relay cuộc gọi. Cần khởi động lại demo để cập nhật relay.');
        }
        const timer = setInterval(() => { void refresh(); }, 5000);
        return {
            send: (frame: MediaFrame) => {
                if (stopped || this.closed) return false;
                const preferred = this.activeRelay && this.relays.get(this.activeRelay);
                const socket = preferred && opened.has(preferred) && preferred.connected ? preferred : [...opened].find(socket => socket.connected);
                if (!socket || socket.io.engine.writeBuffer.length > (frame.kind === 'audio' ? 16 : 2)) return false;
                if (frame.kind === 'video') socket.volatile.emit('media:frame', frame);
                else socket.emit('media:frame', frame);
                return true;
            },
            close: () => { if (stopped) return; stopped = true; clearInterval(timer); for (const socket of opened) void this.call(socket, 'media:close', input).catch(() => {}); opened.clear(); },
        };
    }
    private async receiveMedia(from: string, data: unknown) {
        try {
            if (this.closed || await this.config.store.isDirectBlocked?.(from)) return;
            if (data && typeof data === 'object' && 'group' in data) await this.groupMedia.receive(from, data);
            else await this.media.receive(from, data);
        }
        catch (error) { this.log(`media signal rejected: ${String(error)}`); }
    }
    close() {
        this.closed = true;
        this.media.close(); this.groupMedia.close();
        this.cancelConnect?.(new Error('peer disconnected'));
        if (this.heartbeat)
            clearInterval(this.heartbeat);
        if (this.refreshTimer)
            clearInterval(this.refreshTimer);
        if (this.reconnectTimer)
            clearTimeout(this.reconnectTimer);
        this.delivery.close();
        this.directTransport.close();
        this.files.close();
        this.signal?.disconnect();
        for (const socket of this.relays.values())
            socket.disconnect();
        this.relays.clear();
        this.activeRelay = undefined;
        this.signalState = 'offline';
        this.connection();
    }
}
