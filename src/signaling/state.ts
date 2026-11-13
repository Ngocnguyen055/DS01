import { z } from 'zod';
import { idSchema, peerIdSchema } from '@ds01/shared';
export const persistedSignalSchema = z.object({
    identities: z.array(z.tuple([peerIdSchema, z.string().regex(/^[a-f0-9]{64}$/)])),
    groups: z.array(z.object({
        id: idSchema, ownerId: peerIdSchema, members: z.array(peerIdSchema).max(16),
        version: z.number().int().positive(), name: z.string().min(1).max(80).optional(),
        archived: z.boolean().optional(),
    }).refine(group => group.archived || group.members.includes(group.ownerId), 'owner must be a member')),
});
export type PersistedSignal = z.infer<typeof persistedSignalSchema>;
