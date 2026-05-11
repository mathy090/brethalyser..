import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../auth/firebaseConfig';
import { useAuth } from '../context/AuthContext';

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/dashboard',  label: 'Dashboard', icon: '▦' },
  { path: '/audit',      label: 'Audit Log',  icon: '⊕' },
  { path: '/server',     label: 'Server',     icon: '⬡' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  async function handleLogout() {
    await signOut(auth).catch(() => null);
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div style={styles.root}>
      {/* Sidebar */}
      <aside style={{ ...styles.sidebar, width: collapsed ? 64 : 220 }}>
        {/* Logo */}
        <div style={styles.logoRow}>
          {!collapsed && (
            <div style={styles.logo}>
              <span style={styles.logoBadge}>ZRP</span>
              <span style={styles.logoText}>BlowSafe</span>
            </div>
          )}
          <button style={styles.collapseBtn} onClick={() => setCollapsed(c => !c)} title="Toggle sidebar">
            {collapsed ? '▶' : '◀'}
          </button>
        </div>

        {/* Nav */}
        <nav style={styles.nav}>
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              style={({ isActive }) => ({
                ...styles.navItem,
                ...(isActive ? styles.navActive : {}),
                justifyContent: collapsed ? 'center' : 'flex-start',
              })}
              title={collapsed ? item.label : undefined}
            >
              <span style={styles.navIcon}>{item.icon}</span>
              {!collapsed && <span style={styles.navLabel}>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* User info + logout */}
        <div style={{ ...styles.userSection, alignItems: collapsed ? 'center' : 'flex-start' }}>
          {!collapsed && (
            <div style={styles.userInfo}>
              <p style={styles.userId}>{user?.officerId ?? '—'}</p>
              <p style={styles.userRole}>{user?.role ?? 'officer'}</p>
            </div>
          )}
          <button style={styles.logoutBtn} onClick={handleLogout} title="Sign out">
            <span style={styles.navIcon}>⏻</span>
            {!collapsed && <span style={styles.navLabel}>Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main style={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: 'flex', minHeight: '100vh', background: '#080808', fontFamily: "'DM Mono', 'Courier New', monospace" },

  sidebar: { display: 'flex', flexDirection: 'column', background: '#0c0c0c', borderRight: '1px solid #181818', transition: 'width .2s ease', overflow: 'hidden', flexShrink: 0, minHeight: '100vh' },

  logoRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 12px 12px', borderBottom: '1px solid #181818', minHeight: 60 },
  logo: { display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' },
  logoBadge: { background: '#1DB954', color: '#000', fontSize: 10, fontWeight: 800, padding: '3px 6px', borderRadius: 4, letterSpacing: 1, flexShrink: 0 },
  logoText: { color: '#fff', fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden' },
  collapseBtn: { background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 10, padding: 4, flexShrink: 0, lineHeight: 1 },

  nav: { flex: 1, display: 'flex', flexDirection: 'column', gap: 2, padding: '12px 8px' },
  navItem: { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8, color: '#555', textDecoration: 'none', fontSize: 12, fontWeight: 600, transition: 'background .12s, color .12s', whiteSpace: 'nowrap', overflow: 'hidden' },
  navActive: { background: 'rgba(29,185,84,.1)', color: '#1DB954' },
  navIcon: { fontSize: 14, flexShrink: 0, width: 18, textAlign: 'center' },
  navLabel: { overflow: 'hidden', textOverflow: 'ellipsis' },

  userSection: { display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 8px', borderTop: '1px solid #181818' },
  userInfo: { padding: '0 4px 4px' },
  userId: { margin: 0, color: '#fff', fontSize: 11, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  userRole: { margin: '2px 0 0', color: '#444', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.8px' },
  logoutBtn: { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8, background: 'none', border: 'none', color: '#FF4C4C', cursor: 'pointer', fontSize: 12, fontWeight: 600, width: '100%', whiteSpace: 'nowrap', overflow: 'hidden', transition: 'background .12s' },

  main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', minWidth: 0 },
};