import React from 'react';
import { useAuth } from '../context/AuthContext';

export default function Dashboard() {
  const { user } = useAuth();

  const stats = [
    { label: 'Active Officers', value: '—', icon: '◉', color: '#1DB954' },
    { label: 'Tests Today',     value: '—', icon: '⬡', color: '#3B8BEB' },
    { label: 'Over Limit',      value: '—', icon: '⊕', color: '#FF4C4C' },
    { label: 'Uploads Pending', value: '—', icon: '↑', color: '#FFA500' },
  ];

  return (
    <div style={styles.root}>
      {/* Top bar */}
      <div style={styles.topBar}>
        <div>
          <h1 style={styles.heading}>Dashboard</h1>
          <p style={styles.sub}>Welcome back, <span style={styles.accent}>{user?.officerId ?? '—'}</span></p>
        </div>
        <div style={styles.roleBadge}>{user?.role ?? 'officer'}</div>
      </div>

      {/* Stats grid */}
      <div style={styles.grid}>
        {stats.map(s => (
          <div key={s.label} style={styles.card}>
            <div style={{ ...styles.cardIcon, color: s.color }}>{s.icon}</div>
            <div style={{ ...styles.cardValue, color: s.color }}>{s.value}</div>
            <div style={styles.cardLabel}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Placeholder notice */}
      <div style={styles.notice}>
        <span style={styles.noticeIcon}>⊕</span>
        <div>
          <p style={styles.noticeTitle}>Live data not connected</p>
          <p style={styles.noticeMsg}>Connect the backend /api/stats endpoint to populate dashboard metrics.</p>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { padding: '32px 36px', flex: 1 },
  topBar: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 32 },
  heading: { margin: 0, fontSize: 22, fontWeight: 700, color: '#fff', letterSpacing: '-0.4px' },
  sub: { margin: '4px 0 0', fontSize: 13, color: '#444' },
  accent: { color: '#1DB954', fontWeight: 700 },
  roleBadge: { background: 'rgba(29,185,84,.1)', color: '#1DB954', border: '1px solid rgba(29,185,84,.2)', padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' },

  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 32 },
  card: { background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 12, padding: '20px 20px', display: 'flex', flexDirection: 'column', gap: 6 },
  cardIcon: { fontSize: 20, marginBottom: 4 },
  cardValue: { fontSize: 28, fontWeight: 800, letterSpacing: '-0.5px' },
  cardLabel: { color: '#444', fontSize: 12, fontWeight: 600 },

  notice: { display: 'flex', alignItems: 'flex-start', gap: 14, background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 12, padding: '20px 24px' },
  noticeIcon: { color: '#333', fontSize: 20, marginTop: 2, flexShrink: 0 },
  noticeTitle: { margin: '0 0 4px', color: '#555', fontSize: 13, fontWeight: 700 },
  noticeMsg: { margin: 0, color: '#333', fontSize: 12, lineHeight: 1.6 },
};