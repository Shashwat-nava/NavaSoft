import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Video, ClipboardList, PieChart as PieChartIcon,
  Settings, Home, Search, Bell, AlertTriangle, ShieldCheck,
  MapPin, Truck, ChevronUp, ChevronDown, ChevronsUpDown,
  Filter, Download, RefreshCw, X, Loader
} from 'lucide-react';
import { fetchEvents } from '../../api';
import './EventGrid.css';

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const EVENT_TYPES = ['All', 'Near-Miss Event', 'PPE Violation', 'Zone Violation', 'Pedestrian Exposure'];
const SEVERITIES  = ['All', 'High', 'Medium', 'Low'];

const SEVERITY_META = {
  High:   { color: '#ef4444', bg: 'rgba(239,68,68,0.1)'  },
  Medium: { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  Low:    { color: '#22c55e', bg: 'rgba(34,197,94,0.1)'  },
};

const TYPE_META = {
  'Near-Miss Event':     { icon: AlertTriangle, color: '#ef4444' },
  'PPE Violation':       { icon: ShieldCheck,   color: '#f59e0b' },
  'Zone Violation':      { icon: MapPin,        color: '#a855f7' },
  'Pedestrian Exposure': { icon: Truck,         color: '#3b82f6' },
};

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────

const Sidebar = () => {
  const navigate = useNavigate();
  return (
    <aside className="db-sidebar">
      <div className="db-sidebar-logo">
        <img src="/nava-logo.png" alt="NAVA" className="sidebar-brand-logo"
          onError={e => { e.target.style.display = 'none'; }} />
      </div>
      <nav className="db-sidebar-nav">
        <div className="sidebar-nav-item" onClick={() => navigate('/')}><Home size={18}/><span>Home</span></div>
        <div className="sidebar-nav-item" onClick={() => navigate('/dashboard')}><LayoutDashboard size={18}/><span>Dashboard</span></div>
        <div className="sidebar-nav-item" onClick={() => navigate('/cameras')}><Video size={18}/><span>Cameras</span></div>
        <div className="sidebar-nav-item active"><ClipboardList size={18}/><span>Events</span></div>
        <div className="sidebar-nav-item" onClick={() => navigate('/report')}><PieChartIcon size={18}/><span>Reports</span></div>
        <div className="sidebar-nav-item" onClick={() => navigate('/settings')}><Settings size={18}/><span>Settings</span></div>
      </nav>
    </aside>
  );
};

// ─── SORT ICON ────────────────────────────────────────────────────────────────

const SortIcon = ({ column, sortConfig }) => {
  if (sortConfig.key !== column) return <ChevronsUpDown size={13} className="eg-sort-idle" />;
  return sortConfig.dir === 'asc'
    ? <ChevronUp size={13} className="eg-sort-active" />
    : <ChevronDown size={13} className="eg-sort-active" />;
};

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

const EventGrid = () => {
  const navigate = useNavigate();

  // ── Real data from backend ─────────────────────────────────────────────────
  const [allEvents,    setAllEvents]    = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [fetchError,   setFetchError]   = useState(null);
  const [lastRefresh,  setLastRefresh]  = useState(null);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const events = await fetchEvents();
      setAllEvents(events);
      setLastRefresh(new Date());
    } catch (err) {
      // Backend unreachable — never show fabricated numbers, just show empty + error
      setFetchError(err.message);
      setAllEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  // Camera filter list built dynamically from real data — no hardcoded cameras
  const cameraOptions = useMemo(() => {
    const names = [...new Set(allEvents.map(e => e.camera).filter(Boolean))].sort();
    return ['All', ...names];
  }, [allEvents]);

  // ── Filter / sort state ────────────────────────────────────────────────────
  const [search,       setSearch]       = useState('');
  const [typeFilter,   setTypeFilter]   = useState('All');
  const [sevFilter,    setSevFilter]    = useState('All');
  const [camFilter,    setCamFilter]    = useState('All');
  const [sortConfig,   setSortConfig]   = useState({ key: 'timestamp', dir: 'desc' });
  const [page,         setPage]         = useState(1);
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [showFilters,  setShowFilters]  = useState(false);

  const PAGE_SIZE = 10;

  // ── Filtered + sorted rows ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let rows = [...allEvents];

    if (search)               rows = rows.filter(r =>
      (r.id        || '').toLowerCase().includes(search.toLowerCase()) ||
      (r.eventType || '').toLowerCase().includes(search.toLowerCase()) ||
      (r.camera    || '').toLowerCase().includes(search.toLowerCase()) ||
      (r.zone      || '').toLowerCase().includes(search.toLowerCase())
    );
    if (typeFilter !== 'All') rows = rows.filter(r => r.eventType === typeFilter);
    if (sevFilter  !== 'All') rows = rows.filter(r => r.severity  === sevFilter);
    if (camFilter  !== 'All') rows = rows.filter(r => r.camera    === camFilter);

    rows.sort((a, b) => {
      let av = a[sortConfig.key] ?? '', bv = b[sortConfig.key] ?? '';
      if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
      if (av < bv) return sortConfig.dir === 'asc' ? -1 :  1;
      if (av > bv) return sortConfig.dir === 'asc' ?  1 : -1;
      return 0;
    });

    return rows;
  }, [allEvents, search, typeFilter, sevFilter, camFilter, sortConfig]);

  useEffect(() => { setPage(1); }, [search, typeFilter, sevFilter, camFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows   = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // ── Stats — computed from real data only, never fabricated ────────────────
  const stats = useMemo(() => ({
    total:  allEvents.length,
    high:   allEvents.filter(e => e.severity === 'High').length,
    medium: allEvents.filter(e => e.severity === 'Medium').length,
    low:    allEvents.filter(e => e.severity === 'Low').length,
  }), [allEvents]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSort = (key) =>
    setSortConfig(prev => prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' }
    );

  const toggleRow = (id) =>
    setSelectedRows(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const toggleAll = () => {
    if (selectedRows.size === pageRows.length) setSelectedRows(new Set());
    else setSelectedRows(new Set(pageRows.map(r => r.id)));
  };

  const clearFilters = () => {
    setSearch(''); setTypeFilter('All'); setSevFilter('All'); setCamFilter('All');
  };

  const hasActiveFilter = search || typeFilter !== 'All' || sevFilter !== 'All' || camFilter !== 'All';

  // ── CSV export — real filtered data only ──────────────────────────────────
  const handleExport = () => {
    if (filtered.length === 0) { alert('No events to export.'); return; }
    const headers = ['Event ID', 'Timestamp', 'Event Type', 'Severity', 'Camera', 'Zone', 'Confidence'];
    const csv = [
      headers.join(','),
      ...filtered.map(r =>
        [r.id, r.timestamp, r.eventType, r.severity, r.camera, r.zone, r.confidence ?? ''].join(',')
      ),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `nava-events-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="db-container">
      <Sidebar />

      <main className="db-main">
        <header className="db-header">
          <div>
            <h1 className="db-title">Event Explorer</h1>
            <p className="db-subtitle">
              {lastRefresh
                ? `Last updated ${lastRefresh.toLocaleTimeString()}`
                : 'Browse, filter and export all detected safety events'}
            </p>
          </div>
          <div className="db-header-actions">
            <div className="db-search-wrapper">
              <Search className="db-search-icon" size={16} />
              <input type="text" placeholder="Search events…" className="db-search-input"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button className="db-bell-btn">
              <Bell size={16} className="text-muted"/>
              <span className="db-notification-dot"/>
            </button>
            <div className="db-avatar">A</div>
          </div>
        </header>

        <div className="eg-content">

          {/* Backend error banner */}
          {fetchError && (
            <div className="eg-fetch-error">
              <AlertTriangle size={16} />
              <span>
                Backend unreachable: <strong>{fetchError}</strong>.
                Check that your server is running and <code>REACT_APP_BACKEND_URL</code> is set correctly.
              </span>
              <button className="eg-error-retry" onClick={loadEvents}>Retry</button>
            </div>
          )}

          {/* Stat cards — show dashes while loading, real numbers once data arrives */}
          <div className="eg-stat-row">
            <div className="eg-stat-card">
              <span className="eg-stat-label">Total Events</span>
              <span className="eg-stat-value">{loading ? '—' : stats.total}</span>
            </div>
            <div className="eg-stat-card high">
              <AlertTriangle size={16} />
              <span className="eg-stat-label">High Severity</span>
              <span className="eg-stat-value">{loading ? '—' : stats.high}</span>
            </div>
            <div className="eg-stat-card medium">
              <ShieldCheck size={16} />
              <span className="eg-stat-label">Medium Severity</span>
              <span className="eg-stat-value">{loading ? '—' : stats.medium}</span>
            </div>
            <div className="eg-stat-card low">
              <ShieldCheck size={16} />
              <span className="eg-stat-label">Low Severity</span>
              <span className="eg-stat-value">{loading ? '—' : stats.low}</span>
            </div>
          </div>

          {/* Toolbar */}
          <div className="eg-toolbar">
            <div className="eg-toolbar-left">
              <button className={`eg-filter-toggle ${showFilters ? 'active' : ''}`}
                onClick={() => setShowFilters(p => !p)}>
                <Filter size={14} /> Filters
                {hasActiveFilter && <span className="eg-filter-dot" />}
              </button>
              {hasActiveFilter && (
                <button className="eg-clear-btn" onClick={clearFilters}><X size={12} /> Clear</button>
              )}
              <span className="eg-result-count">
                {loading ? 'Loading…' : `${filtered.length} event${filtered.length !== 1 ? 's' : ''}`}
              </span>
            </div>
            <div className="eg-toolbar-right">
              <button className="eg-action-btn" onClick={loadEvents} disabled={loading}>
                {loading
                  ? <><Loader size={14} className="eg-spin" /> Loading…</>
                  : <><RefreshCw size={14} /> Refresh</>}
              </button>
              <button className="eg-action-btn primary"
                onClick={handleExport} disabled={loading || filtered.length === 0}>
                <Download size={14} /> Export CSV
              </button>
            </div>
          </div>

          {/* Filter panel */}
          {showFilters && (
            <div className="eg-filter-panel">
              <div className="eg-filter-group">
                <label>Event Type</label>
                <div className="eg-filter-chips">
                  {EVENT_TYPES.map(t => (
                    <button key={t} className={`eg-chip ${typeFilter === t ? 'active' : ''}`}
                      onClick={() => setTypeFilter(t)}>{t}</button>
                  ))}
                </div>
              </div>
              <div className="eg-filter-group">
                <label>Severity</label>
                <div className="eg-filter-chips">
                  {SEVERITIES.map(s => (
                    <button key={s}
                      className={`eg-chip ${sevFilter === s ? 'active' : ''} ${s !== 'All' ? s.toLowerCase() : ''}`}
                      onClick={() => setSevFilter(s)}>{s}</button>
                  ))}
                </div>
              </div>
              <div className="eg-filter-group">
                {/* Camera options built from real data — no hardcoded list */}
                <label>Camera</label>
                <div className="eg-filter-chips">
                  {cameraOptions.map(c => (
                    <button key={c} className={`eg-chip ${camFilter === c ? 'active' : ''}`}
                      onClick={() => setCamFilter(c)}>{c}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Data grid */}
          <div className="eg-grid-card">
            <div className="eg-table-wrapper">
              {loading ? (
                <div className="eg-loading-state">
                  <Loader size={28} className="eg-spin" />
                  <p>Fetching events from backend…</p>
                </div>
              ) : (
                <table className="eg-table">
                  <thead>
                    <tr>
                      <th className="eg-th-check">
                        <input type="checkbox" className="eg-checkbox"
                          checked={pageRows.length > 0 && selectedRows.size === pageRows.length}
                          onChange={toggleAll} />
                      </th>
                      {[
                        { key: 'id',         label: 'Event ID'   },
                        { key: 'timestamp',  label: 'Timestamp'  },
                        { key: 'eventType',  label: 'Event Type' },
                        { key: 'severity',   label: 'Severity'   },
                        { key: 'camera',     label: 'Camera'     },
                        { key: 'zone',       label: 'Zone'       },
                        { key: 'confidence', label: 'Confidence' },
                      ].map(col => (
                        <th key={col.key} className="eg-th sortable" onClick={() => handleSort(col.key)}>
                          {col.label} <SortIcon column={col.key} sortConfig={sortConfig} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="eg-empty">
                          {fetchError
                            ? <><AlertTriangle size={28}/><p>Backend unavailable — no events to display.</p></>
                            : <><Search size={28} strokeWidth={1.2}/><p>No events match your filters.</p>
                                <button className="eg-clear-btn" onClick={clearFilters}>Clear filters</button></>
                          }
                        </td>
                      </tr>
                    ) : pageRows.map(row => {
                      const sev      = SEVERITY_META[row.severity] || SEVERITY_META.Medium;
                      const typeMeta = TYPE_META[row.eventType]    || { icon: AlertTriangle, color: '#64748b' };
                      const TypeIcon = typeMeta.icon;
                      return (
                        <tr key={row.id}
                          className={`eg-row ${selectedRows.has(row.id) ? 'selected' : ''}`}
                          onClick={() => toggleRow(row.id)}>
                          <td className="eg-td-check" onClick={e => e.stopPropagation()}>
                            <input type="checkbox" className="eg-checkbox"
                              checked={selectedRows.has(row.id)} onChange={() => toggleRow(row.id)} />
                          </td>
                          <td className="eg-td-id">{row.id}</td>
                          <td className="eg-td-ts">{row.timestamp}</td>
                          <td>
                            <span className="eg-type-cell">
                              <TypeIcon size={13} style={{ color: typeMeta.color }} />
                              {row.eventType}
                            </span>
                          </td>
                          <td>
                            <span className="eg-sev-badge" style={{ color: sev.color, background: sev.bg }}>
                              {row.severity}
                            </span>
                          </td>
                          <td>{row.camera}</td>
                          <td className="eg-td-zone">{row.zone}</td>
                          <td>
                            {row.confidence != null ? (
                              <div className="eg-confidence-bar">
                                <div className="eg-confidence-fill" style={{
                                  width: `${row.confidence}%`,
                                  background: row.confidence >= 90 ? '#22c55e'
                                            : row.confidence >= 70 ? '#f59e0b'
                                            : '#ef4444',
                                }} />
                                <span>{row.confidence}%</span>
                              </div>
                            ) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {!loading && filtered.length > 0 && (
              <div className="eg-pagination">
                <span className="eg-page-info">
                  {selectedRows.size > 0 && (
                    <span className="eg-selected-label">{selectedRows.size} selected · </span>
                  )}
                  Page {page} of {totalPages} · {filtered.length} results
                </span>
                <div className="eg-page-btns">
                  <button className="eg-page-btn" onClick={() => setPage(1)} disabled={page === 1}>«</button>
                  <button className="eg-page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>‹</button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const start = Math.max(1, Math.min(page - 2, totalPages - 4));
                    const n = start + i;
                    return (
                      <button key={n} className={`eg-page-btn ${page === n ? 'active' : ''}`}
                        onClick={() => setPage(n)}>{n}</button>
                    );
                  })}
                  <button className="eg-page-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>›</button>
                  <button className="eg-page-btn" onClick={() => setPage(totalPages)} disabled={page === totalPages}>»</button>
                </div>
              </div>
            )}
          </div>

        </div>
      </main>
    </div>
  );
};

export default EventGrid;