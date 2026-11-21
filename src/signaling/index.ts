import { KeyDirectory } from './keyDirectory.ts';
import { GroupCalls } from './groupCalls.ts';
import { groupCallContextSchema } from '../shared/groupCallProtocol.ts';
import { peerIdSchema } from '@ds01/shared';
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer, type Server as HttpServer } from "node:http";
import { config as loadEnv } from "dotenv";
import { Server } from "socket.io";
import type { Group } from "@ds01/shared";
import { createHttpDirectChatAuthorizer } from "./directChatAuthorization.ts";
import { registerGroupHandlers } from "./groupHandlers.ts";
import { startSignalingMaintenance } from "./maintenance.ts";
import { registerPeerHandlers } from "./peerHandlers.ts";
import { httpProjectDirectory, type ProjectDirectory, } from "./projectDirectory.ts";
import type { DirectChatAuthorizer, SignalingContext } from "./types.ts";
import { registerWebRtcHandlers } from "./webrtcHandlers.ts";
import { AtomicState, guardSocket, serviceLog } from '../server-kit/runtime.ts';
import { persistedSignalSchema, type PersistedSignal } from './state.ts';
import { Accounts } from './accounts.ts';
import { registerAuthHandlers } from './authHandlers.ts';
export type { DirectChatAuthorizer } from "./types.ts";
loadEnv({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });
const HEARTBEAT_FRESH_MS = 30000;
const PEER_SECRET = process.env.PEER_SECRET || "local-development-only-secret";
const JWT_SECRET = process.env.JWT_SECRET || "local-development-only-secret";
if (process.env.NODE_ENV === "production" &&
    (!process.env.JWT_SECRET ||
        process.env.JWT_SECRET.length < 32 ||
        process.env.JWT_SECRET.startsWith('replace-with-') ||
        !process.env.PEER_SECRET ||
        process.env.PEER_SECRET.length < 32 || process.env.PEER_SECRET.startsWith('replace-with-')))
    throw new Error("JWT_SECRET and PEER_SECRET must each be at least 32 characters in production");
/** Builds the signaling control plane without starting a TCP listener. */
export function createSignaling(httpServer: HttpServer = createServer(), directory: ProjectDirectory = httpProjectDirectory(), authorizeDirect: DirectChatAuthorizer = createHttpDirectChatAuthorizer(PEER_SECRET), options: {
    statePath?: string;
    accountStatePath?: string;
    groupCallLeaseMs?: number;
} = {}) {
    const app = express();
    const accounts = new Accounts(options.accountStatePath || (options.statePath ? `${options.statePath}.accounts.json` : undefined));
    const keys = new KeyDirectory(options.statePath ? `${options.statePath}.keys.json` : undefined);
    const peers: SignalingContext["peers"] = new Map();
    const groups = new Map<string, Group>();
    const demoSecrets = new Map<string, string>();
    const state = new AtomicState<PersistedSignal>(options.statePath);
    const restored = state.read(value => persistedSignalSchema.parse(value));
    for (const [id, hash] of restored?.identities || [])
        demoSecrets.set(id, hash);
    for (const group of restored?.groups || [])
        groups.set(group.id, group);
    const save = () => state.write({ identities: [...demoSecrets], groups: [...groups.values()].filter(group => !group.projectId) });
    httpServer.on("request", app);
    const io = new Server(httpServer, {
        cors: { origin: "*" },
        maxHttpBufferSize: 16384,
        pingInterval: 10000,
        pingTimeout: 20000,
    });
    const publishGroup = (group: Group) => {
        const before = groups.get(group.id);
        if (before && before.version > group.version)
            return;
        groups.set(group.id, group);
        for (const peerId of new Set([
            ...(before?.members || []),
            ...group.members,
        ]))
            peers.get(peerId)?.socket.emit("group:update", group);
    };
    const currentGroup = async (id: string) => {
        const cached = groups.get(id);
        if (cached && !cached.projectId)
            return cached;
        const current = await directory.group(id);
        if (current)
            publishGroup(current);
        return current;
    };
    const publishPresence = () => {
        io.to('registered-peers').emit('presence', [...peers.keys()]);
        io.to('registered-peers').emit('peer:profiles', [...peers].map(([peerId, peer]) => ({ peerId, displayName: peer.displayName || peerId, online: true, lastSeen: peer.lastSeen })));
    };
    const context: SignalingContext = {
        accounts,
        io,
        peers,
        groups,
        demoSecrets,
        save,
        directory,
        authorizeDirect,
        peerSecret: PEER_SECRET,
        jwtSecret: JWT_SECRET,
        heartbeatFreshMs: HEARTBEAT_FRESH_MS,
        publishGroup,
        currentGroup,
        publishPresence,
        peerFor: (socket) => socket.data.authSession && !accounts.authorize(socket.data.peerId, socket.data.authSession) ? undefined : socket.data.peerId as string | undefined,
    };
    const groupCalls = new GroupCalls(context, options.groupCallLeaseMs);
    app.get('/internal/group-calls/authorize', (req, res) => {
        if (req.header('x-peer-secret') !== PEER_SECRET) return res.sendStatus(403);
        const scope = groupCallContextSchema.safeParse({ groupId: req.query.groupId, roomId: req.query.roomId });
        const sender = peerIdSchema.safeParse(req.query.senderId), receiver = peerIdSchema.safeParse(req.query.receiverId);
        return res.json({ allowed: scope.success && sender.success && receiver.success && groupCalls.allowed(sender.data, receiver.data, scope.data) });
    });
    app.get("/health", (_req, res) => res.json({ service: "signaling", peers: peers.size }));
    app.get('/internal/sessions/authorize', (req, res) => {
        if (req.header('x-peer-secret') !== PEER_SECRET) return res.sendStatus(403);
        return res.json({ allowed: typeof req.query.peerId === 'string' && accounts.authorize(req.query.peerId, req.query.sessionId) });
    });
    app.get("/internal/groups/:id", async (req, res) => {
        if (req.header("x-peer-secret") !== PEER_SECRET)
            return res.sendStatus(403);
        try {
            const group = await currentGroup(req.params.id);
            return group ? res.json(group) : res.sendStatus(404);
        }
        catch {
            return res
                .status(503)
                .json({ error: "project authorization unavailable" });
        }
    });
    io.on("connection", (socket) => {
        guardSocket(socket, 'signal', ['auth:register', 'auth:login', 'auth:session', 'auth:logout', 'peer:register', 'peer:list', 'peer:lookup', 'signal:send', 'key:publish', 'key:lookup', 'group-call:control', 'project:group', 'group:authorize', 'group:create', 'group:change']);
        keys.register(socket, context);
        groupCalls.register(socket);
        registerAuthHandlers(socket, accounts, context);
        registerPeerHandlers(socket, context);
        registerGroupHandlers(socket, context);
        registerWebRtcHandlers(socket, context, groupCalls);
    });
    const stopMaintenance = startSignalingMaintenance(context);
    return {
        app,
        io,
        peers,
        groups,
        httpServer,
        close: async () => {
            stopMaintenance();
            groupCalls.close();
            await new Promise<void>((resolve) => io.close(() => resolve()));
            await new Promise<void>((resolve) => httpServer.close(() => resolve()));
        },
    };
}
if (process.argv[1]?.endsWith("index.ts")) {
    const server = createSignaling(undefined, undefined, undefined, { statePath: process.env.SIGNAL_STATE_PATH || fileURLToPath(new URL('../../.data/signaling.json', import.meta.url)), accountStatePath: process.env.ACCOUNT_STATE_PATH });
    server.httpServer.listen(Number(process.env.SIGNAL_PORT || 4001), "0.0.0.0", () => serviceLog('signal', 'LISTENING', String(process.env.SIGNAL_PORT || 4001)));
}
