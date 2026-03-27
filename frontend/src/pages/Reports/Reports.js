import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, LayoutDashboard, Video, ClipboardList, PieChart as PieChartIcon, Settings, Bell, Search } from 'lucide-react';
import './Reports.css';

const Reports = () => {
  const navigate = useNavigate();
  return (
    <div className="db-container">
      <aside className="db-sidebar">
        <div className="db-sidebar-logo"><img src="/nava-logo.png" alt="NAVA" className="sidebar-brand-logo" onError={e => { e.target.style.display='none'; }}/></div>
        <nav className="db-sidebar-nav">
          <div className="sidebar-nav-item" onClick={() => navigate('/')}><Home size={18}/><span>Home</span></div>
          <div className="sidebar-nav-item" onClick={() => navigate('/dashboard')}><LayoutDashboard size={18}/><span>Dashboard</span></div>
          <div className="sidebar-nav-item" onClick={() => navigate('/cameras')}><Video size={18}/><span>Cameras</span></div>
          <div className="sidebar-nav-item" onClick={() => navigate('/events')}><ClipboardList size={18}/><span>Events</span></div>
          <div className="sidebar-nav-item active"><PieChartIcon size={18}/><span>Reports</span></div>
          <div className="sidebar-nav-item" onClick={() => navigate('/settings')}><Settings size={18}/><span>Settings</span></div>
        </nav>
      </aside>
      <main className="db-main">
        <header className="db-header">
          <div><h1 className="db-title">Reports</h1><p className="db-subtitle">Compliance trends and analytics</p></div>
          <div className="db-header-actions">
            <div className="db-search-wrapper"><Search className="db-search-icon" size={16}/><input type="text" placeholder="Search…" className="db-search-input"/></div>
            <button className="db-bell-btn"><Bell size={16} className="text-muted"/><span className="db-notification-dot"/></button>
            <div className="db-avatar">A</div>
          </div>
        </header>
        <div className="stub-placeholder">
          <PieChartIcon size={52} strokeWidth={1.2} />
          <h2>Reports</h2>
          <p>Compliance trends, weekly summaries, and exportable analytics will appear here.</p>
        </div>
      </main>
    </div>
  );
};
export default Reports;