import type { Socket } from "socket.io";
import { peerIdSchema } from "@ds01/shared";
import { z } from 'zod';
import type { SignalingContext, SignalingReply } from "./types.ts";
import { serviceLog } from '../server-kit/runtime.ts';
const sdp = (type: 'offer' | 'answer') => z.object({ type: z.literal(type), sdp: z.string().max(12000) }).strict();
const signalSchema = z.discriminatedUnion('kind', [
    z.object({ to: peerIdSchema, kind: z.literal('request'), data: z.null() }).strict(),
    z.object({ to: peerIdSchema, kind: z.literal('offer'), data: sdp('offer') }).strict(),
    z.object({ to: peerIdSchema, kind: z.literal('answer'), data: sdp('answer') }).strict(),
    z.object({ to: peerIdSchema, kind: z.literal('ice'), data: z.object({
        candidate: z.string().max(4000), sdpMid: z.string().max(256).nullish(),
        sdpMLineIndex: z.number().int().min(0).max(65535).nullish(), usernameFragment: z.string().max(256).nullish(),
    }).strict() }).strict(),
]);

export function registerWebRtcHandlers(socket: Socket, context: SignalingContext) {
    socket.on("signal:send", async (input: unknown, reply: SignalingReply) => {
        if (typeof reply !== 'function')
            return;
        const senderId = context.peerFor(socket);
        const parsed = signalSchema.safeParse(input);
        if (!senderId ||
            context.peers.get(senderId)?.socket.id !== socket.id ||
            !parsed.success || Buffer.byteLength(JSON.stringify(parsed.data), 'utf8') > 12000)
            return reply?.({ ok: false, error: "invalid signaling data" });
        const value = parsed.data;
        try {
            if (!(await context.authorizeDirect(senderId, String(value.to))))
                return reply?.({ ok: false, error: "direct chat blocked" });
        }
        catch {
            return reply?.({
                ok: false,
                error: "direct chat authorization unavailable",
            });
        }
        if (context.peerFor(socket) !== senderId)
            return reply({ ok: false, error: 'registration required' });
        const target = context.peers.get(String(value.to));
        if (!target || !target.socket.connected)
            return reply?.({ ok: false, error: "peer offline" });
        target.socket.emit("signal:receive", {
            from: senderId,
            kind: value.kind,
            data: value.data,
        });
        serviceLog('signal', String(value.kind), `${senderId} -> ${value.to}`);
        reply?.({ ok: true });
    });
}
