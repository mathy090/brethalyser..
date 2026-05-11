import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import axios, { type AxiosError } from 'axios';
import { auth } from '../auth/firebaseConfig';
import { useAuth } from '../context/AuthContext';
import { io, Socket } from 'socket.io-client';

const api = axios.create({
  baseURL: import.meta.env.VITE_BACKEND_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

const OFFICER_ID_RE = /^[A-Z]\d{6}[A-Z]$|^\d{9}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type BannerType = 'error' | 'warning' | 'success';
const STRICT_ROLES = new Set(['admin', 'superadmin']);

const ERROR_MAP: Record<string, { type: BannerType; title: string; message: string; field?: string }> = {
  INVALID_CREDENTIAL:      { type: 'error',   title: 'Invalid Credentials',   message: 'Officer ID, email or password is incorrect.' },
  USER_NOT_FOUND:          { type: 'error',   title: 'Not Found',             message: 'No account found for this email address.' },
  TOO_MANY_REQUESTS:       { type: 'warning', title: 'Account Locked',        message: 'Too many attempts. Wait a few minutes.' },
  ACCOUNT_PENDING:         { type: 'warning', title: 'Pending Approval',      message: 'Your account is awaiting administrator approval. You will be notified by email once approved.' },
  ACCOUNT_REJECTED:        { type: 'error',   title: 'Access Denied',         message: 'Access has been denied. Contact your commanding officer.' },
  EMAIL_NOT_VERIFIED:      { type: 'warning', title: 'Verify Email',          message: 'Check your inbox for the verification link sent at registration.' },
  COMMERCIAL_VPN_BLOCKED:  { type: 'error',   title: 'VPN Detected',          message: 'Disable your VPN and try again.' },
  NETWORK_ERROR:           { type: 'error',   title: 'Connection Error',      message: 'Cannot reach servers. Check your connection.' },
  SERVER_ERROR:            { type: 'error',   title: 'Server Error',          message: 'Unexpected server error. Try again shortly.' },
};

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login: ctxLogin, isAuthenticated } = useAuth();

  const [officerId, setOfficerId] = useState('');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [errors, setErrors]       = useState<Record<string, string>>({});
  const [banner, setBanner]       = useState<{ type: BannerType; title: string; message: string } | null>(null);
  const [loading, setLoading]     = useState(false);

  const bannerRef = useRef<HTMLDivElement>(null);
  const wsSocketRef = useRef<Socket | null>(null);

  // Already logged in → go to dashboard
  useEffect(() => {
    if (isAuthenticated) navigate('/dashboard', { replace: true });
  }, [isAuthenticated, navigate]);

  // Session-expired banner from redirect
  useEffect(() => {
    const state = location.state as { expired?: boolean } | null;
    if (state?.expired) {
      setBanner({ type: 'warning', title: 'Session Expired', message: 'Your session expired. Please sign in again.' });
      window.history.replaceState({}, '');
    }
  }, []);

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsSocketRef.current) {
        wsSocketRef.current.disconnect();
        wsSocketRef.current = null;
      }
    };
  }, []);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!OFFICER_ID_RE.test(officerId.trim())) e.officerId = 'Invalid format — expected A123456B or 9 digits';
    if (!EMAIL_RE.test(email.trim()))           e.email     = 'Enter a valid email address';
    if (!password)                              e.password  = 'Password is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  // 🔐 Establish WebSocket session for admins/superadmins (session persistence ONLY)
  function setupAdminWebSocket(token: string, officerId: string, role: string) {
    if (!STRICT_ROLES.has(role)) return; // Only admins/superadmins get WebSocket session

    const getWSUrl = () => {
      const isProd = import.meta.env.PROD;
      return isProd ? `wss://${window.location.hostname}` : (import.meta.env.VITE_WS_URL || `ws://localhost:${import.meta.env.VITE_BACKEND_PORT || 3000}`);
    };

    const socket = io(getWSUrl(), {
      auth: { token }, // JWT for auth handshake only
      transports: ['websocket'],
      reconnection: false, // Force explicit re-login on disconnect
      timeout: 10000,
      extraHeaders: { Origin: window.location.origin },
    });

    wsSocketRef.current = socket;

    const handleSessionBreak = (reason: string) => {
      console.warn(`⚠️ Admin WebSocket session broken: ${reason}`);
      // 🔥 INSTANT LOGOUT: Clear ALL auth state
      localStorage.clear();
      sessionStorage.clear();
      signOut(auth).catch(() => {});
      // Redirect to interrupt screen
      navigate('/session-interrupted', { replace: true, state: { reason } });
    };

    socket.on('connect', () => {
      console.log(`✅ Admin WebSocket connected | Officer: ${officerId}`);
    });

    socket.on('disconnect', (reason) => {
      handleSessionBreak(`disconnect:${reason}`);
    });

    socket.on('connect_error', (err) => {
      console.error('❌ WebSocket connect error:', err.message);
      handleSessionBreak('connect_error');
    });

    socket.on('error', (err) => {
      console.error('❌ WebSocket error:', err.message);
      handleSessionBreak('error');
    });
  }

  async function handleSubmit() {
    if (loading) return;
    setBanner(null);
    if (!validate()) return;

    setLoading(true);
    try {
      // 🔹 Step 1: Firebase credential verification
      const cred = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      const idToken = await cred.user.getIdToken();

      // 🔹 Step 2: Backend verification + JWT issuance (for API Authorization headers)
      const { data } = await api.post(
        '/api/auth/login',
        { officerId: officerId.trim().toUpperCase() },
        { headers: { Authorization: `Bearer ${idToken}` } }
      );

      if (!data?.token) throw new Error('No token returned');

      // 🔹 Step 3: Store JWT in context for API calls (Authorization header)
      ctxLogin({
        token:     data.token,        // ✅ Used for API Authorization headers
        officerId: data.officerId ?? officerId.trim().toUpperCase(),
        uid:       cred.user.uid,
        role:      data.role   ?? 'officer',
        status:    data.status ?? 'approved',
      });

      // 🔹 Step 4: For admins/superadmins → establish WebSocket session (session persistence ONLY)
      // If WebSocket disconnects → instant logout regardless of JWT validity
      if (STRICT_ROLES.has(data.role)) {
        setupAdminWebSocket(data.token, data.officerId, data.role);
      }

      navigate('/dashboard', { replace: true });

    } catch (err: any) {
      await signOut(auth).catch(() => null);

      let code = 'SERVER_ERROR';
      if (err?.code?.startsWith('auth/')) {
        const map: Record<string, string> = {
          'auth/invalid-credential':     'INVALID_CREDENTIAL',
          'auth/wrong-password':         'INVALID_CREDENTIAL',
          'auth/user-not-found':         'USER_NOT_FOUND',
          'auth/too-many-requests':      'TOO_MANY_REQUESTS',
          'auth/network-request-failed': 'NETWORK_ERROR',
        };
        code = map[err.code] ?? 'SERVER_ERROR';
      } else if ((err as AxiosError).isAxiosError) {
        const ae = err as AxiosError<{ code?: string; message?: string }>;
        if (!ae.response) code = 'NETWORK_ERROR';
        else {
          const bc = ae.response.data?.code ?? '';
          if (bc.includes('PENDING'))  code = 'ACCOUNT_PENDING';
          else if (bc.includes('REJECT') || bc.includes('BAN')) code = 'ACCOUNT_REJECTED';
          else if (bc.includes('VPN'))  code = 'COMMERCIAL_VPN_BLOCKED';
          else if (bc.includes('EMAIL_NOT_VERIFIED')) code = 'EMAIL_NOT_VERIFIED';
          else code = bc || 'SERVER_ERROR';
        }
      }

      const resolved = ERROR_MAP[code] ?? ERROR_MAP.SERVER_ERROR;
      setBanner(resolved);
      setTimeout(() => bannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 40);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.root}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.badge}>ZRP</div>
          <div>
            <h1 style={styles.title}>Officer Sign In</h1>
            <p style={styles.subtitle}>Zimbabwe Republic Police · Traffic Enforcement</p>
          </div>
        </div>

        {/* Banner */}
        <div ref={bannerRef}>
          {banner && (
            <div style={{ ...styles.banner, ...bannerColors[banner.type] }}>
              <div>
                <p style={styles.bannerTitle}>{banner.title}</p>
                <p style={styles.bannerMsg}>{banner.message}</p>
              </div>
              <button style={styles.bannerClose} onClick={() => setBanner(null)}>✕</button>
            </div>
          )}
        </div>

        {/* Fields */}
        <div style={styles.fields}>
          <Field label="Officer ID" id="officerId" value={officerId}
            onChange={v => { setOfficerId(v); setErrors(e => ({ ...e, officerId: '' })); }}
            error={errors.officerId} placeholder="A123456B" hint="Format: A123456B or 9 digits"
            autoComplete="username" disabled={loading} onEnter={handleSubmit} />

          <Field label="Email Address" id="email" type="email" value={email}
            onChange={v => { setEmail(v); setErrors(e => ({ ...e, email: '' })); }}
            error={errors.email} placeholder="officer@zrp.gov.zw"
            autoComplete="email" disabled={loading} onEnter={handleSubmit} />

          <Field label="Password" id="password" type="password" value={password}
            onChange={v => { setPassword(v); setErrors(e => ({ ...e, password: '' })); }}
            error={errors.password} placeholder="Enter your password"
            autoComplete="current-password" disabled={loading} onEnter={handleSubmit} />
        </div>

        <button style={{ ...styles.btn, ...(loading ? styles.btnDisabled : {}) }}
          onClick={handleSubmit} disabled={loading}>
          {loading
            ? <><Spinner /> Signing In…</>
            : 'Sign In'}
        </button>

        <div style={styles.footer}>
          <span style={styles.footerText}>No account? </span>
          <Link to="/signup" style={styles.link}>Register</Link>
        </div>

        <p style={styles.legal}>
          ⚠ Unauthorised access is a criminal offence under the Computer Crime and Cyber Crime Act [Chapter 9:23]. All access is logged.
        </p>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
      `}</style>
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
  const border = error ? '#FF4C4C' : focused ? '#1DB954' : '#222';
  return (
    <div style={{ marginBottom: 4 }}>
      <label htmlFor={id} style={styles.label}>{label}</label>
      <input id={id} type={type} value={value} placeholder={placeholder}
        autoComplete={autoComplete} disabled={disabled}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onKeyDown={e => e.key === 'Enter' && onEnter?.()}
        style={{ ...styles.input, borderColor: border, boxShadow: focused ? `0 0 0 3px ${error ? 'rgba(255,76,76,.12)' : 'rgba(29,185,84,.12)'}` : 'none' }} />
      {hint && !error && <p style={styles.hint}>{hint}</p>}
      {error && <p style={styles.error}>{error}</p>}
    </div>
  );
}

function Spinner() {
  return <span style={{ width: 16, height: 16, border: '2px solid rgba(0,0,0,.25)', borderTop: '2px solid #000', borderRadius: '50%', display: 'inline-block', animation: 'spin .7s linear infinite', marginRight: 8 }} />;
}

const bannerColors: Record<BannerType, React.CSSProperties> = {
  error:   { background: 'rgba(255,76,76,.08)',  borderColor: '#FF4C4C' },
  warning: { background: 'rgba(255,165,0,.08)',  borderColor: '#FFA500' },
  success: { background: 'rgba(29,185,84,.08)',  borderColor: '#1DB954' },
};

const styles: Record<string, React.CSSProperties> = {
  root: { minHeight: '100vh', background: '#080808', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 16px', fontFamily: "'DM Mono', 'Courier New', monospace" },
  card: { width: '100%', maxWidth: 440, background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 16, padding: '36px 32px', animation: 'fadeUp .35s ease-out' },
  header: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 },
  badge: { width: 44, height: 44, background: '#1DB954', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000', fontWeight: 800, fontSize: 13, letterSpacing: 1, flexShrink: 0 },
  title: { margin: 0, fontSize: 20, fontWeight: 700, color: '#fff', letterSpacing: '-0.4px' },
  subtitle: { margin: 0, fontSize: 11, color: '#444', marginTop: 2 },
  banner: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', border: '1px solid', borderRadius: 10, padding: '12px 14px', marginBottom: 20 },
  bannerTitle: { margin: '0 0 3px', fontSize: 12, fontWeight: 700, color: '#fff' },
  bannerMsg: { margin: 0, fontSize: 12, color: '#aaa', lineHeight: 1.5 },
  bannerClose: { background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, padding: '0 0 0 8px', flexShrink: 0 },
  fields: { display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 },
  label: { display: 'block', marginBottom: 5, color: '#555', fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' },
  input: { width: '100%', background: '#151515', color: '#fff', border: '1px solid #222', borderRadius: 8, padding: '12px 14px', fontSize: 14, outline: 'none', boxSizing: 'border-box', transition: 'border-color .15s, box-shadow .15s', fontFamily: 'inherit' },
  hint: { margin: '4px 0 0 2px', color: '#444', fontSize: 11 },
  error: { margin: '4px 0 0 2px', color: '#FF4C4C', fontSize: 11 },
  btn: { width: '100%', background: '#1DB954', color: '#000', border: 'none', borderRadius: 10, padding: '13px', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', letterSpacing: '0.3px', transition: 'opacity .15s' },
  btnDisabled: { opacity: 0.6, cursor: 'not-allowed' },
  footer: { display: 'flex', justifyContent: 'center', gap: 6, marginTop: 18, fontSize: 13 },
  footerText: { color: '#444' },
  link: { color: '#1DB954', textDecoration: 'none', fontWeight: 600 },
  legal: { marginTop: 24, color: '#2a2a2a', fontSize: 10, textAlign: 'center', lineHeight: 1.6 },
};