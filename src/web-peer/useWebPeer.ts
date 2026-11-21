import type { CallState } from '../shared/media.ts';
import type { GroupCallState, GroupCallRoom } from '../shared/groupCallProtocol.ts';
import { privateCallRecord, groupCallRecord, type CallRecord } from './callHistory.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PeerClient, isDirectMessageBetween, peerIdSchema, type Group, type StoredMessage, type PeerEvent, type PeerProfile, type ChatAttachment, type DirectChatContact } from '@ds01/shared';
import { WebStore } from './store.ts';
import { authRequest, sessionKey, type LoginSession } from './auth.ts';
const signalUrl = import.meta.env.VITE_SIGNAL_URL || 'http://localhost:4001';
const relayUrl = import.meta.env.VITE_RELAY_URL || 'http://localhost:4002';
const relayUrls = String(import.meta.env.VITE_RELAY_URLS || '').split(',').map(value => value.trim()).filter(Boolean);
const initialId = localStorage.getItem('ds01-peer-id') || '';
const initialConnection: NonNullable<PeerEvent['connection']> = { signaling: 'offline', relays: 0 };
function secretFor(id: string) { const key = `ds01-peer-secret-${id}`; const previous = localStorage.getItem(key) || (localStorage.getItem('ds01-peer-id') === id ? localStorage.getItem('ds01-peer-secret') : null); const secret = previous || crypto.randomUUID() + crypto.randomUUID(); localStorage.setItem(key, secret); return secret; }
export function saveDownload(name: string, blob: Blob) { const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export function useWebPeer() {
    const [peerId, setPeerId] = useState(initialId), [displayName, setDisplayName] = useState(localStorage.getItem('ds01-display-name') || '');
    const [connection, setConnection] = useState(initialConnection), [hasSession, setHasSession] = useState(false), [connecting, setConnecting] = useState(false);
    const [online, setOnline] = useState<string[]>([]), [profiles, setProfiles] = useState<PeerProfile[]>([]), [contacts, setContacts] = useState<DirectChatContact[]>([]), [groups, setGroups] = useState<Group[]>([]);
    const [target, setTarget] = useState(''), [groupTarget, setGroupTarget] = useState(''), [body, setBody] = useState(''), [forceRelay, setForceRelay] = useState(false);
    const [modes, setModes] = useState<Record<string, string>>({}), [messages, setMessages] = useState<StoredMessage[]>([]), [logs, setLogs] = useState<string[]>([]), [error, setError] = useState(''), [sending, setSending] = useState(false), [blocked, setBlocked] = useState<string[]>([]);
    const [transfers, setTransfers] = useState<NonNullable<PeerEvent['transfer']>[]>([]);
    const [accountSession, setAccountSession] = useState<LoginSession | null>(null), [authBusy, setAuthBusy] = useState(!!sessionStorage.getItem(sessionKey));
    const [call, setCall] = useState<CallState>(), [groupCall, setGroupCall] = useState<GroupCallState>(), [groupCalls, setGroupCalls] = useState<GroupCallRoom[]>([]), [callStarting, setCallStarting] = useState(false), [calls, setCalls] = useState<CallRecord[]>([]);
    const accountRef = useRef<LoginSession | null>(null);
    const client = useRef<PeerClient | null>(null), store = useRef(new WebStore(initialId)), generation = useRef(0);
    const refresh = useCallback(async () => {
        const active = store.current;
        try {
            const [rows, savedContacts, blockedPeers] = await Promise.all([active.list(), active.listDirectContacts(), active.listDirectBlocked()]);
            if (active !== store.current)
                return;
            setMessages(rows); setCalls(active.listCalls());
            setContacts(savedContacts);
            setBlocked(blockedPeers);
        }
        catch (error) {
            setError(String(error));
        }
    }, []);
    useEffect(() => {
        let disposed = false;
        const saved = sessionStorage.getItem(sessionKey);
        if (saved) void (async () => {
            try {
                const token: unknown = JSON.parse(saved).token;
                const response = await authRequest(signalUrl, 'auth:session', { token });
                if (!disposed && typeof token === 'string' && response.account && response.expiresAt)
                    await connect({ account: response.account, token, expiresAt: response.expiresAt });
            } catch (error) {
                if (!disposed) { sessionStorage.removeItem(sessionKey); setError(String(error)); }
            } finally { if (!disposed) setAuthBusy(false); }
        })();
        return () => { disposed = true; generation.current++; client.current?.close(); };
    }, []);
    const log = (text: string) => setLogs(current => [`${new Date().toISOString()} ${text}`, ...current].slice(0, 250));
    const connect = async (identity?: LoginSession) => {
        const session = identity || accountRef.current;
        const activeId = session?.account.peerId || peerId, activeName = session?.account.displayName || displayName;
        if (session) { accountRef.current = session; setAccountSession(session); setPeerId(activeId); setDisplayName(activeName); sessionStorage.setItem(sessionKey, JSON.stringify(session)); }
        setError('');
        setConnecting(true);
        const version = ++generation.current;
        client.current?.close();
        client.current = null;
        setConnection({ ...initialConnection, signaling: 'connecting' });
        setOnline([]);
        setProfiles([]);
        setModes({});
        setTransfers([]); setCall(undefined); setGroupCall(undefined); setGroupCalls([]); setCalls([]);
        try {
            peerIdSchema.parse(activeId);
            if (!activeName.trim() || activeName.trim().length > 80)
                throw new Error('Nhập tên hiển thị từ 1 đến 80 ký tự');
            const iceServers: RTCIceServer[] | undefined = import.meta.env.VITE_ICE_SERVERS ? JSON.parse(import.meta.env.VITE_ICE_SERVERS) : undefined;
            if (iceServers && (!Array.isArray(iceServers) || iceServers.some(server => !server?.urls)))
                throw new Error('Cấu hình ICE servers không hợp lệ');
            store.current = new WebStore(activeId);
            store.current.recoverCalls();
            await refresh();
            const peer = new PeerClient({ peerId: activeId, displayName: activeName.trim(), identityProof: session?.token || secretFor(activeId), signalUrl, relayUrl, relayUrls, iceServers, rtc: RTCPeerConnection, store: store.current, identityStore: store.current, forceRelay,
                onEvent: event => {
                    if (generation.current !== version)
                        return;
                    if (event.kind === 'auth-expired') {
                        resetSession();
                        setError('Phiên đăng nhập đã hết hạn hoặc đã đăng xuất. Hãy đăng nhập lại.');
                        return;
                    }
                    if (event.kind === 'call' && event.call) { setCall(event.call); const record = privateCallRecord(event.call); if (record) store.current.putCall(record); setCalls(store.current.listCalls()); }
                    if (event.kind === 'group-call') { setGroupCall(event.groupCall); setGroupCalls(event.groupCalls || []); if (event.groupCall) { const record = groupCallRecord(event.groupCall); if (record) store.current.putCall(record); setCalls(store.current.listCalls()); } }
                    if (event.kind === 'connection' && event.connection) {
                        setConnection(event.connection);
                        if (event.connection.signaling === 'online')
                            setGroups(peer.getGroups());
                    }
                    if (event.kind === 'presence') {
                        if (event.peers)
                            setOnline(event.peers);
                        if (event.profiles) {
                            setProfiles(event.profiles);
                            for (const profile of event.profiles)
                                if (profile.peerId !== activeId)
                                    void store.current.saveDirectContact({ peerId: profile.peerId, name: profile.displayName, email: '', updatedAt: Date.now() }).then(refresh).catch(error => setError(String(error)));
                        }
                    }
                    if (event.kind === 'group' && event.group) {
                        setGroups(current => [...current.filter(group => group.id !== event.group!.id), event.group!]);
                        try {
                            const key = `ds01-group-names-${activeId}`;
                            const names = JSON.parse(localStorage.getItem(key) || '{}');
                            names[event.group.id] = event.group.name || `Nhóm ${event.group.id.slice(0, 8)}`;
                            localStorage.setItem(key, JSON.stringify(names));
                        }
                        catch (error) {
                            setError(String(error));
                        }
                    }
                    if (event.kind === 'mode' && event.peerId)
                        setModes(current => ({ ...current, [event.peerId!]: event.mode! }));
                    if (event.kind === 'message')
                        void refresh();
                    if (event.kind === 'log')
                        log(`[${activeId}] ${event.text}`);
                    if (event.kind === 'transfer' && event.transfer)
                        setTransfers(current => [...current.filter(item => item.id !== event.transfer!.id), event.transfer!].slice(-8));
                } });
            client.current = peer;
            await peer.connect();
            if (generation.current !== version)
                return;
            setHasSession(true);
            localStorage.setItem('ds01-peer-id', activeId);
            localStorage.setItem('ds01-display-name', activeName.trim());
            setGroups(peer.getGroups());
            void refresh();
        }
        catch (error) {
            if (generation.current === version) {
                client.current?.close();
                client.current = null;
                setHasSession(false);
                setConnection(initialConnection);
                setError(String(error));
            }
        }
        finally {
            if (generation.current === version)
                setConnecting(false);
        }
    };
    const resetSession = () => {
        generation.current++; client.current?.close(); client.current = null;
        accountRef.current = null; setAccountSession(null); sessionStorage.removeItem(sessionKey);
        setHasSession(false); setConnecting(false); setSending(false); setConnection(initialConnection); setOnline([]); setProfiles([]);
        setMessages([]); setContacts([]); setGroups([]); setBlocked([]); setTransfers([]); setModes({});
        setCall(undefined); setGroupCall(undefined); setGroupCalls([]); setCallStarting(false); setCalls([]);
        setTarget(''); setGroupTarget(''); setBody(''); setLogs([]); setPeerId(''); setDisplayName('');
        store.current = new WebStore('');
    };
    const disconnect = async () => {
        setAuthBusy(true);
        try {
            if (client.current?.media.isActive()) await client.current.media.end();
            if (client.current?.groupMedia.isActive()) await client.current.groupMedia.leave();
            if (accountRef.current) await authRequest(signalUrl, 'auth:logout', { token: accountRef.current.token });
            resetSession();
            setError('');
        } catch (error) { setError(`Chưa đăng xuất được trên máy chủ. Hãy thử lại khi có mạng. ${String(error)}`); }
        finally { setAuthBusy(false); }
    };
    const authenticate = async (mode: 'login' | 'register', username: string, password: string, name: string) => {
        setAuthBusy(true); setError('');
        try {
            const response = await authRequest(signalUrl, `auth:${mode}`, { username, password, ...(mode === 'register' ? { displayName: name } : {}) });
            if (mode === 'login' && response.account && response.token && response.expiresAt)
                await connect({ account: response.account, token: response.token, expiresAt: response.expiresAt });
            return mode === 'register';
        } catch (error) { setError(String(error)); return false; }
        finally { setAuthBusy(false); }
    };
    useEffect(() => {
        if (!accountSession) return;
        const timer = setTimeout(() => { resetSession(); setError('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.'); }, Math.max(0, accountSession.expiresAt - Date.now()));
        return () => clearTimeout(timer);
    }, [accountSession]);
    const send = async () => {
        if (sending || !body.trim())
            return;
        const text = body;
        setError('');
        setSending(true);
        try {
            if (!client.current || !hasSession)
                throw new Error('Hãy kết nối trước khi gửi');
            if (groupTarget) {
                const result = await client.current.sendGroup(groupTarget, text);
                const failed = Object.entries(result).filter(([, status]) => status === 'rejected');
                if (failed.length)
                    setError(`Chưa giao được tới: ${failed.map(([id]) => id).join(', ')}`);
            }
            else
                await client.current.sendDirect(target, text);
            setBody('');
        }
        catch (error) {
            setError(String(error));
        }
        finally {
            setSending(false);
            void refresh();
        }
    };
    const createGroup = async (name: string, members: string) => {
        if (!client.current)
            throw new Error('Hãy kết nối trước');
        const group = await client.current.createGroup(members.split(',').map(value => value.trim()).filter(Boolean), name);
        setGroupTarget(group.id);
        setTarget('');
        return group;
    };
    const changeGroup = async (memberId: string, action: 'add' | 'remove') => {
        try {
            if (!client.current)
                throw new Error('Hãy kết nối trước');
            await client.current.changeGroup(groupTarget, memberId, action);
        }
        catch (error) {
            setError(String(error));
        }
    };
    const openPeer = async (id: string) => {
        peerIdSchema.parse(id);
        if (id === peerId)
            throw new Error('Chọn một peer khác');
        if (client.current && connection.signaling === 'online')
            await client.current.lookupPeer(id);
        await store.current.saveDirectContact({ peerId: id, name: profiles.find(profile => profile.peerId === id)?.displayName || contacts.find(contact => contact.peerId === id)?.name || id, email: '', updatedAt: Date.now() });
        setTarget(id);
        setGroupTarget('');
        await refresh();
    };
    const toggleForceRelay = (value: boolean) => {
        setForceRelay(value);
        if (client.current)
            client.current.forceRelay = value;
    };
    const retry = async (row: StoredMessage) => {
        try {
            if (!client.current)
                throw new Error('Hãy kết nối trước');
            setSending(true);
            await client.current.retry(row.message.messageId, row.message.receiverId);
        }
        catch (error) {
            setError(String(error));
        }
        finally {
            setSending(false);
            void refresh();
        }
    };
    const sendFile = async (file: File) => {
        try {
            if (!client.current || !target || groupTarget)
                throw new Error('Chọn hội thoại cá nhân để gửi file');
            setSending(true);
            setError('');
            if (file.size > 512 * 1024)
                throw new Error('File tối đa 512 KiB');
            await client.current.sendFile(target, file.name, file.type, new Uint8Array(await file.arrayBuffer()));
        }
        catch (error) {
            setError(String(error));
        }
        finally {
            setSending(false);
            void refresh();
        }
    };
    const downloadFile = async (file: ChatAttachment) => {
        try {
            const saved = await store.current.getFile(file.id);
            if (!saved)
                throw new Error('File không còn trên thiết bị này. Hãy nhờ người gửi gửi lại.');
            saveDownload(file.name, new Blob([new Uint8Array(saved.data).buffer], { type: 'application/octet-stream' }));
        }
        catch (error) {
            setError(String(error));
        }
    };
    const toggleBlock = async () => {
        if (!target)
            return;
        try {
            await store.current.setDirectBlocked(target, !blocked.includes(target));
            await refresh();
        }
        catch (error) {
            setError(String(error));
        }
    };
    const deleteHistory = async () => {
        if (!target)
            return;
        try {
            await store.current.deleteDirect(target);
            await refresh();
        }
        catch (error) {
            setError(String(error));
        }
    };
    const visible = messages.filter(row => groupTarget ? row.message.groupId === groupTarget : isDirectMessageBetween(row.message, peerId, target));
    const exportHistory = () => saveDownload(`ds01-${groupTarget || target || peerId}.json`, new Blob([JSON.stringify(visible, null, 2)], { type: 'application/json' }));
    const exportLogs = () => saveDownload('ds01-peer-log.txt', new Blob([logs.slice().reverse().join('\n')], { type: 'text/plain' }));
    const startCall = async (kind: 'audio' | 'video') => {
        setCallStarting(true);
        try {
            if (!client.current || !target && !groupTarget) throw Error('Chọn cuộc trò chuyện để gọi.');
            if (groupTarget) await client.current.groupMedia.start(groupTarget, kind); else await client.current.media.start(target, kind);
        } catch (error) { setError(String(error)); } finally { setCallStarting(false); }
    };
    const joinGroupCall = async (roomId: string) => { setCallStarting(true); try { await client.current?.groupMedia.join(roomId); } catch (error) { setError(String(error)); } finally { setCallStarting(false); } };
    const leaveGroupCall = async () => { await client.current?.groupMedia.leave(); };
    const muteGroupCall = (kind: 'audio' | 'video', muted: boolean) => client.current?.groupMedia.mute(kind, muted);
    const resumeGroupAudio = () => client.current?.groupMedia.resumeAudio();
    const dismissGroupCall = () => client.current?.groupMedia.dismiss();
    const callBusy = callStarting || !!call && !['ended', 'failed'].includes(call.phase) || groupCall?.phase === 'active' || groupCall?.phase === 'joining';
    const acceptCall = async () => { try { await client.current?.media.accept(); } catch (error) { setError(String(error)); } };
    const endCall = async () => { await client.current?.media.end(); };
    const muteCall = (kind: 'audio' | 'video', muted: boolean) => client.current?.media.mute(kind, muted);
    const resumeCallAudio = () => client.current?.media.resumeAudio();
    const knownPeers = [...new Set([...online, ...contacts.map(contact => contact.peerId), ...messages.flatMap(row => row.message.groupId ? [] : [row.message.senderId, row.message.receiverId])])].filter(id => id !== peerId);
    const nameOf = (id: string) => profiles.find(profile => profile.peerId === id)?.displayName || contacts.find(contact => contact.peerId === id)?.name || (id === peerId ? displayName : id);
    let names: Record<string, string> = {};
    try {
        names = JSON.parse(localStorage.getItem(`ds01-group-names-${peerId}`) || '{}');
    }
    catch { /* Preserve damaged data for manual export. */ }
    const historyGroups = [...new Set(messages.map(row => row.message.groupId).filter((id): id is string => !!id))].filter(id => !groups.some(group => group.id === id)).map(id => ({ id, name: names[id] || `Nhóm ${id.slice(0, 8)}`, ownerId: peerId, members: [], version: 0, archived: true } as Group));
    return { call, groupCall, groupCalls, callBusy, calls, joinGroupCall, leaveGroupCall, muteGroupCall, resumeGroupAudio, dismissGroupCall, startCall, acceptCall, endCall, muteCall, resumeCallAudio, dismissCall: () => setCall(undefined), peerId, setPeerId, displayName, setDisplayName, accountSession, authBusy, authenticate, connection, hasSession, connecting, connected: connection.signaling === 'online', online, groups: [...groups, ...historyGroups], target, setTarget, groupTarget, setGroupTarget, body, setBody, forceRelay, modes, messages, visible, logs, error, setError, sending, blocked, transfers, knownPeers, nameOf, connect, disconnect, send, createGroup, changeGroup, openPeer, toggleForceRelay, retry, sendFile, downloadFile, toggleBlock, deleteHistory, exportHistory, exportLogs, signalUrl, relayUrls: [relayUrl, ...relayUrls] };
}
