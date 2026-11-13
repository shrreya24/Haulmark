import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error || 'Request failed.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function TruckMark() {
  return <span className="brand-mark" aria-hidden="true">▰</span>;
}

function Brand() {
  return <div className="brand"><TruckMark />haulmark</div>;
}

function App() {
  const [user, setUser] = useState(undefined);
  useEffect(() => { api('/api/auth/me').then(result => setUser(result.user)).catch(() => setUser(null)); }, []);

  if (user === undefined) return <div className="loading-screen">Loading Haulmark…</div>;
  return <Routes>
    <Route path="/track/:token" element={<SupplierPage />} />
    <Route path="/login" element={user ? <Navigate to="/" replace /> : <AuthPage onAuthenticated={setUser} />} />
    <Route path="/*" element={user ? <Dashboard user={user} onSignOut={() => setUser(null)} /> : <Navigate to="/login" replace />} />
  </Routes>;
}

function AuthPage({ onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const isRegister = mode === 'register';

  async function submit(event) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const result = await api(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify(form) });
      onAuthenticated(result.user); navigate('/', { replace: true });
    } catch (submitError) { setError(submitError.message); }
    finally { setBusy(false); }
  }

  return <main className="auth-shell">
    <section className="auth-card">
      <Brand />
      <div className="eyebrow">INBOUND CONTROL TOWER</div>
      <h1>{isRegister ? 'Create your account' : 'Welcome back'}</h1>
      <p className="auth-subtitle">{isRegister ? 'Register to manage supplier GPS tracking.' : 'Sign in to manage your inbound tracking.'}</p>
      <p className="auth-domain-note">Use your @prajgenx.net work email.</p>
      <form onSubmit={submit} className="auth-form">
        {isRegister && <label>Full name<input autoComplete="name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required minLength={2} /></label>}
        <label>Email address<input type="email" autoComplete="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required /></label>
        <label>Password<input type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required minLength={isRegister ? 10 : 1} /></label>
        {isRegister && <small className="field-help">Use at least 10 characters.</small>}
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="btn primary wide" disabled={busy}>{busy ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}</button>
      </form>
      <p className="auth-switch">{isRegister ? 'Already have an account?' : 'New to Haulmark?'}{' '}
        <button type="button" onClick={() => { setMode(isRegister ? 'login' : 'register'); setError(''); }}> {isRegister ? 'Sign in' : 'Register'}</button>
      </p>
    </section>
  </main>;
}

function Dashboard({ user, onSignOut }) {
  const [trips, setTrips] = useState([]);
  const [config, setConfig] = useState({ destinationConfigured: false, historyDays: 30 });
  const [activeView, setActiveView] = useState('pipeline');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState('');
  const [phone, setPhone] = useState('');
  const [supplierLink, setSupplierLink] = useState('');
  const [history, setHistory] = useState([]);
  const [historyTrip, setHistoryTrip] = useState(null);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const notify = message => { setToast(message); window.setTimeout(() => setToast(''), 3000); };
  const refresh = useCallback(async () => {
    const [nextTrips, nextConfig] = await Promise.all([api('/api/trips'), api('/api/config')]);
    setTrips(nextTrips); setConfig(nextConfig);
  }, []);
  async function refreshNow() {
    setRefreshing(true);
    try { await refresh(); notify('Dashboard updated.'); }
    catch (error) { if (error.status === 401 || error.status === 403) onSignOut(); notify(error.message); }
    finally { setRefreshing(false); }
  }
  useEffect(() => {
    let active = true;
    const tick = async () => { try { if (active) await refresh(); } catch (error) { if (error.status === 401) onSignOut(); } };
    tick(); const timer = window.setInterval(tick, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [refresh, onSignOut]);

  async function setPremises() {
    if (!navigator.geolocation) return notify('This browser does not support location access.');
    setBusy(true);
    navigator.geolocation.getCurrentPosition(async position => {
      try {
        await api('/api/destination', { method: 'POST', body: JSON.stringify({ lat: position.coords.latitude, lon: position.coords.longitude }) });
        await refresh(); notify('Premises coordinates saved to your account.');
      } catch (error) { notify(error.message); }
      finally { setBusy(false); }
    }, error => { notify(error.code === 1 ? 'Location permission was denied.' : 'Could not get this device location.'); setBusy(false); }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  }

  async function createTrackingLink(event) {
    event.preventDefault(); setBusy(true);
    try {
      const result = await api('/api/trips', { method: 'POST', body: JSON.stringify({ phone }) });
      setSupplierLink(result.supplierUrl); await refresh(); notify('Tracking link created.');
    } catch (error) { notify(error.message); }
    finally { setBusy(false); }
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(supplierLink); notify('Tracking link copied.'); }
    catch { notify('Copy failed. Select the link and copy it manually.'); }
  }

  async function openHistory() {
    try { setHistory(await api('/api/history')); setHistoryTrip(null); setModal('history'); }
    catch (error) { notify(error.message); }
  }
  async function showTripHistory(id) {
    try { setHistoryTrip(await api(`/api/history/${encodeURIComponent(id)}`)); }
    catch (error) { notify(error.message); }
  }
  async function signOut() {
    try { await api('/api/auth/logout', { method: 'POST' }); } finally { onSignOut(); }
  }

  const visibleTrips = trips.filter(trip => (filter === 'all' || trip.status === filter) && trip.phone.includes(search.trim()))
    .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  const latest = trips.filter(trip => trip.locationUrl).sort((a, b) => new Date(b.locationUpdatedAt) - new Date(a.locationUpdatedAt))[0];
  const onRoad = trips.filter(trip => trip.status === 'On the way').length;
  const reached = trips.filter(trip => trip.status === 'Reached').length;
  const distances = trips.filter(trip => trip.distanceKm != null).map(trip => trip.distanceKm);

  return <div className="shell">
    <aside>
      <Brand />
      <div className="workspace">WORKSPACE<strong>{user.name}</strong></div>
      <div className="nav-label">OPERATIONS</div>
      <nav className="nav">
        <button className={activeView === 'pipeline' ? 'active' : ''} onClick={() => setActiveView('pipeline')}>▤ <span>Inbound pipeline</span><small>{String(trips.length).padStart(2, '0')}</small></button>
        <button className={activeView === 'history' ? 'active' : ''} onClick={() => { setActiveView('history'); openHistory(); }}>◷ <span>Trip history</span></button>
      </nav>
      <div className="aside-bottom"><div className="help"><strong>Location history</strong>GPS samples are retained for {config.historyDays} days.</div>
        <div className="profile"><div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div><div><strong>{user.name}</strong><small>{user.email}</small></div><button className="signout" onClick={signOut}>Sign out</button></div>
      </div>
    </aside>

    <main className="dashboard-main">
      <div className="topline"><div className="eyebrow">INBOUND CONTROL TOWER</div><div className="topright"><div className="live-pill"><i className="dot" /> Live updates · every 5 sec</div><button className="iconbutton" onClick={refreshNow} disabled={refreshing} aria-label="Refresh dashboard" title="Refresh">{refreshing ? '…' : '↻'}</button></div></div>
      <div className="pagehead"><div><h1>Vehicle pipeline</h1><p className="sub">Capture premises GPS and track supplier distance from the latest location.</p></div><div className="actions"><button className="btn" onClick={setPremises} disabled={busy}>{config.destinationConfigured ? 'Update premises location' : 'Use this device as premises'}</button><button className="btn primary" onClick={() => { setPhone(''); setSupplierLink(''); setModal('new'); }}>＋ Add supplier</button></div></div>
      <section className="stats">
        <Stat label="Tracking sessions" value={trips.length} foot="Saved in your account" />
        <Stat label="On the road" value={onRoad} foot={`${reached} reached`} />
        <Stat label="GPS updates" value={trips.reduce((sum, trip) => sum + trip.historyCount, 0)} foot={`Retained for ${config.historyDays} days`} />
        <Stat label="Average distance left" value={distances.length ? `${(distances.reduce((sum, km) => sum + km, 0) / distances.length).toFixed(1)} km` : '—'} foot={!config.destinationConfigured ? 'Set premises location first' : 'Straight-line estimate'} />
      </section>
      <div className="content"><section className="panel fleet">
        <div className="panelhead"><div><h2>Supplier tracking</h2><p>Sorted by remaining straight-line distance</p></div><div className="righttools"><div className="search">⌕ <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search mobile number" /></div><select className="filter" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All statuses</option><option>Awaiting acceptance</option><option>On the way</option><option>Reached</option></select></div></div>
        <div className="tablewrap"><table><thead><tr><th>MOBILE NUMBER</th><th>STATUS</th><th>DISTANCE LEFT</th><th>GPS LOCATION</th><th>LAST UPDATE</th></tr></thead><tbody>
          {visibleTrips.map(trip => <tr key={trip.id}><td className="supplier">{trip.phone}</td><td><span className={`status ${trip.status === 'Reached' ? 'reached' : trip.status === 'On the way' ? 'enroute' : 'awaiting'}`}><i className="sdot" />{trip.status}</span></td><td className="dist">{trip.distanceKm == null ? '—' : `${trip.distanceKm} km`}</td><td>{trip.locationUrl ? <a href={trip.routeUrl || trip.locationUrl} target="_blank" rel="noreferrer">Open map ↗</a> : '—'}</td><td>{trip.locationUpdatedAt ? new Date(trip.locationUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Waiting for GPS'}</td></tr>)}
          {!visibleTrips.length && <tr><td colSpan="5" className="empty-row">{trips.length ? 'No matching supplier sessions.' : 'No sessions yet. Add a supplier mobile number to begin.'}</td></tr>}
        </tbody></table></div>
        <div className="tablefoot"><span>Showing {visibleTrips.length} of {trips.length} sessions</span><button onClick={openHistory}>View trip history ↗</button></div>
      </section>
      <div className="sidecol"><section className="panel mapcard"><div className="maphead"><div><h2>Latest location</h2><p>{latest ? `${latest.phone} · ${new Date(latest.locationUpdatedAt).toLocaleTimeString()}` : 'Supplier locations appear here'}</p></div></div><div className="map map-empty">{latest ? <a href={latest.routeUrl || latest.locationUrl} target="_blank" rel="noreferrer">Open latest route in Google Maps ↗</a> : 'Waiting for a supplier GPS update'}</div><div className="mapbottom">{config.destinationConfigured ? 'Premises location is set' : 'Set premises location to calculate distance'}</div></section>
        <section className="panel activity"><h2>Recent GPS updates</h2>{trips.filter(trip => trip.locationUpdatedAt).slice(0, 5).map(trip => <div className="event" key={trip.id}><div className="eventicon">⌖</div><div><p><b>{trip.phone}</b> shared a location</p><small>{new Date(trip.locationUpdatedAt).toLocaleString()}</small></div></div>)}{!trips.some(trip => trip.locationUpdatedAt) && <p className="empty-note">GPS updates will appear here after suppliers share their location.</p>}</section>
      </div></div>
      <div className="footnote">History and destination coordinates are stored with your MongoDB account.</div>
    </main>

    {toast && <div className="toast show">{toast}</div>}
    {modal === 'new' && <div className="modalback open" onMouseDown={e => { if (e.target === e.currentTarget) setModal(''); }}><div className="modal"><h2>Start GPS tracking</h2><p>Enter a supplier mobile number. Share the generated link so they can allow GPS access.</p>{!supplierLink ? <form onSubmit={createTrackingLink}><div className="field"><label>Supplier mobile number</label><input type="tel" value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" required /></div><div className="modalactions"><button type="button" className="btn" onClick={() => setModal('')}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create tracking link'}</button></div></form> : <><label className="field">Supplier tracking link<input readOnly value={supplierLink} /></label><div className="modalactions"><button className="btn" onClick={() => { const digits = phone.replace(/\D/g, ''); const text = encodeURIComponent(`Please open this link and allow GPS sharing for live tracking: ${supplierLink}`); window.open(`https://wa.me/${digits}?text=${text}`, '_blank', 'noopener'); }}>Open WhatsApp</button><button className="btn" onClick={copyLink}>Copy link</button><button className="btn primary" onClick={() => setModal('')}>Done</button></div></>}</div></div>}
    {modal === 'history' && <HistoryModal history={history} selected={historyTrip} onSelect={showTripHistory} onClose={() => { setModal(''); setActiveView('pipeline'); }} days={config.historyDays} />}
  </div>;
}

function Stat({ label, value, foot }) {
  return <div className="stat"><div className="statlabel">{label}</div><div className="statval">{value}</div><div className="statfoot">{foot}</div></div>;
}

function HistoryModal({ history, selected, onSelect, onClose, days }) {
  return <div className="modalback open" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal history-modal"><h2>Trip history</h2><p>Stored in MongoDB · retained for {days} days · GPS samples are recorded once per minute.</p>
    <div className="tablewrap"><table><thead><tr><th>MOBILE</th><th>STARTED</th><th>STATUS</th><th>GPS POINTS</th><th /></tr></thead><tbody>{history.map(trip => <tr key={trip.id}><td>{trip.phone}</td><td>{new Date(trip.createdAt).toLocaleString()}</td><td>{trip.status}</td><td>{trip.historyCount}</td><td><button className="filter" onClick={() => onSelect(trip.id)}>View points</button></td></tr>)}{!history.length && <tr><td colSpan="5" className="empty-row">No saved tracking history yet.</td></tr>}</tbody></table></div>
    {selected && <div className="history-detail"><h3>{selected.phone} · {selected.points.length} saved GPS points</h3><div className="tablewrap"><table><thead><tr><th>TIME</th><th>LATITUDE</th><th>LONGITUDE</th><th>DISTANCE LEFT</th><th>MAP</th></tr></thead><tbody>{selected.points.map((point, index) => <tr key={`${point.recordedAt}-${index}`}><td>{new Date(point.recordedAt).toLocaleString()}</td><td>{point.lat.toFixed(5)}</td><td>{point.lon.toFixed(5)}</td><td>{point.distanceKm == null ? '—' : `${point.distanceKm} km`}</td><td><a href={point.locationUrl} target="_blank" rel="noreferrer">Open map ↗</a></td></tr>)}</tbody></table></div></div>}
    <div className="modalactions"><button className="btn" onClick={onClose}>Close</button></div>
  </div></div>;
}

function SupplierPage() {
  const { token } = useParams();
  const [details, setDetails] = useState(null);
  const [message, setMessage] = useState('');
  const [sharing, setSharing] = useState(false);
  const [mapUrl, setMapUrl] = useState('');
  const watchId = useRef(null);

  const refresh = useCallback(async () => {
    const result = await api(`/api/supplier/${encodeURIComponent(token)}`);
    setDetails(result); setMapUrl(result.routeUrl || result.locationUrl || '');
  }, [token]);
  useEffect(() => { let active = true; const tick = () => { if (active) refresh().catch(error => setMessage(error.message)); }; tick(); const timer = window.setInterval(tick, 5000); return () => { active = false; window.clearInterval(timer); if (watchId.current !== null) navigator.geolocation?.clearWatch(watchId.current); }; }, [refresh]);

  function startSharing() {
    if (!navigator.geolocation) return setMessage('This browser does not support GPS sharing.');
    setMessage('Requesting location access…'); setSharing(true);
    navigator.geolocation.getCurrentPosition(async position => {
      try {
        await api(`/api/supplier/${encodeURIComponent(token)}/location`, { method: 'POST', body: JSON.stringify({ lat: position.coords.latitude, lon: position.coords.longitude }) });
        setMessage('GPS shared. Keep this page open for live updates.'); await refresh();
      } catch (error) { setMessage(error.message); setSharing(false); }
      watchId.current = navigator.geolocation.watchPosition(async update => {
        try { await api(`/api/supplier/${encodeURIComponent(token)}/location`, { method: 'POST', body: JSON.stringify({ lat: update.coords.latitude, lon: update.coords.longitude }) }); await refresh(); }
        catch (error) { setMessage(error.message); }
      }, error => setMessage(error.code === 1 ? 'Location permission was denied.' : 'GPS update could not be read.'), { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    }, error => { setMessage(error.code === 1 ? 'Location permission was denied.' : 'Could not get this device location.'); setSharing(false); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  }

  if (!details && !message) return <div className="loading-screen">Loading tracking link…</div>;
  return <main className="portal"><section className="portal-card"><Brand /><div className="eyebrow">SUPPLIER DELIVERY CHECK-IN</div><h1>Share your live location</h1><p>Allow GPS access to share your current position with the receiving team.</p>
    {!details && <div className="form-error">{message}</div>}
    {details && <div className="portal-info">{details.destinationConfigured ? 'Premises location received' : 'Premises location not set'}<div className="distance-message">{details.distanceKm == null ? 'Distance left will appear after your GPS is shared.' : `Distance left: ${details.distanceKm} km (straight-line)`}</div>{mapUrl && <a href={mapUrl} target="_blank" rel="noreferrer">Open latest route in Google Maps ↗</a>}</div>}
    <button className="btn primary wide" onClick={startSharing} disabled={sharing}>{sharing ? 'GPS sharing is on' : 'Share my location'}</button>
    {message && details && <div className="portal-state">{message}</div>}
    <div className="portal-help">Your location is shared only for this tracking link. Keep this page open while travelling.</div>
  </section></main>;
}

export default App;
