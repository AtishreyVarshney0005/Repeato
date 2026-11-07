import { useEffect, useState } from 'react';
import Customer from './Customer';
import Owner from './Owner';
import Logo from './Logo';
import Footer from './Footer';
import { REWARDS } from './data';
import { api } from './api';
export default function App() {
    const [theme, setTheme] = useState(() => localStorage.getItem('repeato-theme') || 'light');
    const [page, setPage] = useState('checking');
    const [sessionError, setSessionError] = useState('');
    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        localStorage.setItem('repeato-theme', theme);
    }, [theme]);
    useEffect(() => { window.scrollTo(0, 0); }, [page]);
    useEffect(() => {
        const query = new URLSearchParams(window.location.search);
        const fromBusinessQr = query.has('business');
        const hasPartnerInvite = query.has('partnerInvite');
        api('/api/auth/me').then(({ user }) => {
            setPage(fromBusinessQr && user.role === 'customer'
                ? 'customer'
                : user.role === 'owner' ? 'owner'
                    : user.role === 'delivery_partner' ? 'rider' : 'customer');
        }).catch(error => {
            if (error.status !== 401) setSessionError(error.message);
            setPage(hasPartnerInvite ? 'partner' : fromBusinessQr ? 'customer' : 'home');
        });
    }, []);
    const goHome = () => setPage('home');
    if (page === 'checking') {
        return <main className="landing-page" aria-live="polite">Checking your session…</main>;
    }
    return (<>
      {page !== 'owner' && <div className="theme-switch" role="group" aria-label="Choose color theme">
        <button className={theme === 'light' ? 'active' : ''} aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>
          <span aria-hidden="true">☼</span><span>Light</span>
        </button>
        <button className={theme === 'dark' ? 'active' : ''} aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>
          <span aria-hidden="true">☾</span><span>Dark</span>
        </button>
      </div>}
      {page === 'home' && <main className="landing-page">
        {sessionError && <p className="auth-error" role="alert">{sessionError}</p>}
        <header className="landing-header">
          <div className="landing-brand"><span className="landing-logo"><Logo size={28}/></span><b>Repeato</b><span className="brand-divider"/><span className="brand-tagline">Good things come back.</span></div>
          <span className="landing-status"><i/> Your local rewards club</span>
        </header>
        <section className="landing-hero">
          <div className="landing-copy" id="about">
            <span className="landing-kicker"><i/> A LITTLE MORE LOVE FOR LOCAL</span>
            <h1>Make every visit<br/>feel <em>worth it.</em></h1>
            <p className="landing-description">Collect points at the neighbourhood spots you love and turn your everyday visits into something extra.</p>
            <div className="landing-perks" id="how-it-works">
              <span><b>01</b> Visit a local favourite</span>
              <span><b>02</b> Collect points</span>
              <span><b>03</b> Enjoy a little treat</span>
            </div>
          </div>
          <section className="auth-card portal-card landing-login">
            <span className="eyebrow">WELCOME TO REPEATO</span>
            <h2>How would you like to continue?</h2>
            <p className="muted">Choose your space to get started.</p>
            <div className="portal-options">
              <button className="portal-option" onClick={() => setPage('customer')}>
                <span className="portal-option-icon">♡</span>
                <span className="portal-option-copy"><b>I'm a customer</b><small>Sign in, collect points and see your rewards</small></span>
                <span className="portal-arrow">→</span>
              </button>
              <button className="portal-option" onClick={() => setPage('owner-login')}>
                <span className="portal-option-icon owner-icon">↗</span>
                <span className="portal-option-copy"><b>I'm a restaurant owner</b><small>Manage your restaurant's loyalty programme</small></span>
                <span className="portal-arrow">→</span>
              </button>
            </div>
            <div className="landing-login-foot"><span>✦</span> One account. More reasons to come back.</div>
          </section>
          <div className="landing-stamp"><span>VISIT</span><b>✳</b><span>EARN</span><b>✳</b><span>REPEAT</span></div>
        </section>
        <section className="landing-rewards" id="rewards">
          <div className="landing-section-heading">
            <div><span className="eyebrow">THE GOOD STUFF</span><h2>Little treats. Big reasons to return.</h2></div>
            <p>Earn points as you go.<br/>Spend them on what you love.</p>
          </div>
          <div className="landing-reward-grid">
            {REWARDS.map((reward, index) => <article className={`landing-reward reward-${index + 1}`} key={reward.id}>
              <span className="reward-icon">{reward.icon}</span>
              <span className="reward-points">{reward.pts} POINTS</span>
              <h3>{reward.name}</h3>
              <p>{index === 0 ? 'Your next coffee could be on us.' : index === 1 ? 'A little something off your next visit.' : 'Make an ordinary day a treat day.'}</p>
            </article>)}
          </div>
        </section>
      </main>}
      {page === 'home' && <Footer onNavigate={destination => setPage(destination === 'owner' ? 'owner-login' : 'customer')}/>}
      {page === 'customer' && <Customer theme={theme} setTheme={setTheme} onBack={goHome}/>}
      {(page === 'partner' || page === 'rider') && <DeliveryPartner
        inviteToken={new URLSearchParams(window.location.search).get('partnerInvite') || ''}
        signedIn={page === 'rider'}
        onLogin={() => setPage('rider')}
        onLogout={async () => { await api('/api/auth/logout', { method: 'POST' }); setPage('home'); }}/>}
      {page === 'owner-login' && <OwnerLogin onBack={goHome} onLogin={() => setPage('owner')}/>}
      {page === 'owner' && <Owner theme={theme} setTheme={setTheme} onLogout={async () => { await api('/api/auth/logout', { method: 'POST' }); goHome(); }}/>}
    </>);
}

function OwnerLogin({ onBack, onLogin }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [businessName, setBusinessName] = useState('');
    const [mode, setMode] = useState('signin');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const signIn = async (event) => {
        event.preventDefault();
        setError('');
        setLoading(true);
        try {
            await api(mode === 'signup' ? '/api/auth/register-owner' : '/api/auth/login', {
                method: 'POST',
                body: JSON.stringify(mode === 'signup'
                    ? { name, businessName, email, password }
                    : { email, password, role: 'owner' })
            });
            onLogin();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading(false);
        }
    };
    return <main className="auth-page portal-page">
      <div className="auth-layout portal-layout">
        <section className="auth-story auth-story-compact">
          <div className="row auth-brand"><div className="logo-tile xs"><Logo size={30}/></div><b>Repeato</b></div>
          <div className="auth-copy">
            <span className="eyebrow">FOR LOCAL BUSINESS</span>
            <h1>Your business.<br/><span>Your regulars.</span></h1>
            <p>See how your loyalty programme is bringing customers back.</p>
          </div>
          <div className="auth-note"><span>✦</span> Your neighbourhood, a little more rewarding.</div>
        </section>
        <section className="auth-card auth-card-form portal-card">
          <button className="auth-back" onClick={onBack}>← <span>Main menu</span></button>
          <span className="eyebrow">OWNER PORTAL</span>
          <h2>{mode === 'signup' ? 'Create your business account' : 'Owner login'}</h2>
          <p className="muted">{mode === 'signup' ? 'Set up your business loyalty programme.' : 'Sign in to your business dashboard.'}</p>
          <form className="auth-form" onSubmit={signIn}>
            {mode === 'signup' && <>
              <label className="auth-input-wrap">
                <span>Your name</span>
                <input autoComplete="name" value={name} onChange={e => setName(e.target.value)} required/>
              </label>
              <label className="auth-input-wrap">
                <span>Business name</span>
                <input value={businessName} onChange={e => setBusinessName(e.target.value)} required/>
              </label>
            </>}
            <label className="auth-input-wrap">
              <span>Email address</span>
              <input type="email" autoComplete="email" inputMode="email" placeholder="you@business.com" value={email} onChange={e => setEmail(e.target.value)} required/>
            </label>
            <label className="auth-input-wrap">
              <span>Password</span>
              <div className="auth-password">
                <input type={showPassword ? 'text' : 'password'} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} placeholder="At least 8 characters" value={password} onChange={e => setPassword(e.target.value)} minLength={8} required/>
                <button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button>
              </div>
            </label>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="btn auth-primary" type="submit" disabled={loading}>{loading ? 'Please wait…' : mode === 'signup' ? 'Create business account' : 'Sign in to dashboard'} <span>→</span></button>
          </form>
          <p className="auth-mode-toggle">{mode === 'signup' ? 'Already have a business account?' : 'New to Repeato?'} <button type="button" onClick={() => { setError(''); setMode(mode === 'signup' ? 'signin' : 'signup'); }}>{mode === 'signup' ? 'Sign in' : 'Create a business account'}</button></p>
        </section>
      </div>
    </main>;
}
