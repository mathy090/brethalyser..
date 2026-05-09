import React from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Dashboard.css';

const Dashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="dashboard-layout">
      <header className="dashboard-header">
        <div className="logo">Blow Safe</div>
        <div className="header-right">
          <span>{user?.email}</span>
          <button onClick={() => { logout(); navigate('/login'); }} className="logout-btn">Sign Out</button>
        </div>
      </header>
      <nav className="dashboard-nav">
        <Link to="/dashboard" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Overview</Link>
        <Link to="/dashboard/servers" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Servers</Link>
      </nav>
      <main className="dashboard-content">
        <Outlet />
      </main>
    </div>
  );
};
export default Dashboard;