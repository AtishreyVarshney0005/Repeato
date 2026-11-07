import { useEffect, useState } from 'react';
import { api } from './api';

export default function DeliveryPartner({ inviteToken, signedIn, onLogin, onLogout }) {
    const [mode, setMode] = useState(signedIn ? 'dashboard' : inviteToken ? 'register' : 'signin');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [orders, setOrders] = useState([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const loadOrders = async () => {
        const result = await api('/api/delivery-partner/orders');
        setOrders(result.orders);
    };

    useEffect(() => {
        if (mode !== 'dashboard') return undefined;
        loadOrders().catch(requestError => setError(requestError.message));
        const timer = setInterval(() => {
            loadOrders().catch(requestError => setError(requestError.message));
        }, 7000);
        return () => clearInterval(timer);
    }, [mode]);

    const submit = async event => {
        event.preventDefault();
        setLoading(true);
        setError('');
        try {
            if (mode === 'register') {
                await api('/api/delivery-partner/register', {
                    method: 'POST',
                    body: JSON.stringify({ name, email, password, inviteToken })
                });
            } else {
                await api('/api/auth/login', {
                    method: 'POST',
                    body: JSON.stringify({ email, password, role: 'delivery_partner' })
                });
            }
            await onLogin();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading(false);
        }
    };

    const markDelivered = async orderId => {
        setError('');
        try {
            await api(`/api/delivery-partner/orders/${orderId}`, { method: 'PATCH' });
            await loadOrders();
        } catch (requestError) {
            setError(requestError.message);
        }
    };

    if (mode !== 'dashboard') {
        return <main className="partner-auth-page">
          <form className="card partner-auth-card" onSubmit={submit}>
            <span className="eyebrow">REPEATO DELIVERY</span>
            <h1>{mode === 'register' ? 'Join as a delivery partner' : 'Delivery partner sign in'}</h1>
            <p className="muted">{mode === 'register'
                ? 'Finish setting up your account using the restaurant invitation.'
                : 'Sign in to view your assigned deliveries.'}</p>
            {mode === 'register' && <label>Your name<input autoComplete="name" required maxLength={100}
              value={name} onChange={event => setName(event.target.value)}/></label>}
            <label>Email address<input type="email" autoComplete="email" required maxLength={254}
              value={email} onChange={event => setEmail(event.target.value)}/></label>
            <label>Password<input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              minLength={8} maxLength={128} required value={password}
              onChange={event => setPassword(event.target.value)}/></label>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="btn" disabled={loading}>{loading ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}</button>
            {!inviteToken && <p className="small muted">To create an account, ask a restaurant owner for a one-time invitation link.</p>}
          </form>
        </main>;
    }

    return <main className="partner-dashboard">
      <header className="partner-dashboard-header">
        <div><span className="eyebrow">REPEATO DELIVERY</span><h1>Your deliveries</h1></div>
        <div className="row gap">
          <button className="btn ghost sm" onClick={() => loadOrders().catch(requestError => setError(requestError.message))}>Refresh</button>
          <button className="link" onClick={onLogout}>Sign out</button>
        </div>
      </header>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {orders.map(order => <article className="card partner-order-card" key={order.id}>
        <div className="row"><div><b>Order #{order.id} · {order.businessName}</b>
          <p className="small muted">{new Date(`${order.createdAt.replace(' ', 'T')}Z`).toLocaleString()}</p></div>
          <span className={`order-status ${order.status}`}>{order.status.replaceAll('_', ' ')}</span></div>
        <p><b>Deliver to:</b> {order.deliveryAddress}</p>
        <p className="small muted">Customer: {order.customerName}</p>
        <div className="customer-order-items">{order.items.map((item, index) => <p key={`${item.name}-${index}`}>
          {item.quantity} × {item.name}{item.variantName ? ` (${item.variantName})` : ''}
        </p>)}</div>
        <div className="row"><span className="small muted">
          {order.paymentMethod === 'cash_on_delivery' ? 'Collect cash on delivery' : `Paid online · ${order.paymentStatus}`}
        </span><b>{formatPrice(order.totalPaise)}</b></div>
        {order.status === 'out_for_delivery' && <button className="btn sm" onClick={() => markDelivered(order.id)}>Mark delivered</button>}
      </article>)}
      {!orders.length && <section className="card partner-order-empty"><span>🛵</span><h2>No assigned deliveries</h2>
        <p className="muted">The restaurant will assign ready orders to you here.</p></section>}
    </main>;
}

function formatPrice(pricePaise) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(pricePaise / 100);
}
