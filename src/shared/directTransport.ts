import type { DeliveryMode } from "./protocol.ts";
import type { RTCFactory } from "./peerTypes.ts";
import { inspectIceRoute } from './iceRoute.ts';
export type SignalKind = "request" | "offer" | "answer" | "ice";
export type SignalPacket = {
    from: string;
    kind: SignalKind;
    data: unknown;
};
type DirectConnection = {
    pc: RTCPeerConnection;
    channel?: RTCDataChannel;
    ready: boolean;
    opening?: Promise<boolean>;
    stopOpening?: () => void;
    candidates: RTCIceCandidateInit[];
    failedUntil: number;
    negotiating?: Promise<void>;
    route: 'DIRECT' | 'TURN';
    classification?: Promise<void>;
};
type DirectTransportConfig = {
    peerId: string;
    rtc: RTCFactory;
    iceServers?: RTCIceServer[];
    timeoutMs?: number;
    policy?: RTCIceTransportPolicy;
    sendSignal: (to: string, kind: SignalKind, data: unknown) => Promise<void>;
    onMessage: (raw: unknown, expectedSender: string, route: 'DIRECT' | 'TURN') => void;
    onMode: (peerId: string, mode: DeliveryMode) => void;
    log: (text: string) => void;
};

export class DirectTransport {
    private connections = new Map<string, DirectConnection>();
    private signals = new Map<string, Promise<void>>();
    private closed = false;
    constructor(private config: DirectTransportConfig) { }
    private current(peerId: string, direct: DirectConnection) {
        return !this.closed && this.connections.get(peerId) === direct && direct.pc.connectionState !== 'closed';
    }
    private fail(peerId: string, direct: DirectConnection, reason: string) {
        if (this.closed || this.connections.get(peerId) !== direct || (!direct.ready && direct.failedUntil > Date.now())) return;
        direct.ready = false;
        direct.failedUntil = Date.now() + 30000;
        direct.stopOpening?.();
        direct.pc.close();
        this.config.onMode(peerId, 'RELAY');
        this.config.log(reason);
    }
    private connection(peerId: string, incoming = false): DirectConnection {
        let item = this.connections.get(peerId);
        if (item && (incoming && item.ready ||
            (!item.ready && item.failedUntil > 0 || ["failed", "closed"].includes(item.pc.connectionState)) &&
            (incoming || item.failedUntil <= Date.now()))) {
            this.connections.delete(peerId);
            item.stopOpening?.();
            item.pc.close();
            item = undefined;
        }
        if (item)
            return item;
        const pc = new this.config.rtc({
            iceTransportPolicy: this.config.policy || 'all',
            iceServers: this.config.iceServers || [
                { urls: "stun:stun.l.google.com:19302" },
            ],
        });
        item = { pc, ready: false, candidates: [], failedUntil: 0, route: 'DIRECT' };
        this.connections.set(peerId, item);
        pc.onicecandidate = (event) => {
            if (event.candidate && this.current(peerId, item!))
                void this.config
                    .sendSignal(peerId, "ice", event.candidate.toJSON())
                    .catch((error) => this.config.log(`ICE send failed: ${String(error)}`));
        };
        pc.onconnectionstatechange = () => {
            if (this.closed || this.connections.get(peerId) !== item)
                return;
            if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
                this.fail(peerId, item!, `direct lost ${peerId}: ${pc.connectionState}; RELAY fallback`);
            }
        };
        pc.ondatachannel = (event) => {
            if (this.current(peerId, item!)) this.attachChannel(peerId, item!, event.channel);
            else event.channel.close();
        };
        return item;
    }
    private attachChannel(peerId: string, direct: DirectConnection, channel: RTCDataChannel) {
        direct.channel = channel;
        channel.onopen = () => {
            direct.classification = (async () => {
                try {
                    const route = await inspectIceRoute(direct.pc, () => channel.readyState === 'open' && this.current(peerId, direct));
                    if (!route)
                        throw new Error('selected ICE route is unavailable');
                    direct.route = route.mode;
                }
                catch (error) {
                    if (!this.current(peerId, direct)) return;
                    this.fail(peerId, direct, `ICE route inspection unavailable ${peerId}: ${String(error)}; RELAY fallback`);
                    return;
                }
                if (channel.readyState !== 'open' || !this.current(peerId, direct))
                    return;
                direct.ready = true;
                direct.failedUntil = 0;
                this.config.onMode(peerId, direct.route);
                this.config.log(`${direct.route} open ${peerId}`);
            })();
        };
        channel.onclose = () => {
            this.fail(peerId, direct, `DIRECT closed ${peerId}; RELAY fallback`);
        };
        channel.onerror = () => {
            this.fail(peerId, direct, `DataChannel error ${peerId}; RELAY fallback`);
        };
        channel.onmessage = (event) => {
            void (direct.classification || Promise.resolve()).then(() => {
                if (!direct.ready || !this.current(peerId, direct))
                    return;
                this.config.onMessage(JSON.parse(String(event.data)), peerId, direct.route);
            }).catch(error => {
                this.config.log(`bad direct message: ${String(error)}`);
            });
        };
    }
    private async flushCandidates(direct: DirectConnection) {
        for (const candidate of direct.candidates.splice(0))
            await direct.pc.addIceCandidate(candidate);
    }
    private async makeOffer(peerId: string, direct: DirectConnection) {
        if (direct.ready)
            return;
        if (direct.negotiating)
            return direct.negotiating;
        direct.negotiating = this.offer(peerId, direct).finally(() => { direct.negotiating = undefined; });
        return direct.negotiating;
    }
    private async offer(peerId: string, direct: DirectConnection) {
        const channel = direct.pc.createDataChannel("chat", { ordered: true });
        this.attachChannel(peerId, direct, channel);
        const offer = await direct.pc.createOffer();
        if (!this.current(peerId, direct)) return;
        await direct.pc.setLocalDescription(offer);
        if (!this.current(peerId, direct)) return;
        await this.config.sendSignal(peerId, "offer", offer);
    }
    async receiveSignal(packet: SignalPacket): Promise<void> {
        if (this.closed) return;
        const previous = this.signals.get(packet.from) || Promise.resolve();
        const pending = previous.catch(() => {}).then(() => {
            if (!this.closed) return this.handleSignal(packet);
        });
        this.signals.set(packet.from, pending);
        try { await pending; }
        finally {
            if (this.signals.get(packet.from) === pending) this.signals.delete(packet.from);
        }
    }
    private async handleSignal(packet: SignalPacket): Promise<void> {
        const { from, kind, data } = packet;
        const direct = this.connection(from, kind === 'offer' || kind === 'request');
        if (kind === "request") {
            if (this.config.peerId < from && direct.pc.signalingState === "stable")
                await this.makeOffer(from, direct);
            return;
        }
        if (kind === "offer") {
            if (direct.pc.signalingState !== "stable") {
                this.connections.delete(from);
                direct.stopOpening?.();
                direct.pc.close();
                return this.handleSignal(packet);
            }
            await direct.pc.setRemoteDescription(data as RTCSessionDescriptionInit);
            if (!this.current(from, direct)) return;
            await this.flushCandidates(direct);
            const answer = await direct.pc.createAnswer();
            if (!this.current(from, direct)) return;
            await direct.pc.setLocalDescription(answer);
            if (!this.current(from, direct)) return;
            await this.config.sendSignal(from, "answer", answer);
            return;
        }
        if (kind === "answer") {
            await direct.pc.setRemoteDescription(data as RTCSessionDescriptionInit);
            await this.flushCandidates(direct);
            return;
        }
        if (direct.pc.remoteDescription)
            await direct.pc.addIceCandidate(data as RTCIceCandidateInit);
        else
            direct.candidates.push(data as RTCIceCandidateInit);
    }
    async ensure(peerId: string, forceRelay: boolean): Promise<boolean> {
        if (forceRelay || this.closed)
            return false;
        const direct = this.connection(peerId);
        if (direct.ready && direct.channel?.readyState === "open")
            return true;
        if (direct.failedUntil > Date.now())
            return false;
        if (direct.opening)
            return direct.opening;
        direct.opening = (async () => {
            let timer: ReturnType<typeof setTimeout> | undefined;

            const deadline = new Promise<boolean>(resolve => {
                direct.stopOpening = () => resolve(false);
                timer = setTimeout(() => resolve(false), this.config.timeoutMs ?? 10000);
            });
            const negotiate = async () => {
                if (this.config.peerId < peerId && direct.pc.signalingState === 'stable')
                    await this.makeOffer(peerId, direct);
                else if (this.config.peerId > peerId && direct.pc.signalingState === 'stable')
                    await this.config.sendSignal(peerId, 'request', null);
                while (!direct.ready && this.current(peerId, direct))
                    await new Promise(resolve => setTimeout(resolve, 100));
                return direct.ready && direct.channel?.readyState === 'open';
            };
            try {
                const ready = await Promise.race([negotiate(), deadline]);
                if (!ready && this.current(peerId, direct)) {
                    this.fail(peerId, direct, `DIRECT timeout ${peerId}; RELAY fallback`);
                }
                return ready;
            }
            catch (error) {
                this.fail(peerId, direct, `DIRECT failed ${peerId}: ${String(error)}; RELAY fallback`);
                return false;
            }
            finally {
                clearTimeout(timer);
                direct.stopOpening = undefined;
                direct.opening = undefined;
            }
        })();
        return direct.opening;
    }
    send(peerId: string, packet: unknown) {
        const direct = this.connections.get(peerId), channel = direct?.channel;
        if (!direct?.ready || !this.current(peerId, direct) || !channel || channel.readyState !== "open")
            throw new Error("direct unavailable");
        channel.send(JSON.stringify(packet));
    }
    mode(peerId: string): 'DIRECT' | 'TURN' { return this.connections.get(peerId)?.route || 'DIRECT'; }
    disconnect(peerId: string) {
        const direct = this.connections.get(peerId);
        if (!direct || !this.current(peerId, direct)) return false;
        this.fail(peerId, direct, `DIRECT closed by user ${peerId}; RELAY fallback`);
        return true;
    }
    close() {
        this.closed = true;
        for (const direct of this.connections.values()) {
            direct.stopOpening?.();
            direct.pc.close();
        }
        this.connections.clear();
        this.signals.clear();
    }
}
