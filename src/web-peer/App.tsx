import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { StoredMessage } from '@ds01/shared';
import { useWebPeer } from './useWebPeer.ts';
import { AuthPanel } from './AuthPanel.tsx';
const paths: Record<string, string> = { chat: 'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z', search: 'm21 21-4.5-4.5M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0', plus: 'M12 5v14M5 12h14', send: 'm22 2-7 20-4-9-9-4 20-7ZM22 2 11 13', link: 'M10 13a5 5 0 0 0 7 .1l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.1l-3 3a5 5 0 0 0 7 7l2-2', users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0', arrow: 'm12 19-7-7 7-7M5 12h14', file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6M8 15h8M8 18h5', download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3', info: 'M12 16v-4M12 8h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', close: 'm18 6-12 12M6 6l12 12', check: 'm4 12 5 5L20 6', signal: 'M4 20v-4M9 20v-8M14 20V8M19 20V4', refresh: 'M20 7v5h-5M4 17v-5h5M6.1 6.1a8 8 0 0 1 13.2 3M4.7 14.9a8 8 0 0 0 13.2 3', moon: 'M21 12.8A9 9 0 0 1 11.2 3 9 9 0 1 0 21 12.8', shield: 'm12 3 8 4v6c0 5-8 8-8 8s-8-3-8-8V7l8-4', logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9', dots: 'M5 12h.01M12 12h.01M19 12h.01' };
function Icon({ name, size = 20 }: {
    name: string;
    size?: number;
}) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.chat}/></svg>; }
function Avatar({ name, online, group = false }: {
    name: string;
    online?: boolean;
    group?: boolean;
}) { return <span className={`avatar ${group ? 'group-avatar' : ''}`}>{group ? <Icon name="users"/> : name.slice(0, 2).toLocaleUpperCase()}{online !== undefined && <i className={online ? 'online' : ''}/>}</span>; }
const statusLabel: Record<string, string> = { pending: 'Đang chuẩn bị', sent: 'Đang chờ nhận', delivered: 'Đã nhận', failed: 'Chưa gửi được', received: 'Đã nhận' };
const connectionLabel = { offline: 'Chưa kết nối', connecting: 'Đang kết nối', reconnecting: 'Đang kết nối lại', online: 'Đang trực tuyến' };
const clock = (time: number) => new Date(time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
export function App() {
    const p = useWebPeer();
    const [search, setSearch] = useState(''), [showInspector, setShowInspector] = useState(false), [showDiagnostics, setShowDiagnostics] = useState(false), [dialog, setDialog] = useState<'group' | 'peer' | null>(null), [mobileChat, setMobileChat] = useState(false);
    const [groupName, setGroupName] = useState(''), [memberText, setMemberText] = useState(''), [dialogError, setDialogError] = useState(''), [theme, setTheme] = useState(localStorage.getItem('ds01-theme') || 'light');
    const end = useRef<HTMLDivElement>(null), fileInput = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (!dialog && !showDiagnostics)
            return;
        const previous = document.activeElement as HTMLElement | null;
        const modal = document.querySelector<HTMLElement>('[role="dialog"]');
        if (!modal)
            return;
        const items = () => Array.from(modal.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href]')).filter(item => item.getClientRects().length > 0);
        if (!modal.contains(document.activeElement))
            items()[0]?.focus();
        const trap = (event: KeyboardEvent) => { if (event.key !== 'Tab')
            return; const focusable = items(); const first = focusable[0], last = focusable.at(-1); if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
        }
        else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
        } };
        modal.addEventListener('keydown', trap);
        return () => { modal.removeEventListener('keydown', trap); if (previous?.isConnected)
            previous.focus(); };
    }, [dialog, showDiagnostics]);
    useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('ds01-theme', theme); }, [theme]);
    useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [p.visible.length, p.target, p.groupTarget]);
    useEffect(() => {
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setDialog(null);
                setShowDiagnostics(false);
                setShowInspector(false);
            }
        };
        document.addEventListener('keydown', escape);
        return () => document.removeEventListener('keydown', escape);
    }, []);
    const group = p.groups.find(group => group.id === p.groupTarget), selected = !!(p.target || p.groupTarget), title = group?.name || (p.groupTarget ? `Nhóm ${p.groupTarget.slice(0, 8)}` : p.nameOf(p.target));
    const canWrite = p.hasSession && selected && !p.blocked.includes(p.target) && (!p.groupTarget || !!group?.members.includes(p.peerId) && !group.archived);
    const openPeer = (id: string) => { p.setTarget(id); p.setGroupTarget(''); setMobileChat(true); };
    const bubbles: {
        rows: StoredMessage[];
        key: string;
    }[] = [];
    for (const row of p.visible) {
        const key = `${row.message.senderId}:${row.message.messageId}`;
        const prior = bubbles.find(bubble => bubble.key === key);
        if (prior)
            prior.rows.push(row);
        else
            bubbles.push({ key, rows: [row] });
    }
    const submitDialog = async (event: FormEvent) => {
        event.preventDefault();
        setDialogError('');
        try {
            if (dialog === 'group')
                await p.createGroup(groupName.trim() || 'Nhóm mới', memberText);
            else
                await p.openPeer(memberText.trim());
            setDialog(null);
            setGroupName('');
            setMemberText('');
            setMobileChat(true);
        }
        catch (error) {
            setDialogError(String(error));
        }
    };
    const openDialog = (value: 'group' | 'peer') => { setDialog(value); setMemberText(''); setGroupName(''); setDialogError(''); };
    const preview = (id: string) => { const last = p.messages.filter(row => !row.message.groupId && (row.message.senderId === id || row.message.receiverId === id)).at(-1); return last?.message.type === 'attachment' ? 'File đính kèm' : last?.message.body || (p.online.includes(id) ? 'Sẵn sàng trò chuyện' : 'Lịch sử trên thiết bị này'); };
    return <div className={`workspace ${mobileChat ? 'mobile-chat' : ''}`}>
    <aside className="sidebar">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); setMobileChat(false); }}><span className="brand-mark"><Icon name="chat" size={23}/></span><span>DS01 P2P Chat</span><span className="edition">DS01</span></a>
      <div className="sidebar-heading"><div><span className="eyebrow">KHÔNG GIAN CỦA BẠN</span><h1>Cuộc trò chuyện</h1></div><button className="icon-button filled" aria-label="Mở hội thoại mới" onClick={() => openDialog('peer')}><Icon name="plus"/></button></div>
      <label className="search"><Icon name="search" size={18}/><input aria-label="Tìm hội thoại" placeholder="Tìm người hoặc nhóm…" value={search} onChange={event => setSearch(event.target.value)}/></label>
      <div className="list-heading"><span>TIN NHẮN <b>{p.knownPeers.length}</b></span><button onClick={() => openDialog('peer')} aria-label="Thêm liên hệ"><Icon name="plus" size={16}/></button></div>
      <nav className="conversation-list" aria-label="Danh sách hội thoại">
        {p.knownPeers.filter(id => `${id} ${p.nameOf(id)}`.toLowerCase().includes(search.toLowerCase())).map(id => <button key={id} className={`conversation ${p.target === id && !p.groupTarget ? 'selected' : ''}`} onClick={() => openPeer(id)}><Avatar name={p.nameOf(id)} online={p.online.includes(id)}/><span className="conversation-copy"><strong>{p.nameOf(id)}</strong><small>{preview(id)}</small></span>{p.blocked.includes(id) ? <Icon name="shield" size={15}/> : p.modes[id] === 'DIRECT' ? <span className="tiny-direct" title="Kết nối trực tiếp"/> : null}</button>)}
        {!p.knownPeers.length && <p className="sidebar-empty">Kết nối để khám phá các peer.<br />Hội thoại sẽ xuất hiện ở đây.</p>}
        <div className="list-heading groups-heading"><span>NHÓM <b>{p.groups.length}</b></span><button onClick={() => openDialog('group')} aria-label="Tạo nhóm"><Icon name="plus" size={16}/></button></div>
        {p.groups.filter(group => `${group.name || ''} ${group.id}`.toLowerCase().includes(search.toLowerCase())).map(group => <button key={group.id} className={`conversation ${p.groupTarget === group.id ? 'selected' : ''}`} onClick={() => { p.setGroupTarget(group.id); p.setTarget(''); setMobileChat(true); }}><Avatar name="" group/><span className="conversation-copy"><strong>{group.name || `Nhóm ${group.id.slice(0, 8)}`}</strong><small>{group.members.includes(p.peerId) ? `${group.members.length} thành viên` : 'Bạn đã rời nhóm'}</small></span></button>)}
      </nav>
      <button className="diagnostics-link" onClick={() => setShowDiagnostics(true)}><Icon name="signal" size={18}/><span>Tình trạng kết nối</span><span className={`status-dot ${p.connected ? 'live' : ''}`}/></button>
      <div className={`self-profile ${p.hasSession ? '' : 'guest-profile'}`}>{p.hasSession && <><Avatar name={p.displayName} online={p.connected}/><span><strong>{p.displayName}</strong><small>{p.peerId}</small></span></>}<button className="icon-button" aria-label="Đổi giao diện sáng tối" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name="moon" size={18}/></button></div>
    </aside>
    <main className="main-panel">
      <header className="topbar"><div className="breadcrumb"><span>Workspace</span><span>/</span><strong>{selected ? 'Tin nhắn' : 'Chào mừng'}</strong></div><div className="topbar-actions"><span className={`connection-pill ${p.connected ? 'is-online' : ''}`}><i />{connectionLabel[p.connection.signaling]}</span>{p.hasSession && <button className="icon-button" aria-label="Đăng xuất" disabled={p.authBusy} onClick={() => void p.disconnect()}><Icon name="logout" size={18}/></button>}</div></header>
      {p.error && <div className="error-banner" role="alert"><Icon name="info" size={18}/><span>{p.error}</span><button className="icon-button" aria-label="Đóng thông báo" onClick={() => p.setError('')}><Icon name="close" size={16}/></button></div>}
      {!p.hasSession && <section className="welcome"><div className="welcome-intro"><span className="welcome-tag"><i /> KẾT NỐI TRỰC TIẾP. GẦN NHAU HƠN.</span><h2>Mỗi kết nối,<br />một <em>cuộc trò chuyện.</em></h2><p>Một không gian nhẹ nhàng cho tin nhắn, nhóm học tập và những file cần chia sẻ. Đăng nhập để kết nối với nhóm và bắt đầu trò chuyện.</p><div className="welcome-features"><span><Icon name="link" size={17}/> P2P ưu tiên trực tiếp</span><span><Icon name="file" size={17}/> Chia sẻ file</span><span><Icon name="users" size={17}/> Trò chuyện nhóm</span></div><div className="network-illustration" aria-hidden="true"><div className="network-line one"/><div className="network-line two"/><div className="network-line three"/><div className="network-node node-a">A<span>Đã kết nối</span></div><div className="network-node node-b"><Icon name="chat" size={30}/></div><div className="network-node node-c">B<span>Xin chào!</span></div><div className="network-node node-d">C</div><span className="network-label">a little closer, peer to peer.</span></div></div>
        <AuthPanel peer={p}/>
      </section>}
      {p.hasSession && !selected && <section className="empty-chat"><div className="empty-art"><Icon name="chat" size={42}/><i /><i /></div><span className="eyebrow">KHỞI ĐẦU MỘT ĐIỀU HAY</span><h2>Một lời chào là đủ.</h2><p>Chọn một người bên trái, mở hội thoại bằng Peer ID<br />hoặc tạo nhóm để bắt đầu cùng nhau.</p><div className="empty-actions"><button className="primary-button" onClick={() => openDialog('peer')}><Icon name="plus" size={18}/> Hội thoại mới</button><button className="secondary-button" onClick={() => openDialog('group')}><Icon name="users" size={18}/> Tạo nhóm</button></div><div className="network-summary"><span><b>{p.online.filter(id => id !== p.peerId).length}</b> peer trực tuyến</span><span><b>{p.connection.relays}</b> relay đã kết nối</span><span><b>{p.groups.length}</b> nhóm của bạn</span></div></section>}
      {p.hasSession && selected && <div className="chat-layout"><section className="chat-panel"><header className="chat-header"><button className="icon-button mobile-back" aria-label="Về danh sách" onClick={() => setMobileChat(false)}><Icon name="arrow"/></button><Avatar name={title} group={!!p.groupTarget} online={p.groupTarget ? undefined : p.online.includes(p.target)}/><div className="chat-title"><h2>{title}</h2><span>{p.groupTarget ? `${group?.members.length || 0} thành viên` : p.online.includes(p.target) ? 'Đang trực tuyến' : 'Đang offline · Có thể xem lịch sử'}{p.target && p.modes[p.target] && <b className={`mode-label ${p.modes[p.target] === 'DIRECT' ? 'direct' : ''}`}>{p.modes[p.target]}</b>}</span></div><button className={`icon-button ${showInspector ? 'active' : ''}`} aria-label="Thông tin hội thoại" onClick={() => setShowInspector(!showInspector)}><Icon name="info"/></button></header>
        {p.blocked.includes(p.target) && <div className="notice">Bạn đang chặn peer này. <button onClick={() => void p.toggleBlock()}>Bỏ chặn</button></div>}
        <div className="messages" role="log" aria-label="Tin nhắn"><div className="conversation-start"><span className="day-divider">LỊCH SỬ TRÊN THIẾT BỊ NÀY</span><p>Mọi cuộc trò chuyện đều bắt đầu bằng một lời chào.</p></div>
          {bubbles.map(({ rows, key }, index) => {
                const row = rows[0], m = row.message, mine = m.senderId === p.peerId, delivered = rows.filter(row => row.status === 'delivered').length, failed = rows.filter(row => row.status === 'failed');
                const state = failed.length ? 'failed' : delivered === rows.length && mine ? 'delivered' : row.status;
                const previous = index ? new Date(bubbles[index - 1].rows[0].message.timestamp).toDateString() : '';
                return <div key={key}>{new Date(m.timestamp).toDateString() !== previous && <div className="date-separator"><span>{new Date(m.timestamp).toLocaleDateString('vi-VN', { day: 'numeric', month: 'long' })}</span></div>}<article className={`message-row ${mine ? 'mine' : ''}`}>{!mine && <Avatar name={p.nameOf(m.senderId)}/>}<div className="message-stack">{!mine && p.groupTarget && <span className="sender-name">{p.nameOf(m.senderId)}</span>}<div className="bubble">{m.body && <p>{m.body}</p>}{m.attachments?.map(file => <button className="attachment" key={file.id} onClick={() => void p.downloadFile(file)}><span className="file-symbol"><Icon name="file" size={24}/></span><span><strong>{file.name}</strong><small>{(file.size / 1024).toFixed(1)} KiB · Tải về</small></span><Icon name="download" size={18}/></button>)}</div><div className={`message-meta ${state === 'failed' ? 'failed' : ''}`}><time>{clock(m.timestamp)}</time><span className="route-tag">{[...new Set(rows.map(row => row.message.mode))].join(' / ')}</span>{mine && <><Icon name={state === 'delivered' ? 'check' : state === 'failed' ? 'info' : 'dots'} size={13}/><span>{rows.length > 1 ? `${delivered}/${rows.length} đã nhận` : statusLabel[state]}</span></>}<details><summary>Chi tiết</summary><div className="message-details"><span>ID: {m.messageId}</span><span>Sequence: {m.sequence} · Session: {m.sessionId}</span>{rows.map(item => <span key={item.message.receiverId}>{item.message.receiverId}: {statusLabel[item.status]} · {item.message.mode}</span>)}</div></details></div>{mine && failed.length > 0 && m.type === 'text' && <button className="retry-link" disabled={p.sending} onClick={() => void Promise.all(failed.map(item => p.retry(item)))}><Icon name="refresh" size={13}/> Thử gửi lại</button>}</div></article></div>;
            })}<div ref={end}/></div>
        <div className="composer-area">{p.transfers.filter(item => item.peerId === p.target).slice(-2).map(item => <div className={`transfer-row ${item.status}`} key={item.id}><Icon name="file" size={16}/><span>{item.name}</span><small>{item.status === 'complete' ? 'Hoàn tất' : item.status === 'failed' ? 'Gửi file thất bại' : `${item.progress}%`}</small><progress value={item.progress} max={100}/></div>)}<form className="composer" onSubmit={event => { event.preventDefault(); void p.send(); }}><input ref={fileInput} type="file" hidden onChange={event => {
                const file = event.target.files?.[0];
                if (file)
                    void p.sendFile(file);
                event.target.value = '';
            }}/><button type="button" className="icon-button" aria-label="Gửi file tối đa 512 KiB" disabled={!canWrite || !!p.groupTarget || p.sending} onClick={() => fileInput.current?.click()}><Icon name="plus"/></button><textarea aria-label="Nội dung tin nhắn" rows={1} value={p.body} onChange={event => p.setBody(event.target.value)} onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    if (canWrite && !p.sending)
                        void p.send();
                }
            }} placeholder={!canWrite ? 'Kết nối hoặc chọn hội thoại hợp lệ để gửi…' : `Viết tin nhắn cho ${title}…`} disabled={!canWrite}/><button type="submit" className="send-button" aria-label="Gửi tin nhắn" disabled={!canWrite || p.sending || !p.body.trim()}><Icon name={p.sending ? 'refresh' : 'send'} size={19}/></button></form><div className="composer-note"><span>Enter để gửi · Shift + Enter để xuống dòng</span><span><i />{p.forceRelay ? 'Ưu tiên relay' : 'Ưu tiên kết nối trực tiếp'}</span></div></div>
      </section>{showInspector && <aside className="inspector"><div className="inspector-top"><strong>Thông tin hội thoại</strong><button className="icon-button" aria-label="Đóng thông tin" onClick={() => setShowInspector(false)}><Icon name="close" size={17}/></button></div><div className="inspector-profile"><Avatar name={title} group={!!p.groupTarget}/><h3>{title}</h3><span>{p.groupTarget ? 'Trò chuyện nhóm' : 'Hội thoại cá nhân'}</span></div><div className="info-block"><span className="eyebrow">{p.groupTarget ? 'THÀNH VIÊN' : 'PEER ID'}</span>{p.groupTarget ? group?.members.map(id => <div className="member" key={id}><Avatar name={p.nameOf(id)} online={p.online.includes(id)}/><span><strong>{p.nameOf(id)}</strong><small>{id === group.ownerId ? 'Chủ nhóm' : id}</small></span>{(group.ownerId === p.peerId || id === p.peerId) && <button className="icon-button" aria-label={`Xóa ${id} khỏi nhóm`} onClick={() => void p.changeGroup(id, 'remove')}><Icon name="close" size={15}/></button>}</div>) : <code>{p.target}</code>}{p.groupTarget && group?.ownerId === p.peerId && <form className="add-member" onSubmit={event => { event.preventDefault(); void p.changeGroup(memberText.trim(), 'add'); setMemberText(''); }}><input aria-label="Peer ID thành viên mới" placeholder="Peer ID mới" value={memberText} onChange={event => setMemberText(event.target.value)} required/><button className="icon-button filled" aria-label="Thêm thành viên"><Icon name="plus" size={18}/></button></form>}</div><div className="info-block"><span className="eyebrow">TIỆN ÍCH</span><button className="utility-button" onClick={p.exportHistory}><Icon name="download" size={17}/> Xuất lịch sử hội thoại</button>{!p.groupTarget && <><button className="utility-button" onClick={() => void p.toggleBlock()}><Icon name="shield" size={17}/>{p.blocked.includes(p.target) ? 'Bỏ chặn peer' : 'Chặn tin nhắn cá nhân'}</button><button className="utility-button danger" onClick={() => {
                        if (confirm('Xóa lịch sử hội thoại trên thiết bị này?'))
                            void p.deleteHistory();
                    }}><Icon name="close" size={17}/> Xóa lịch sử cục bộ</button></>}</div><div className="privacy-note"><Icon name="shield" size={18}/><p>Lịch sử lưu cục bộ. Relay có thể đọc nội dung chuyển tiếp; phiên bản này chưa mã hóa đầu cuối.</p></div></aside>}</div>}
      <footer className="app-footer"><span>DS01 P2P Chat · Distributed Systems 01</span><button onClick={() => setShowDiagnostics(true)}>Xem kết nối <Icon name="signal" size={13}/></button></footer>
    </main>
    {dialog && <div className="modal-backdrop" onClick={() => setDialog(null)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onClick={event => event.stopPropagation()}><button className="icon-button modal-close" aria-label="Đóng" onClick={() => setDialog(null)}><Icon name="close"/></button><span className="form-icon"><Icon name={dialog === 'group' ? 'users' : 'chat'} size={24}/></span><h2 id="dialog-title">{dialog === 'group' ? 'Một nhóm, nhiều kết nối.' : 'Bắt đầu cuộc trò chuyện.'}</h2><p>{dialog === 'group' ? 'Mời các peer bằng ID. Bạn sẽ là chủ nhóm.' : 'Nhập Peer ID để mở hội thoại, kể cả khi peer đang offline.'}</p><form onSubmit={event => void submitDialog(event)}>{dialog === 'group' && <label>Tên nhóm<input autoFocus required maxLength={80} placeholder="Ví dụ: Nhóm Hệ thống phân tán" value={groupName} onChange={event => setGroupName(event.target.value)}/></label>}<label>{dialog === 'group' ? 'Peer ID thành viên' : 'Peer ID'}<input autoFocus={dialog === 'peer'} required placeholder={dialog === 'group' ? 'peer-b, peer-c' : 'peer-b'} value={memberText} onChange={event => setMemberText(event.target.value)}/></label>{dialogError && <p className="form-error" role="alert">{dialogError}</p>}<button className="primary-button">{dialog === 'group' ? 'Tạo nhóm' : 'Mở hội thoại'}<Icon name="plus" size={18}/></button></form></section></div>}
    {showDiagnostics && <div className="modal-backdrop diagnostics-backdrop" onClick={() => setShowDiagnostics(false)}><section className="diagnostics" role="dialog" aria-modal="true" aria-labelledby="diagnostics-title" onClick={event => event.stopPropagation()}><div className="inspector-top"><div><span className="eyebrow">QUAN SÁT HỆ THỐNG</span><h2 id="diagnostics-title">Tình trạng kết nối</h2></div><button className="icon-button" aria-label="Đóng chẩn đoán" onClick={() => setShowDiagnostics(false)}><Icon name="close"/></button></div><div className="diagnostic-cards"><div><Icon name="signal"/><span>Signaling</span><strong>{connectionLabel[p.connection.signaling]}</strong><small>{p.signalUrl}</small></div><div><Icon name="link"/><span>Relay</span><strong>{p.connection.relays}/{p.relayUrls.length} kết nối</strong><small>{p.connection.activeRelay || 'Chưa có đường relay'}</small></div></div><label className="toggle-setting"><span><strong>Ưu tiên relay khi gửi tin</strong><small>Dùng để kiểm tra đường truyền; không mô phỏng NAT.</small></span><input type="checkbox" checked={p.forceRelay} onChange={event => p.toggleForceRelay(event.target.checked)}/></label><div className="log-heading"><strong>Nhật ký peer</strong><button className="secondary-button small" onClick={p.exportLogs}><Icon name="download" size={15}/> Xuất log</button></div><pre className="log-console">{p.logs.length ? p.logs.join('\n') : 'Chưa có sự kiện. Kết nối để bắt đầu quan sát.'}</pre><p className="diagnostic-note">DIRECT: DataChannel giữa các peer. RELAY: chuyển tiếp qua server. Delivered xác nhận peer nhận đã lưu tin; không phải trạng thái đã đọc.</p></section></div>}
  </div>;
}
