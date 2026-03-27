import React, { useState } from 'react';
import { X, ArrowRight, ShieldCheck } from 'lucide-react';
import './LoginSignup.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8080';

const BLOCKED_DOMAINS = [
  'gmail.com','yahoo.com','hotmail.com','outlook.com','live.com',
  'icloud.com','aol.com','protonmail.com','mail.com','ymail.com',
  'rediffmail.com','zoho.com','gmx.com','inbox.com','me.com',
];

// ✅ Disposable email domains
const DISPOSABLE_DOMAINS = [
  'tempmail.com','10minutemail.com','mailinator.com',
  'guerrillamail.com','yopmail.com','trashmail.com'
];

// ✅ Work email check
const isWorkEmail = (email) => {
  const domain = email.split('@')[1]?.toLowerCase();
  return domain && !BLOCKED_DOMAINS.includes(domain);
};

// ✅ Disposable check
const isDisposableEmail = (email) => {
  const domain = email.split('@')[1]?.toLowerCase();
  return domain && DISPOSABLE_DOMAINS.includes(domain);
};

// ✅ Basic domain validation (safe)
const isValidDomain = (email) => {
  const domain = email.split('@')[1];
  return domain && domain.includes('.') && domain.length > 3;
};

// ✅ Company signal (basic heuristic)
const isCompanyEmail = (email) => {
  const domain = email.split('@')[1];
  if (!domain) return false;

  const companyName = domain.split('.')[0];

  // reject weird/random domains
  if (companyName.length < 2 || /\d{3,}/.test(companyName)) {
    return false;
  }

  return true;
};

const EmailGateModal = ({ onSuccess, onClose }) => {
  const [name, setName]               = useState('');
  const [email, setEmail]             = useState('');
  const [emailError, setEmailError]   = useState('');
  const [globalError, setGlobalError] = useState('');
  const [loading, setLoading]         = useState(false);

  // ✅ Enhanced validation (SAFE)
  const handleEmailChange = (e) => {
    const value = e.target.value;
    setEmail(value);

    if (!value) {
      setEmailError('');
      return;
    }

    if (!value.includes('@') || !value.includes('.')) {
      setEmailError('Enter a valid email address');
      return;
    }

    if (!isValidDomain(value)) {
      setEmailError('Invalid domain');
      return;
    }

    if (isDisposableEmail(value)) {
      setEmailError('Disposable emails are not allowed');
      return;
    }

    if (!isWorkEmail(value)) {
      setEmailError('Please use your work email');
      return;
    }

    if (!isCompanyEmail(value)) {
      setEmailError('Enter a valid company email');
      return;
    }

    setEmailError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setGlobalError('');

    if (!email) {
      setEmailError('Email is required');
      return;
    }

    if (!email.includes('@') || !email.includes('.')) {
      setEmailError('Enter a valid email address');
      return;
    }

    if (!isValidDomain(email)) {
      setEmailError('Invalid domain');
      return;
    }

    if (isDisposableEmail(email)) {
      setEmailError('Disposable emails are not allowed');
      return;
    }

    if (!isWorkEmail(email)) {
      setEmailError('Please use your work email');
      return;
    }

    if (!isCompanyEmail(email)) {
      setEmailError('Enter a valid company email');
      return;
    }

    setLoading(true);

    const resolvedName    = name || email.split('@')[0];
    const resolvedCompany = email.split('@')[1]?.split('.')[0] || '';

    const userData = {
      name:    resolvedName,
      email,
      company: resolvedCompany,
      role:    'Plant Manager',
    };

    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/register`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:           resolvedName,
          email,
          company:        resolvedCompany,
          role:           'Plant Manager',
          plant_location: '',
          password:       Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
          identifier:     `${email}@${resolvedCompany}`,
        }),
      });

      if (res.ok) {
        const d = await res.json().catch(() => ({}));
        if (d.token)   userData.token   = d.token;
        if (d.name)    userData.name    = d.name;
        if (d.company) userData.company = d.company;
      }

    } catch {
      console.warn('Backend unreachable, saving session locally only.');
    }

    localStorage.setItem('nava_user', JSON.stringify(userData));
    localStorage.setItem('userData',  JSON.stringify(userData));

    setLoading(false);
    onSuccess(userData);
  };

  return (
    <div className="eg-overlay" onClick={onClose}>
      <div className="eg-modal animate-fade-in" onClick={e => e.stopPropagation()}>

        <button className="eg-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>

        <div className="eg-header">
          <div className="eg-icon-ring">
            <ShieldCheck size={24} className="eg-icon" />
          </div>
          <h2 className="eg-title">Analyse Your Safety Feed</h2>
          <p className="eg-subtitle">
            Enter your work email to unlock the demo — no password needed.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="eg-form" noValidate>
          <div className="form-group">
            <label>Your Name <span className="optional">(Optional)</span></label>
            <input
              type="text"
              placeholder="Jane Smith (or skip)"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label>Work Email <span className="req">*</span></label>
            <input
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={handleEmailChange}
              className={emailError ? 'input-error' : ''}
              required
            />
            {emailError && <span className="field-error">{emailError}</span>}
          </div>

          {globalError && <div className="ls-global-error">{globalError}</div>}

          <button
            type="submit"
            className="login-submit-btn eg-submit"
            disabled={!email || !!emailError || loading}
          >
            {loading ? 'Please wait…' : 'Start Analysing'}
            {!loading && <ArrowRight size={16} style={{ marginLeft: '0.4rem' }} />}
          </button>
        </form>

        <p className="eg-consent">
          By continuing you agree to be contacted about your NAVA trial.
        </p>
      </div>
    </div>
  );
};

export default EmailGateModal;