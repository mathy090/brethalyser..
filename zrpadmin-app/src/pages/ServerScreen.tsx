import React from 'react';

const ServerScreen: React.FC = () => (
  <div className="server-container">
    <h2 style={{ color: '#fff', marginBottom: '1rem' }}>Server Management</h2>
    <div className="server-list">
      <div className="server-card">
        <h3>Primary Gateway</h3>
        <p className="status online">● Online</p>
        <p>Region: EU-West-1</p>
      </div>
      <div className="server-card">
        <h3>Backup Node</h3>
        <p className="status online">● Online</p>
        <p>Region: US-East-2</p>
      </div>
      <div className="server-card">
        <h3>Analytics Engine</h3>
        <p className="status warning">● Maintenance</p>
        <p>Region: AP-South-1</p>
      </div>
    </div>
  </div>
);
export default ServerScreen;