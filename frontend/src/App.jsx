import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout   from './components/Layout';
import Login    from './pages/Login';
import Dashboard  from './pages/Dashboard';

import Events     from './pages/Events';
import Queue      from './pages/Queue';
import Quarantine from './pages/Quarantine';
import Settings   from './pages/Settings';
import Reports    from './pages/Reports';
import Alerts     from './pages/Alerts';

function RequireAuth({ children }) {
  return localStorage.getItem('mg_token') ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index              element={<Dashboard />} />
        <Route path="events"      element={<Events />} />
        <Route path="queue"       element={<Queue />} />
        <Route path="quarantine"  element={<Quarantine />} />
        <Route path="reports"     element={<Reports />} />
        <Route path="alerts"      element={<Alerts />} />
        <Route path="settings"    element={<Settings />} />
      </Route>
    </Routes>
  );
}