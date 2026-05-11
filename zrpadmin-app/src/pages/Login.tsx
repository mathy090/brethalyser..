import React, { useState, useRef } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import axios, { type AxiosError } from 'axios';
import { io, Socket } from 'socket.io-client';
import { auth } from '../auth/firebaseConfig';
import { useAuth } from '../context/AuthContext';
import '../designs/Login.css'; // ✅ Import external CSS

const api = axios.create({
  baseURL: import.meta.env.VITE_BACKEND_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

const OFFICER_ID_RE = /^[A-Z]\d{6}[A-Z]$|^\d{9}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const STRICT_ROLES = new Set(['admin', 'superadmin']);

type BannerType = 'error' | 'warning' | 'success';

const ERROR_MAP: Record<string, { type: BannerType; title: string; message: string }> = {
  INVALID_CREDENTIAL:      { type: 'error',   title: 'Invalid Credentials',   message: 'Officer ID, email or password is incorrect.' },
  USER_NOT_FOUND:          { type: 'error',   title: 'Not Found',             message: 'No account found for this email address.' },
  TOO_MANY_REQUESTS:       { type: 'warning', title: 'Account Locked',        message: 'Too many attempts. Wait a few minutes.' },
  ACCOUNT_PENDING:         { type: 'warning', title: 'Pending Approval',      message: 'Your account is awaiting administrator approval.' },
  ACCOUNT_REJECTED:        { type: 'error',   title: 'Access Denied',         message: 'Access has been denied. Contact your commanding officer.' },
  EMAIL_NOT_VERIFIED:      { type: 'warning', title: 'Verify Email',          message: 'Check your inbox for the verification link.' },
  COMMERCIAL_VPN_BLOCKED:  { type: 'error',   title: 'VPN Detected',          message: 'Disable your VPN and try again.' },
  NETWORK_ERROR:           { type: 'error',   title: 'Connection Error',      message: 'Cannot reach servers. Check your connection.' },
  SERVER_ERROR:            { type: 'error',   title: 'Server Error',          message: 'Unexpected server error. Try again shortly.' },
};

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login: ctxLogin } = useAuth();

  const [officerId, setOfficerId] = useState('');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [errors, setErrors]       = useState<Record<string, string>>({});
  const [banner, setBanner]       = useState<{ type: BannerType; title: string; message: string } | null>(null);
  const [loading, setLoading]     = useState(false);
  const [wsStep, setWsStep]       = useState<'idle' | 'connecting' | 'done'>('idle');

  const bannerRef = useRef<HTMLDivElement>(null);
  const wsSocketRef = useRef<Socket | null>(null);

  React.useEffect(() => {
    const state = location.state as { expired?: boolean } | null;
    if (state?.expired) {
      setBanner({ type: 'warning', title: 'Session Expired', message: 'Your session expired. Please sign in again.' });
      window.history.replaceState({}, '');
    }
  }, []);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!OFFICER_ID_RE.test(officerId.trim())) e.officerId = 'Invalid format — expected A123456B or 9 digits';
    if (!EMAIL_RE.test(email.trim()))           e.email     = 'Enter a valid email address';
    if (!password)                              e.password  = 'Password is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function initAdminWebSocket(token: string, officerId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = import.meta.env.PROD 
        ? `wss://${window.location.hostname}` 
        : (import.meta.env.VITE_WS_URL || `ws://localhost:${import.meta.env.VITE_BACKEND_PORT || 3000}`);

      console.log('🔌 Attempting WS connection to:', wsUrl);

      const socket = io(wsUrl, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
        timeout: 8000,
      });

      wsSocketRef.current = socket;

      socket.on('connect', () => {
        console.log('✅ WebSocket CONNECTED successfully');
        resolve();
      });

      socket.on('connect_error', (err) => {
        console.error('❌ WebSocket CONNECTION FAILED:', err.message);
        reject(err);
      });

      socket.on('error', (err) => {
        console.error('❌ WebSocket ERROR:', err.message);
        reject(err);
      });

      socket.on('disconnect', (reason) => {
        console.warn('⚠️ WebSocket DISCONNECTED during setup:', reason);
        reject(new Error(`disconnect:${reason}`));
      });
    });
  }

  async function handleSubmit() {
    if (loading || wsStep !== 'idle') return;
    setBanner(null);
    if (!validate()) return;

    setLoading(true);
    setWsStep('idle');

    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      const idToken = await cred.user.getIdToken();

      const { data } = await api.post(
        '/api/auth/login',
        { officerId: officerId.trim().toUpperCase() },
        { headers: { Authorization: `Bearer ${idToken}` } }
      );

      if (!data?.token) throw new Error('No token returned from backend');

      ctxLogin({
        token:     data.token,
        officerId: data.officerId ?? officerId.trim().toUpperCase(),
        uid:       cred.user.uid,
        role:      data.role   ?? 'officer',
        status:    data.status ?? 'approved',
      });

      if (STRICT_ROLES.has(data.role)) {
        setWsStep('connecting');
        setBanner({ type: 'warning', title: 'Establishing Secure Channel', message: 'Verifying persistent connection...' });

        try {
          await initAdminWebSocket(data.token, data.officerId);
          setWsStep('done');
          setBanner(null);
          navigate('/dashboard', { replace: true });
        } catch (err) {
          console.error('🚨 WS Gatekeeper failed. Forcing logout.');
          setWsStep('idle');
          setBanner(null);
          localStorage.clear();
          sessionStorage.clear();
          signOut(auth).catch(() => {});
          navigate('/session-interrupted', { replace: true, state: { reason: 'websocket_setup_failed' } });
        }
      } else {
        navigate('/dashboard', { replace: true });
      }

    } catch (err: any) {
      await signOut(auth).catch(() => null);
      setWsStep('idle');

      let code = 'SERVER_ERROR';
      if (err?.code?.startsWith('auth/')) {
        const map: Record<string, string> = {
          'auth/invalid-credential': 'INVALID_CREDENTIAL',
          'auth/wrong-password': 'INVALID_CREDENTIAL',
          'auth/user-not-found': 'USER_NOT_FOUND',
          'auth/too-many-requests': 'TOO_MANY_REQUESTS',
          'auth/network-request-failed': 'NETWORK_ERROR',
        };
        code = map[err.code] ?? 'SERVER_ERROR';
      } else if ((err as AxiosError).isAxiosError) {
        const ae = err as AxiosError<{ code?: string }>;
        if (!ae.response) code = 'NETWORK_ERROR';
        else {
          const bc = ae.response.data?.code ?? '';
          if (bc.includes('PENDING')) code = 'ACCOUNT_PENDING';
          else if (bc.includes('REJECT') || bc.includes('BAN')) code = 'ACCOUNT_REJECTED';
          else if (bc.includes('VPN')) code = 'COMMERCIAL_VPN_BLOCKED';
          else if (bc.includes('EMAIL_NOT_VERIFIED')) code = 'EMAIL_NOT_VERIFIED';
          else code = bc || 'SERVER_ERROR';
        }
      }

      const resolved = ERROR_MAP[code] ?? ERROR_MAP.SERVER_ERROR;
      setBanner(resolved);
      setTimeout(() => bannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 40);
    } finally {
      if (wsStep === 'idle') setLoading(false);
    }
  }

  const isDisabled = loading || wsStep !== 'idle';

  return (
    <div className="login-root">
      <div className="login-card">
        <div className="login-header">
          <div className="login-badge">ZRP</div>
          <div>
            <h1 className="login-title">Officer Sign In</h1>
            <p className="login-subtitle">Zimbabwe Republic Police · Traffic Enforcement</p>
          </div>
        </div>

        <div ref={bannerRef}>
          {banner && (
            <div className={`login-banner ${banner.type}`}>
              <div className="login-banner-content">
                <p className="login-banner-title">{banner.title}</p>
                <p className="login-banner-msg">{banner.message}</p>
              </div>
              <button className="login-banner-close" onClick={() => setBanner(null)} aria-label="Dismiss">✕</button>
            </div>
          )}
        </div>

        <div className="login-fields">
          <Field 
            label="Officer ID" 
            id="officerId" 
            value={officerId}
            onChange={v => { setOfficerId(v); setErrors(e => ({ ...e, officerId: '' })); }}
            error={errors.officerId} 
            placeholder="A123456B" 
            hint="Format: A123456B or 9 digits"
            autoComplete="username" 
            disabled={isDisabled} 
            onEnter={handleSubmit} 
          />

          <Field 
            label="Email Address" 
            id="email" 
            type="email" 
            value={email}
            onChange={v => { setEmail(v); setErrors(e => ({ ...e, email: '' })); }}
            error={errors.email} 
            placeholder="officer@zrp.gov.zw"
            autoComplete="email" 
            disabled={isDisabled} 
            onEnter={handleSubmit} 
          />

          <Field 
            label="Password" 
            id="password" 
            type="password" 
            value={password}
            onChange={v => { setPassword(v); setErrors(e => ({ ...e, password: '' })); }}
            error={errors.password} 
            placeholder="Enter your password"
            autoComplete="current-password" 
            disabled={isDisabled} 
            onEnter={handleSubmit} 
          />
        </div>

        <button 
          className="login-btn" 
          onClick={handleSubmit} 
          disabled={isDisabled}
        >
          {wsStep === 'connecting'
            ? <><span className="spinner" /> Securing Session…</>
            : loading
              ? <><span className="spinner" /> Signing In…</>
              : 'Sign In'}
        </button>

        <div className="login-footer">
          <span className="login-footer-text">No account? </span>
          <Link to="/signup" className="login-link">Register</Link>
        </div>

        <p className="login-legal">
          ⚠ Unauthorised access is a criminal offence under the Computer Crime and Cyber Crime Act [Chapter 9:23]. All access is logged.
        </p>
      </div>
    </div>
  );
}

// ─── Field sub-component ──────────────────────────────────────────────────────
interface FieldProps {
  label: string; id: string; type?: string; value: string;
  onChange: (v: string) => void; error?: string; placeholder: string;
  hint?: string; autoComplete?: string; disabled?: boolean; onEnter?: () => void;
}

function Field({ label, id, type = 'text', value, onChange, error, placeholder, hint, autoComplete, disabled, onEnter }: FieldProps) {
  const [focused, setFocused] = useState(false);
  
  return (
    <div className="field-group">
      <label htmlFor={id} className="field-label">{label}</label>
      <input 
        id={id} 
        type={type} 
        value={value} 
        placeholder={placeholder}
        autoComplete={autoComplete} 
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)} 
        onBlur={() => setFocused(false)}
        onKeyDown={e => e.key === 'Enter' && onEnter?.()}
        className={`field-input ${error ? 'error' : ''}`}
      />
      {hint && !error && <p className="field-hint">{hint}</p>}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}