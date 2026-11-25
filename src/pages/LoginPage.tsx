import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mail, Lock, User, ArrowRight, Eye, EyeOff,
  AlertCircle, Globe2, ChevronDown, Zap,
} from 'lucide-react';
import Photo from '@/components/ui/Photo';
import { getDestination } from '@/data/destinations';
import { signIn, signUp, sendPasswordReset, buildLocalProfile, persistLocalUser, continueAsGuest } from '@/services/authService';
import { isSupabaseConfigured } from '@/services/supabaseClient';
import { refreshJourneys } from '@/services/journeySync';
import './LoginPage.css';

// ─── Test accounts — development builds only ───
// Demo credentials must never ship in the public production bundle. `import.meta.env.DEV`
// is statically false in `vite build`, so this array is tree-shaken out of production.
const SHOW_TEST_ACCOUNTS = import.meta.env.DEV;
const TEST_ACCOUNTS = !SHOW_TEST_ACCOUNTS ? [] : [
  { name: 'Arjun Sharma',   email: 'arjun.sharma@travelsphere.test',   password: 'TravelSphere@2024', role: 'Business Traveler' },
  { name: 'Priya Nair',     email: 'priya.nair@travelsphere.test',     password: 'TravelSphere@2024', role: 'Leisure Explorer' },
  { name: 'Rahul Verma',    email: 'rahul.verma@travelsphere.test',    password: 'TravelSphere@2024', role: 'Frequent Flyer' },
  { name: 'Ananya Iyer',    email: 'ananya.iyer@travelsphere.test',    password: 'TravelSphere@2024', role: 'Budget Traveler' },
  { name: 'Kiran Mehta',    email: 'kiran.mehta@travelsphere.test',    password: 'TravelSphere@2024', role: 'Admin' },
];

const avatarColors = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6'];

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [isLogin, setIsLogin]           = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [showTestPanel, setShowTestPanel] = useState(false);
  const [formData, setFormData]         = useState({ email: '', password: '', name: '' });
  const [error, setError]               = useState('');
  const [info, setInfo]                 = useState('');
  const [submitting, setSubmitting]     = useState(false);

  const finish = async (user: import('@supabase/supabase-js').User) => {
    const profile = buildLocalProfile(user);
    persistLocalUser(profile);
    await refreshJourneys().catch(() => undefined);
    navigate('/');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setInfo('');

    const email = formData.email.trim().toLowerCase();
    if (!email || !formData.password) { setError('Please fill in all fields'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Please enter a valid email address'); return; }
    if (!isLogin && !formData.name.trim()) { setError('Please enter your name'); return; }

    setSubmitting(true);
    try {
      if (isLogin) {
        const { user } = await signIn(email, formData.password);
        await finish(user);
      } else {
        const { user, session } = await signUp(email, formData.password, formData.name.trim());
        if (!session) {
          setInfo('Account created! Check your email to confirm your address, then sign in.');
          setIsLogin(true);
          setFormData(f => ({ ...f, password: '', name: '' }));
        } else {
          await finish(user);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleForgotPassword = async () => {
    const email = formData.email.trim().toLowerCase();
    if (!email) { setError('Enter your email above first, then click Forgot password.'); return; }
    setSubmitting(true);
    try {
      await sendPasswordReset(email);
      setInfo(`Password reset email sent to ${email}. Check your inbox.`);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reset email.');
    } finally {
      setSubmitting(false);
    }
  };

  const fillTestAccount = (acc: { name: string; email: string; password: string }) => {
    setFormData({ email: acc.email, password: acc.password, name: acc.name });
    setIsLogin(true);
    setError(''); setInfo('');
    setShowTestPanel(false);
  };

  const hero = getDestination('kyoto')!;

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-form-wrapper">
          {/* Brand */}
          <div className="login-brand">
            <span className="login-brand-mark"><Globe2 size={20} strokeWidth={1.75} /></span>
            TravelSphere
          </div>

          <div className="form-header">
            <h1>{isLogin ? 'Welcome back' : 'Create your account'}</h1>
            <p>{isLogin ? 'Sign in to see your trips and itineraries.' : 'Plan, book and keep every trip in one place.'}</p>
          </div>

          {!isSupabaseConfigured && (
            <div className="notice login-info" role="status">
              Account sign-in isn’t configured for this deployment. Continue as a guest — your trips are saved in this browser.
            </div>
          )}

          {/* Error / Info banners */}
          {error && (
            <div className="notice notice-danger login-error" role="alert">
              <AlertCircle size={18} /> {error}
            </div>
          )}
          {info && (
            <div className="notice notice-success login-info" role="status">
              {info}
            </div>
          )}

          {/* Test accounts panel */}
          {isLogin && SHOW_TEST_ACCOUNTS && isSupabaseConfigured && (
            <div className="test-accounts-section">
              <button
                type="button"
                className="test-accounts-toggle"
                onClick={() => setShowTestPanel(p => !p)}
                aria-expanded={showTestPanel}
              >
                <Zap size={14} />
                <span>Quick-fill test account</span>
                <ChevronDown size={14} className={`toggle-chevron ${showTestPanel ? 'open' : ''}`} />
              </button>

              {showTestPanel && (
                <div className="test-accounts-panel">
                  <p className="test-accounts-hint">Click any account to fill credentials instantly.</p>
                  <div className="test-accounts-list">
                    {TEST_ACCOUNTS.map((acc, i) => (
                      <button
                        key={acc.email}
                        type="button"
                        className="test-account-row"
                        onClick={() => fillTestAccount(acc)}
                      >
                        <span
                          className="test-account-avatar"
                          style={{ background: avatarColors[i] }}
                          aria-hidden="true"
                        >
                          {acc.name.charAt(0)}
                        </span>
                        <span className="test-account-info">
                          <span className="test-account-name">{acc.name}</span>
                          <span className="test-account-email">{acc.email}</span>
                        </span>
                        <span className="test-account-badge">{acc.role}</span>
                      </button>
                    ))}
                  </div>
                  <p className="test-accounts-pwd-hint">Test accounts (dev only) — created by <code>scripts/seed-test-users.sh</code></p>
                </div>
              )}
            </div>
          )}

          {/* Auth form */}
          <form onSubmit={handleSubmit} className="auth-form" noValidate>
            {!isLogin && (
              <div className="input-group">
                <label htmlFor="login-name">Full name</label>
                <div className="input-field">
                  <User size={18} className="field-icon" aria-hidden="true" />
                  <input
                    id="login-name"
                    type="text"
                    name="name"
                    placeholder="John Doe"
                    autoComplete="name"
                    value={formData.name}
                    onChange={handleChange}
                  />
                </div>
              </div>
            )}

            <div className="input-group">
              <label htmlFor="login-email">Email</label>
              <div className="input-field">
                <Mail size={18} className="field-icon" aria-hidden="true" />
                <input
                  id="login-email"
                  type="email"
                  name="email"
                  placeholder="name@example.com"
                  autoComplete="email"
                  inputMode="email"
                  value={formData.email}
                  onChange={handleChange}
                />
              </div>
            </div>

            <div className="input-group">
              <label htmlFor="login-password">Password</label>
              <div className="input-field">
                <Lock size={18} className="field-icon" aria-hidden="true" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  placeholder="••••••••"
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                  value={formData.password}
                  onChange={handleChange}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="form-actions">
              {isLogin && (
                <label className="remember-me" htmlFor="remember">
                  <input type="checkbox" id="remember" />
                  <span>Remember me</span>
                </label>
              )}
              {isLogin && (
                <button
                  type="button"
                  className="forgot-link"
                  onClick={handleForgotPassword}
                  disabled={submitting}
                >
                  Forgot password?
                </button>
              )}
            </div>

            <button type="submit" className="submit-btn" disabled={submitting}>
              {submitting ? <span className="spinner" /> : null}
              <span>{submitting ? (isLogin ? 'Signing in…' : 'Creating account…') : (isLogin ? 'Sign in' : 'Create account')}</span>
              {!submitting && <ArrowRight size={18} />}
            </button>
          </form>

          <button
            type="button"
            className="demo-btn guest-btn"
            onClick={() => { continueAsGuest(); navigate('/'); }}
            disabled={submitting}
          >
            Continue as guest
          </button>

          <div className="auth-switch">
            <p>
              {isLogin ? "Don't have an account?" : 'Already have an account?'}
              <button
                type="button"
                className="switch-btn"
                onClick={() => { setIsLogin(!isLogin); setError(''); setInfo(''); }}
              >
                {isLogin ? 'Create one' : 'Sign in'}
              </button>
            </p>
          </div>
        </div>

        {/* Hero visual */}
        <div className="login-visual" aria-hidden="true">
          <Photo src={hero.imageUrl} alt="" width={600} ratio="3 / 4" caption={`${hero.imageCaption} · ${hero.city}`} priority className="login-photo" />
          <div className="login-visual-card">
            <p className="eyebrow">Your next trip</p>
            <p className="login-visual-title">Day-by-day plans, hotels and safety information in one place.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
