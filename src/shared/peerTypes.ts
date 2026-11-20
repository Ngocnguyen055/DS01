import type { ChatAttachment, ChatMessage, DeliveryMode, Group, PeerProfile } from "./protocol.ts";
export type MessageStatus = "pending" | "sent" | "forwarded" | "queued" | "delivered" | "failed" | "received";
export type StoredMessage = {
    message: ChatMessage;
    status: MessageStatus;
    queuedUntil?: number;
};
export type DirectChatContact = {
    peerId: string;
    name: string;
    email: string;
    updatedAt: number;
};
/** Persistence boundary implemented by SQLite on mobile and localStorage on web. */
export interface ChatStore {
    put(row: StoredMessage): Promise<void>;
    mark(messageId: string, receiverId: string, status: MessageStatus): Promise<void>;
    has(messageId: string, senderId: string): Promise<boolean>;
    list(): Promise<StoredMessage[]>;
    /** Reject an already-open direct channel after the local user blocks a peer. */
    isDirectBlocked?(peerId: string): Promise<boolean>;
    putFile?(file: ChatAttachment, data: Uint8Array): Promise<void>;
    getFile?(fileId: string): Promise<{
        file: ChatAttachment;
        data: Uint8Array;
    } | undefined>;
}
export interface DirectChatStore extends ChatStore {
    putDirect(row: StoredMessage): Promise<void>;
    listDirect(peerId: string): Promise<StoredMessage[]>;
    listDirectAttachments(peerId: string): Promise<StoredMessage[]>;
    deleteDirect(peerId: string): Promise<void>;
    setDirectBlocked(peerId: string, blocked: boolean): Promise<void>;
    isDirectBlocked(peerId: string): Promise<boolean>;
    listDirectBlocked(): Promise<string[]>;
    saveDirectContact(contact: DirectChatContact): Promise<void>;
    listDirectContacts(): Promise<DirectChatContact[]>;
    removeDirectContact(peerId: string): Promise<void>;
}
export type RTCFactory = new (config: RTCConfiguration) => RTCPeerConnection;
export type PeerEvent = {
    kind: "message" | "presence" | "group" | "mode" | "log" | "connection" | "transfer" | "auth-expired";
    message?: StoredMessage;
    peers?: string[];
    group?: Group;
    peerId?: string;
    mode?: DeliveryMode;
    text?: string;
    profiles?: PeerProfile[];
    connection?: {
        signaling: 'connecting' | 'online' | 'reconnecting' | 'offline';
        relays: number;
        activeRelay?: string;
    };
    transfer?: {
        id: string;
        name: string;
        peerId: string;
        direction: 'send' | 'receive';
        progress: number;
        status: 'transferring' | 'complete' | 'failed';
        error?: string;
    };
};
export type PeerConfig = {
    peerId: string;
    displayName?: string;
    identityProof: string;
    signalUrl: string;
    relayUrl: string;
    relayUrls?: string[];
    rtc: RTCFactory;
    store: ChatStore;
    forceRelay?: boolean;
    iceServers?: RTCIceServer[];
    directTimeoutMs?: number;
    ackTimeoutMs?: number;
    requestTimeoutMs?: number;
    rtcPolicy?: RTCIceTransportPolicy;
    onEvent: (event: PeerEvent) => void;
};
