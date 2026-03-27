import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage/LandingPage';
import Reports     from './pages/Reports/Reports';
import EventGrid   from './pages/EventGrid/EventGrid';
import './App.css';

// /login is no longer a standalone route.
// Auth is now handled inline via the EmailGateModal on the LandingPage.

function App() {
  return (
    <Router>
      <div className="App">
        <Routes>
          <Route path="/"       element={<LandingPage />} />
          <Route path="/events" element={<EventGrid />} />
          <Route path="/report" element={<Reports />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;