import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer, type Server as HttpServer } from "node:http";
import jwt from "jsonwebtoken";
import { Server, type Socket } from "socket.io";
import { parseMessage, peerIdSchema, type Group } from "@ds01/shared";
import { guardSocket, serviceLog } from '../server-kit/runtime.ts';
loadEnv({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });
if (process.env.NODE_ENV === "production" &&
    (!process.env.PEER_SECRET || process.env.PEER_SECRET.length < 32 || process.env.PEER_SECRET.startsWith('replace-with-')))
    throw new Error("PEER_SECRET must be set to at least 32 characters in production");
type Reply = (response: {
    ok: boolean;
    error?: string;
}) => void;
export type DirectChatAuthorizer = (senderId: string, receiverId: string) => Promise<boolean>;
const SECRET = process.env.PEER_SECRET || "local-development-only-secret";
const accountPeerId = /^[a-f\d]{24}$/i;
const httpDirectChatAuthorizer: DirectChatAuthorizer = async (senderId, receiverId) => {
    if (!accountPeerId.test(senderId) || !accountPeerId.test(receiverId))
        return true;
    const base = process.env.API_INTERNAL_URL || "http://127.0.0.1:4000";
    const query = new URLSearchParams({ senderId, receiverId });
    const response = await fetch(`${base}/internal/direct-chat/authorize?${query.toString()}`, {
        headers: { "x-peer-secret": SECRET },
        signal: AbortSignal.timeout(2000),
    });
    if (!response.ok)
        throw new Error("direct chat authorization unavailable");
    const result = (await response.json()) as {
        allowed?: unknown;
    };
    return result.allowed === true;
};
export function createRelay(httpServer: HttpServer = createServer(), groupLookup?: (id: string) => Promise<Group | null>, authorizeDirect: DirectChatAuthorizer = httpDirectChatAuthorizer) {
    const app = express();
    const connections = new Map<string, Socket>();
    httpServer.on("request", app);
    const io = new Server(httpServer, {
        cors: { origin: "*" },
        maxHttpBufferSize: 8192,
    });
    app.get("/health", (_req, res) => res.json({ service: "relay", peers: connections.size }));
    const lookup = groupLookup ||
        (async (id: string) => {
            const url = process.env.SIGNAL_INTERNAL_URL || "http://127.0.0.1:4001";
            const response = await fetch(`${url}/internal/groups/${encodeURIComponent(id)}`, {
                headers: { "x-peer-secret": SECRET },
                signal: AbortSignal.timeout(2000),
            });
            return response.ok ? ((await response.json()) as Group) : null;
        });
    const authorizeSession = async (peerId: string, id: unknown) => {
        if (!peerId.startsWith('user_')) return;
        if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw Error('invalid account session');
        const base = process.env.SIGNAL_INTERNAL_URL || 'http://127.0.0.1:4001';
        const query = new URLSearchParams({ peerId, sessionId: id });
        const response = await fetch(`${base}/internal/sessions/authorize?${query}`, { headers: { 'x-peer-secret': SECRET }, signal: AbortSignal.timeout(2000) });
        if (!response.ok || (await response.json()).allowed !== true) throw Error('account session expired');
    };
    io.use(async (socket, next) => {
        try {
            const data = jwt.verify(String(socket.handshake.auth.token || ""), SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
            if (!peerIdSchema.safeParse(data.sub).success)
                throw new Error("invalid subject");
            socket.data.peerId = data.sub;
            await authorizeSession(String(data.sub), data.sid);
            socket.data.authSession = data.sid;
            socket.data.tokenExpiresAt = typeof data.exp === 'number' ? data.exp * 1000 : undefined;
            next();
        }
        catch {
            next(new Error("invalid peer token"));
        }
    });
    io.on("connection", (socket) => {
        guardSocket(socket, 'relay', ['relay:send']);
        const peerId = socket.data.peerId as string;
        const old = connections.get(peerId);
        old?.disconnect(true);
        connections.set(peerId, socket);
        serviceLog('relay', 'REGISTER', peerId);
        socket.on("relay:send", async (input: unknown, reply: Reply) => {
            if (typeof reply !== 'function')
                return;
            try {
                const msg = parseMessage(input);
                if (socket.data.tokenExpiresAt && socket.data.tokenExpiresAt <= Date.now()) throw Error('peer token expired');
                await authorizeSession(peerId, socket.data.authSession);
                if (msg.senderId !== peerId || msg.mode !== "RELAY")
                    throw new Error("sender or mode mismatch");
                if (msg.groupId) {
                    const group = await lookup(msg.groupId);
                    if (!group ||
                        group.archived ||
                        !group.members.includes(peerId) ||
                        !group.members.includes(msg.receiverId))
                        throw new Error("group access denied");
                }
                else if (!(await authorizeDirect(peerId, msg.receiverId)))
                    throw new Error("direct chat blocked");
                const target = connections.get(msg.receiverId);
                if (!target)
                    throw new Error("receiver offline");
                if (target.data.tokenExpiresAt && target.data.tokenExpiresAt <= Date.now()) throw Error('receiver session expired');
                await authorizeSession(msg.receiverId, target.data.authSession);
                target.emit("relay:receive", msg);
                serviceLog('relay', 'FORWARD', `${msg.messageId} ${peerId} -> ${msg.receiverId} ${msg.type} attempt=${msg.attempt}`);
                reply?.({ ok: true });
            }
            catch (error) {
                const message = error instanceof Error ? error.message : "invalid message";
                serviceLog('relay', 'REJECT', `${peerId}: ${message}`);
                reply?.({ ok: false, error: message });
            }
        });
        socket.on("disconnect", () => {
            if (connections.get(peerId)?.id === socket.id) {
                connections.delete(peerId);
                serviceLog('relay', 'DISCONNECT', peerId);
            }
        });
    });
    return {
        app,
        io,
        connections,
        httpServer,
        close: async () => {
            await new Promise<void>((resolve) => io.close(() => resolve()));
            await new Promise<void>((resolve) => httpServer.close(() => resolve()));
        },
    };
}
if (process.argv[1]?.endsWith("index.ts")) {
    const server = createRelay();
    server.httpServer.listen(Number(process.env.RELAY_PORT || 4002), "0.0.0.0", () => serviceLog('relay', 'LISTENING', String(process.env.RELAY_PORT || 4002)));
}
