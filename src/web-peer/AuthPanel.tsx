import { useState, type FormEvent } from 'react';
import type { useWebPeer } from './useWebPeer.ts';

export function AuthPanel({ peer: p }: { peer: ReturnType<typeof useWebPeer> }) {
    const [mode, setMode] = useState<'login' | 'register' | 'demo'>('login');
    const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [name, setName] = useState(''), [confirmation, setConfirmation] = useState('');
    const [notice, setNotice] = useState(''), [showPassword, setShowPassword] = useState(false);
    const busy = p.authBusy || p.connecting;
    const switchMode = (value: typeof mode) => { setMode(value); setPassword(''); setConfirmation(''); setNotice(''); p.setError(''); };
    const submit = async (event: FormEvent) => {
        event.preventDefault(); setNotice('');
        if (mode === 'demo') { await p.connect(); return; }
        if (mode === 'register' && password !== confirmation) { p.setError('Hai mật khẩu chưa trùng nhau.'); return; }
        const registered = await p.authenticate(mode, username, password, name);
        setPassword(''); setConfirmation('');
        if (registered) { setMode('login'); setNotice('Tạo tài khoản thành công. Đăng nhập để bắt đầu trò chuyện.'); }
    };
    if (p.accountSession) return <section className="connect-card" aria-busy={busy}>
        <span className="eyebrow">CHÀO {p.accountSession.account.displayName.toLocaleUpperCase()}</span>
        <h3>{busy ? 'Đang đưa bạn online…' : 'Kết nối lại để tiếp tục'}</h3>
        <p>Tài khoản đã xác thực. Ứng dụng sẽ đăng ký peer và tải các cuộc trò chuyện của bạn.</p>
        <button className="primary-button" disabled={busy} onClick={() => void p.connect()}>Kết nối lại</button>
        <button className="secondary-button" disabled={busy} onClick={() => void p.disconnect()}>Đăng xuất</button>
    </section>;
    return <form className={`connect-card auth-card ${mode === 'demo' ? 'demo-card' : ''}`} onSubmit={event => void submit(event)} aria-busy={busy}>
        <span className="eyebrow">KHÔNG GIAN CỦA BẠN</span>
        <h3>{mode === 'register' ? 'Bắt đầu cùng mạch.' : mode === 'demo' ? 'Thử nghiệm peer' : 'Chào bạn trở lại.'}</h3>
        <p>{mode === 'register' ? 'Một tài khoản cho những cuộc trò chuyện của bạn.' : mode === 'demo' ? 'Dùng Peer ID cũ để kiểm thử giao thức hoặc mở lịch sử demo.' : 'Đăng nhập, kết nối và tiếp tục câu chuyện.'}</p>
        <div className="auth-tabs" role="group" aria-label="Chọn đăng nhập hoặc đăng ký">
            <button type="button" aria-pressed={mode === 'login'} disabled={busy} onClick={() => switchMode('login')}>Đăng nhập</button>
            <button type="button" aria-pressed={mode === 'register'} disabled={busy} onClick={() => switchMode('register')}>Tạo tài khoản</button>
        </div>
        {notice && <div className="auth-success" role="status">{notice}</div>}
        {mode === 'demo' ? <>
            <label>Tên hiển thị<input required maxLength={80} value={p.displayName} onChange={event => p.setDisplayName(event.target.value)} autoComplete="nickname" disabled={busy}/></label>
            <label>Peer ID<input required minLength={3} maxLength={32} pattern="[a-zA-Z0-9_-]{3,32}" value={p.peerId} onChange={event => p.setPeerId(event.target.value)} placeholder="peer-a" autoComplete="off" disabled={busy}/></label>
        </> : <>
            {mode === 'register' && <label>Tên hiển thị<input name="displayName" required maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="Ví dụ: Minh Anh" autoComplete="nickname" disabled={busy}/></label>}
            <label>Tên đăng nhập<input name="username" required minLength={3} maxLength={24} pattern="[a-zA-Z0-9_-]{3,24}" value={username} onChange={event => setUsername(event.target.value)} placeholder="Ví dụ: minh-anh" autoComplete="username" autoCapitalize="none" spellCheck={false} disabled={busy}/>{mode === 'register' && <small>3–24 ký tự: chữ không dấu, số, dấu _ hoặc -.</small>}</label>
            <label>Mật khẩu<span className="password-field"><input name="password" type={showPassword ? 'text' : 'password'} required minLength={10} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} disabled={busy}/><button type="button" aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Ẩn' : 'Hiện'}</button></span>{mode === 'register' && <small>Tối thiểu 10 ký tự. Có thể dùng một cụm từ dễ nhớ.</small>}</label>
            {mode === 'register' && <label>Nhập lại mật khẩu<input name="confirmation" type={showPassword ? 'text' : 'password'} required minLength={10} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="new-password" disabled={busy}/></label>}
        </>}
        <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Đang kết nối…' : mode === 'register' ? 'Tạo tài khoản' : mode === 'demo' ? 'Kết nối peer demo' : 'Đăng nhập và vào chat'}</button>
        <span className="local-note">Lịch sử trò chuyện được lưu trên thiết bị này.</span>
        <button className="demo-toggle" type="button" disabled={busy} onClick={() => switchMode(mode === 'demo' ? 'login' : 'demo')}>{mode === 'demo' ? 'Quay lại đăng nhập tài khoản' : 'Thử nghiệm kỹ thuật bằng Peer ID'}</button>
    </form>;
}
