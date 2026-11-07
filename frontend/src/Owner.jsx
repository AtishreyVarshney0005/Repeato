import { useEffect, useState } from 'react';
import Logo from './Logo';
import { BUSINESS } from './data';
import { api } from './api';
import QRCode from 'qrcode';
const NAV = ['Overview', 'Orders', 'Delivery', 'Customers', 'Rewards', 'Food Menu', 'QR and NFC', 'Settings'];
const NAV_ICONS = {
    Overview: '▦', Orders: '□', Delivery: '↗', Customers: '○',
    Rewards: '✳', 'Food Menu': '≡', 'QR and NFC': '▤', Settings: '⚙'
};
const MAX_MENU_IMAGE_SIZE = 900 * 1024;

async function optimizeMenuImage(file) {
    const imageUrl = URL.createObjectURL(file);
    try {
        const image = new Image();
        await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(new Error('This image could not be opened. Try a JPG, PNG, or WebP photo.'));
            image.src = imageUrl;
        });
        let width = image.naturalWidth;
        let height = image.naturalHeight;
        if (!width || !height) throw new Error('This image could not be opened. Try a JPG, PNG, or WebP photo.');
        const scale = Math.min(1, 1600 / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Photo optimization is not supported in this browser.');

        for (let resize = 0; resize < 5; resize += 1) {
            canvas.width = width;
            canvas.height = height;
            context.drawImage(image, 0, 0, width, height);
            for (const quality of [0.82, 0.72, 0.62, 0.52]) {
                const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
                if (!blob) throw new Error('This image could not be optimized. Try another photo.');
                if (blob.size <= MAX_MENU_IMAGE_SIZE) {
                    return await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => typeof reader.result === 'string'
                            ? resolve(reader.result)
                            : reject(new Error('Could not read the optimized photo.'));
                        reader.onerror = () => reject(new Error('Could not read the optimized photo.'));
                        reader.readAsDataURL(blob);
                    });
                }
            }
            width = Math.round(width * 0.75);
            height = Math.round(height * 0.75);
        }
        throw new Error('This photo is too large to add. Try a smaller image.');
    } finally {
        URL.revokeObjectURL(imageUrl);
    }
}

export default function Owner({ onLogout, theme, setTheme }) {
    const [nav, setNav] = useState('Overview');
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [rewards, setRewards] = useState([]);
    const [dashboard, setDashboard] = useState(null);
    const [customers, setCustomers] = useState([]);
    const [checkIns, setCheckIns] = useState([]);
    const [orders, setOrders] = useState([]);
    const [deliveryPartners, setDeliveryPartners] = useState([]);
    const [inviteEmail, setInviteEmail] = useState('');
    const [partnerInviteUrl, setPartnerInviteUrl] = useState('');
    const [menuItems, setMenuItems] = useState([]);
    const [menuDraft, setMenuDraft] = useState({
        name: '', category: 'Main', description: '', price: '', imageData: '',
        dietaryType: '', spiceLevel: '', allergens: '', variants: []
    });
    const [businessName, setBusinessName] = useState(BUSINESS);
    const [settings, setSettings] = useState({ name: BUSINESS, pointsPerVisit: 10, menuUrl: '', id: null });
    const [qr, setQr] = useState('');
    const [error, setError] = useState('');
    const [processingMenuImage, setProcessingMenuImage] = useState(false);
    const loadDashboard = async () => {
        const [ownerData, rewardData, session, customerData, checkInData, settingsData, menuData, orderData, partnerData] = await Promise.all([
            api('/api/owner/dashboard'),
            api('/api/owner/rewards'),
            api('/api/auth/me'),
            api('/api/owner/customers'),
            api('/api/owner/check-ins'),
            api('/api/owner/settings'),
            api('/api/owner/menu'),
            api('/api/owner/orders'),
            api('/api/owner/delivery-partners')
        ]);
        setDashboard(ownerData);
        setRewards(rewardData.rewards);
        setCustomers(customerData.customers);
        setCheckIns(checkInData.checkIns);
        setMenuItems(menuData.menuItems);
        setOrders(orderData.orders);
        setDeliveryPartners(partnerData.partners);
        setBusinessName(session.user.businessName);
        setSettings(settingsData.business);
    };
    useEffect(() => {
        loadDashboard().catch(requestError => setError(requestError.message));
    }, []);
    useEffect(() => {
        let active = true;
        if (settings.id) {
            QRCode.toDataURL(`${window.location.origin}/?business=${settings.id}`, { width: 240, margin: 2 })
                .then(value => { if (active) setQr(value); })
                .catch(requestError => { if (active) setError(`Could not create QR code: ${requestError.message}`); });
        }
        return () => { active = false; };
    }, [settings.id]);
    useEffect(() => {
        if (nav !== 'QR and NFC') return undefined;
        const timer = setInterval(() => {
            api('/api/owner/check-ins')
                .then(result => setCheckIns(result.checkIns))
                .catch(requestError => setError(requestError.message));
        }, 5000);
        return () => clearInterval(timer);
    }, [nav]);
    useEffect(() => {
        if (nav !== 'Orders') return undefined;
        const loadOrders = () => api('/api/owner/orders')
            .then(result => setOrders(result.orders))
            .catch(requestError => setError(requestError.message));
        loadOrders();
        const timer = setInterval(loadOrders, 5000);
        return () => clearInterval(timer);
    }, [nav]);
    useEffect(() => {
        if (!mobileNavOpen) return undefined;
        const closeOnEscape = event => {
            if (event.key === 'Escape') setMobileNavOpen(false);
        };
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, [mobileNavOpen]);
    const refresh = async () => {
        setError('');
        try {
            await loadDashboard();
        } catch (requestError) {
            setError(requestError.message);
        }
    };
    const toggle = async (reward) => {
        setError('');
        try {
            const result = await api(`/api/owner/rewards/${reward.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ on: !reward.on })
            });
            setRewards(current => current.map(item => item.id === reward.id ? result.reward : item));
        } catch (requestError) {
            setError(requestError.message);
        }
    };
    const approveVisit = async (checkInId) => {
        setError('');
        try {
            await api(`/api/owner/check-ins/${checkInId}/approve`, { method: 'POST' });
            await loadDashboard();
        } catch (requestError) {
            setError(requestError.message);
        }
    };
    const addReward = async () => {
        const name = prompt('Reward name? (for example: Free meal)');
        const pts = Number(prompt('Points required to claim this reward?'));
        if (!name || !Number.isSafeInteger(pts) || pts <= 0) return;
        setError('');
        try {
            const result = await api('/api/owner/rewards', {
                method: 'POST',
                body: JSON.stringify({ name, pts })
            });
            setRewards(current => [...current, result.reward]);
        } catch (requestError) {
            setError(requestError.message);
        }
    };
    const saveSettings = async (event) => {
        event.preventDefault();
        setError('');
        try {
            const result = await api('/api/owner/settings', {
                method: 'PATCH',
                body: JSON.stringify({
                    name: settings.name,
                    pointsPerVisit: Number(settings.pointsPerVisit),
                    menuUrl: settings.menuUrl,
                    latitude: settings.latitude === '' || settings.latitude === null ? null : Number(settings.latitude),
                    longitude: settings.longitude === '' || settings.longitude === null ? null : Number(settings.longitude)
                })
            });
            setSettings(result.business);
            setBusinessName(result.business.name);
            setError('');
        } catch (requestError) {
            setError(requestError.message);
        }
    };
    const addMenuItem = async (event) => {
        event.preventDefault();
        setError('');
        try {
            const result = await api('/api/owner/menu', {
                method: 'POST',
                body: JSON.stringify({
                    ...menuDraft,
                    price: menuDraft.variants.length ? undefined : Number(menuDraft.price),
                    variants: menuDraft.variants.map(variant => ({ ...variant, price: Number(variant.price) }))
                })
            });
            setMenuItems(current => [...current, result.menuItem].sort((a, b) =>
                a.category.localeCompare(b.category) || a.name.localeCompare(b.name)));
            setMenuDraft({
                name: '', category: 'Main', description: '', price: '', imageData: '',
                dietaryType: '', spiceLevel: '', allergens: '', variants: []
            });
        } catch (requestError) {
            setError(requestError.message);
        }
    };
    const selectMenuImage = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        event.target.value = '';
        if (!file.type.startsWith('image/') || file.size > 15 * 1024 * 1024) {
            setError('Choose an image smaller than 15 MB.');
            return;
        }
        setError('');
        setProcessingMenuImage(true);
        try {
            const imageData = await optimizeMenuImage(file);
            setMenuDraft(current => ({ ...current, imageData }));
        } catch (imageError) {
            setError(imageError.message);
        } finally {
            setProcessingMenuImage(false);
        }
    };
    const toggleMenuItem = async (item) => {
        setError('');
        try {
            const result = await api(`/api/owner/menu/${item.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ available: !item.available })
            });
            setMenuItems(current => current.map(currentItem =>
                currentItem.id === item.id ? result.menuItem : currentItem));
        } catch (requestError) {
            setError(requestError.message);
        }
    };
    const deleteMenuItem = async (item) => {
        if (!window.confirm(`Remove "${item.name}" from your food menu?`)) return;
        setError('');
        try {
            await api(`/api/owner/menu/${item.id}`, { method: 'DELETE' });
            setMenuItems(current => current.filter(currentItem => currentItem.id !== item.id));
        } catch (requestError) {
            setError(requestError.message);
        }
    };
    const updateOrderStatus = async (order, status) => {
        setError('');
        try {
            const result = await api(`/api/owner/orders/${order.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ status })
            });
            setOrders(current => current.map(item => item.id === order.id ? result.order : item));
        } catch (requestError) {
            setError(requestError.message);
        }
    };
    const inviteDeliveryPartner = async event => {
        event.preventDefault();
        setError('');
        try {
            const result = await api('/api/owner/delivery-partners/invites', {
                method: 'POST',
                body: JSON.stringify({ email: inviteEmail })
            });
            setPartnerInviteUrl(result.inviteUrl);
            setInviteEmail('');
        } catch (requestError) {
            setError(requestError.message);
        }
    };
    const dispatchOrder = async (order, partnerId) => {
        setError('');
        try {
            await api(`/api/owner/orders/${order.id}/dispatch`, {
                method: 'PATCH',
                body: JSON.stringify({ partnerId: Number(partnerId) })
            });
            const result = await api('/api/owner/orders');
            setOrders(result.orders);
        } catch (requestError) {
            setError(requestError.message);
        }
    };
    const setPartnerActive = async (partner, active) => {
        setError('');
        try {
            await api(`/api/owner/delivery-partners/${partner.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ active })
            });
            setDeliveryPartners(current => current.map(item => item.id === partner.id ? { ...item, active } : item));
        } catch (requestError) {
            setError(requestError.message);
        }
    };
    const captureRestaurantLocation = () => {
        if (!navigator.geolocation) {
            setError('Location is not supported by this browser.');
            return;
        }
        navigator.geolocation.getCurrentPosition(position => {
            setSettings(current => ({
                ...current,
                latitude: position.coords.latitude,
                longitude: position.coords.longitude
            }));
        }, locationError => {
            setError(locationError.code === locationError.PERMISSION_DENIED
                ? 'Allow location access to set your restaurant location.'
                : 'Could not get your location. Please try again.');
        }, { enableHighAccuracy: true, timeout: 10000 });
    };
    const writeNfcTag = async () => {
        const NfcReader = window.NDEFReader;
        if (!NfcReader) {
            setError('NFC writing is not supported by this browser. Use the QR code instead.');
            return;
        }
        try {
            await new NfcReader().write({ records: [{ recordType: 'url', data: `${window.location.origin}/?business=${settings.id}` }] });
            setError('');
        } catch (requestError) {
            setError(`Could not write the NFC tag: ${requestError.message}`);
        }
    };
    const stats = dashboard?.stats;
    const weeklyVisits = dashboard?.weeklyVisits ?? [];
    const maxWeeklyVisits = Math.max(...weeklyVisits.map(({ total }) => total), 1);
    return (<div className="owner">
      {mobileNavOpen && <button className="owner-nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}/>}
      <aside className={mobileNavOpen ? 'mobile-open' : ''}>
        <div className="row brand"><Logo size={30}/><b>Repeato</b>
          <button className="owner-nav-close" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}>×</button></div>
        <span className="owner-nav-caption">WORKSPACE</span>
        <div className="theme-options" role="group" aria-label="Choose color theme">
          <button className={theme === 'light' ? 'active' : ''} aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>Light</button>
          <button className={theme === 'dark' ? 'active' : ''} aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>Dark</button>
        </div>
        {NAV.map(n => <button key={n} className={nav === n ? 'on' : ''} aria-current={nav === n ? 'page' : undefined}
          onClick={() => { setNav(n); setMobileNavOpen(false); }}>
          <span className="owner-nav-icon" aria-hidden="true">{NAV_ICONS[n]}</span>{n}
        </button>)}
        <button className="owner-logout" onClick={async () => {
            try {
                await onLogout();
            } catch (requestError) {
                setError(requestError.message);
            }
        }}>↪ Main menu</button>
      </aside>
      <div className="owner-content">
      <main>
        <div className="row head">
          <div className="owner-page-heading">
            <button className="owner-nav-toggle" aria-label="Open navigation" aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen(true)}>☰</button>
            <div><span className="muted small">Owner dashboard</span><h2 className="big sm">{businessName}</h2></div>
          </div>
          <div className="row gap">
            <span className="owner-period-label"><span aria-hidden="true">◷</span> Weekly overview</span>
            <button className="btn ghost sm" onClick={refresh}>Refresh</button>
            <button className="btn sm" onClick={() => { setNav('QR and NFC'); setMobileNavOpen(false); }}>Show counter QR</button>
          </div>
        </div>
        {error && <div className="card auth-error" role="alert">{error}</div>}
        {nav === 'Overview' && (<>
          <div className="grid4 owner-metric-grid">
            <Stat l="Total customers" v={stats?.customers ?? '…'} s="Registered accounts" g/>
            <Stat l="Returning customers" v={stats?.returningCustomers ?? '…'} s="2+ verified visits"/>
            <Stat l="New customers" v={stats?.newCustomers ?? '…'} s="Signed up this week"/>
            <Stat l="Repeat visit rate" v={`${stats?.repeatVisitRate ?? 0}%`} s="Customers with 2+ verified visits"/>
            <Stat l="Points issued" v={(stats?.pointsIssued ?? 0).toLocaleString()} s="This week" y/>
            <Stat l="Points redeemed" v={(stats?.pointsRedeemed ?? 0).toLocaleString()} s={`${stats?.rewardsClaimed ?? 0} rewards claimed this week`} y/>
          </div>
          <div className="grid2">
            <div className="card">
              <div className="row"><h3>Visits this week</h3><span className="small muted"><i className="dot y"/> Approved visits</span></div>
              <div className="chart" role="img" aria-label="Approved customer visits each day this week">{weeklyVisits.map(({ day, total }) => (<div key={day} className="colm"><small>{total}</small>
                  <div className="stack" style={{ height: Math.max(6, total / maxWeeklyVisits * 144) }}><i className="n" style={{ flex: total || 1 }}/></div>
                  <small className="muted">{day}</small></div>))}</div>
              <p className="small">Verified customer visits earn {settings.pointsPerVisit} points each.</p>
            </div>
            <div className="card"><h3>Top regulars</h3>
              {(dashboard?.topCustomers ?? []).map((customer, i) => <div className="row item" key={customer.email}><span className="rank">{i + 1}</span>
                <div className="grow"><b>{customer.name}</b><div className="small muted">{customer.email} · {customer.points.toLocaleString()} pts</div></div><b>{customer.visits} visits</b></div>)}
              {!dashboard?.topCustomers?.length && <p className="small muted">No customers have joined yet.</p>}</div>
          </div>
          <div className="grid2">
            <div className="card"><div className="row"><h3>Your rewards</h3><button className="btn sm" onClick={addReward}>+ Add reward</button></div>
              {rewards.map(r => <div className="row item" key={r.id}><div className="grow"><b>{r.name}</b>
                <div className="small muted">{r.pts} points · claimed {r.claimed} times</div></div>
                <button className={'tog' + (r.on ? ' on' : '')} onClick={() => toggle(r)} aria-label={`Turn ${r.name} ${r.on ? 'off' : 'on'}`} aria-pressed={r.on}><i /></button></div>)}</div>
            <div className="card"><h3>Recent redemptions</h3>
              {(dashboard?.redemptions ?? []).map((item, index) => <div className="row item" key={`${item.name}-${index}`}><div className="ico">🎁</div>
                <div className="grow"><b>{item.name}</b><div className="small muted">{item.email}</div></div><span className="small muted">{item.when}</span></div>)}
              {!dashboard?.redemptions?.length && <p className="small muted">No rewards have been redeemed yet.</p>}</div>
          </div></>)}
        {nav === 'Orders' && <section className="card owner-orders">
          <div className="row"><div><h3>Incoming orders</h3><p className="small muted">New orders refresh automatically · pickup and delivery</p></div>
            <span className="menu-count">{orders.filter(order => order.status === 'pending').length} new</span></div>
          {orders.map(order => <article className="owner-order" key={order.id}>
            <div className="row"><div><b>Order #{order.id} · {order.customerName}</b>
              <p className="small muted">{order.customerEmail} · {formatOrderTime(order.createdAt)}</p></div>
              <span className={`order-status ${order.status}`}>{order.status}</span></div>
            <div className="owner-order-items">{order.items.map((item, index) => <p key={`${item.name}-${index}`}>
              {item.quantity} × {item.name}{item.variantName ? ` (${item.variantName})` : ''} · {formatPrice(item.unitPricePaise * item.quantity)}
            </p>)}</div>
            {order.fulfillment === 'delivery' && <p className="small muted">Deliver to: {order.deliveryAddress} · {order.deliveryFeePaise === 0 ? 'Free delivery' : formatPrice(order.deliveryFeePaise)}</p>}
            <div className="row"><span className="small muted">{order.fulfillment === 'delivery' ? 'Delivery' : 'Pickup'} · {
              order.paymentMethod === 'razorpay' ? `Razorpay · ${order.paymentStatus}` :
              order.paymentMethod === 'cash_on_delivery' ? 'Cash on delivery' : 'Pay in cash'
            }</span><b>{formatPrice(order.totalPaise)}</b></div>
            {order.status === 'pending' && <div className="row owner-order-actions">
              <button className="btn sm" onClick={() => updateOrderStatus(order, 'accepted')}>Accept order</button>
              <button className="btn ghost sm" onClick={() => updateOrderStatus(order, 'rejected')}>Reject</button>
            </div>}
            {order.status === 'accepted' && <button className="btn sm" onClick={() => updateOrderStatus(order, 'preparing')}>Start preparing</button>}
            {order.status === 'preparing' && <button className="btn sm" onClick={() => updateOrderStatus(order, 'ready')}>Mark ready</button>}
            {order.status === 'ready' && order.fulfillment === 'delivery' && <div className="owner-order-actions">
              <label>Assign delivery partner<select defaultValue="" onChange={event => {
                if (event.target.value) dispatchOrder(order, event.target.value);
              }}>
                <option value="" disabled>Choose an active partner</option>
                {deliveryPartners.filter(partner => partner.active).map(partner =>
                  <option key={partner.id} value={partner.id}>{partner.name} · {partner.email}</option>)}
              </select></label>
              {!deliveryPartners.some(partner => partner.active) && <p className="small muted">Invite an active delivery partner in the Delivery tab.</p>}
            </div>}
            {order.status === 'out_for_delivery' && <p className="small muted">Assigned to {order.deliveryPartnerName ?? 'delivery partner'} · awaiting delivery confirmation</p>}
          </article>)}
          {!orders.length && <div className="owner-menu-empty"><span>🛍</span><b>No orders yet</b><p>Customer orders will appear here.</p></div>}
        </section>}
        {nav === 'Delivery' && <section className="owner-delivery">
          <div className="card owner-delivery-status">
            <div className="row"><div><h3>Restaurant delivery</h3>
              <p className="small muted">Customers can choose delivery after the restaurant location is saved.</p></div>
              {settings.latitude !== null && settings.latitude !== undefined && settings.latitude !== ''
                && settings.longitude !== null && settings.longitude !== undefined && settings.longitude !== ''
                ? <span className="owner-delivery-badge active"><i/> Enabled</span>
                : <span className="owner-delivery-badge"><i/> Not set up</span>}
            </div>
            {settings.latitude !== null && settings.latitude !== undefined && settings.latitude !== ''
              && settings.longitude !== null && settings.longitude !== undefined && settings.longitude !== ''
              ? <p className="small muted">Location is saved. Set up an active delivery partner below, then assign them to ready delivery orders.</p>
              : <div className="owner-delivery-next-step"><p className="small muted">Set the restaurant location to enable customer delivery and distance-based fees.</p>
                <button className="btn ghost sm" onClick={() => setNav('Settings')}>Set restaurant location</button></div>}
          </div>
          <div className="card">
            <h3>Delivery partners</h3>
            <p className="small muted">Invite a trusted delivery partner. Share the one-time registration link with them.</p>
            <form className="owner-delivery-invite" onSubmit={inviteDeliveryPartner}>
              <label>Partner email<input type="email" required maxLength={254} value={inviteEmail}
                onChange={event => setInviteEmail(event.target.value)} placeholder="partner@example.com"/></label>
              <button className="btn sm">Create invitation</button>
            </form>
            {partnerInviteUrl && <div className="owner-invite-link">
              <label>One-time invitation link<input readOnly value={partnerInviteUrl} onFocus={event => event.target.select()}/></label>
              <p className="small muted">Valid for 7 days. Copy and send it directly to the invited partner.</p>
            </div>}
            {deliveryPartners.map(partner => <div className="row item" key={partner.id}>
              <div className="grow"><b>{partner.name}</b><div className="small muted">{partner.email}</div></div>
              <span className="small">{partner.active ? 'Active' : 'Disabled'}</span>
              <button className="btn ghost sm" onClick={() => setPartnerActive(partner, !partner.active)}>
                {partner.active ? 'Disable' : 'Enable'}
              </button>
            </div>)}
            {!deliveryPartners.length && <p className="small muted">No delivery partners have joined yet.</p>}
          </div>
          <div className="card"><h3>Delivery pricing</h3>
            <p>Free within 5 km. Beyond 5 km: ₹20 base fee plus ₹10 for each additional kilometer.</p>
            <p className="small muted">Distance uses a straight-line estimate from the restaurant and customer GPS coordinates.</p>
          </div>
        </section>}
        {nav === 'Customers' && <div className="card">
          <h3>Customers</h3>
          {customers.map(customer => <div className="row item" key={customer.id}>
            <div className="grow"><b>{customer.name}</b><div className="small muted">{customer.email}</div></div>
            <span className="small">{customer.visits} visits · {customer.rewards_claimed} rewards</span>
            <b>{customer.points.toLocaleString()} pts</b>
          </div>)}
          {!customers.length && <p className="small muted">Customers will appear here after they join.</p>}
        </div>}
        {nav === 'Rewards' && <div className="card">
          <div className="row"><div><h3>Rewards</h3><p className="small muted">Set what customers can claim with their points, such as a free meal.</p></div>
            <button className="btn sm" onClick={addReward}>+ Add reward</button></div>
          {rewards.map(reward => <div className="row item" key={reward.id}>
            <div className="ico">{reward.icon}</div><div className="grow"><b>{reward.name}</b>
              <div className="small muted">{reward.pts} points · claimed {reward.claimed} times · {reward.on ? 'Active' : 'Inactive'}</div></div>
            <button className={'tog' + (reward.on ? ' on' : '')} onClick={() => toggle(reward)}
              aria-label={`Turn ${reward.name} ${reward.on ? 'off' : 'on'}`} aria-pressed={reward.on}><i /></button>
          </div>)}
        </div>}
        {nav === 'Food Menu' && <>
          <form className="card owner-menu-form" onSubmit={addMenuItem}>
            <div><span className="eyebrow">YOUR RESTAURANT</span><h3>Food menu</h3>
              <p className="small muted">Add dishes here; available items appear in your customers’ app menu.</p></div>
            <div className="owner-menu-fields">
              <label>Dish name<input value={menuDraft.name} maxLength={100} onChange={event => setMenuDraft(current => ({ ...current, name: event.target.value }))} placeholder="e.g. Paneer tikka" required/></label>
              <label>Category<input value={menuDraft.category} maxLength={60} onChange={event => setMenuDraft(current => ({ ...current, category: event.target.value }))} placeholder="e.g. Starters" required/></label>
              <label>Description <span className="muted">(optional)</span><input value={menuDraft.description} maxLength={300} onChange={event => setMenuDraft(current => ({ ...current, description: event.target.value }))} placeholder="A short description"/></label>
              <label>Food photo <span className="muted">(image · max 15 MB; optimized automatically)</span><input type="file" accept="image/*" onChange={selectMenuImage}/></label>
              {processingMenuImage && <p className="small muted" role="status">Optimizing photo…</p>}
              <label>Dietary type
                <select value={menuDraft.dietaryType} onChange={event => setMenuDraft(current => ({ ...current, dietaryType: event.target.value }))}>
                  <option value="">Not specified</option><option value="vegetarian">Vegetarian</option>
                  <option value="non-vegetarian">Non-vegetarian</option><option value="vegan">Vegan</option>
                </select>
              </label>
              <label>Spice level
                <select value={menuDraft.spiceLevel} onChange={event => setMenuDraft(current => ({ ...current, spiceLevel: event.target.value }))}>
                  <option value="">Not specified</option><option value="mild">Mild</option>
                  <option value="medium">Medium</option><option value="hot">Hot</option>
                </select>
              </label>
              <label>Allergens <span className="muted">(optional)</span><input value={menuDraft.allergens} maxLength={300} onChange={event => setMenuDraft(current => ({ ...current, allergens: event.target.value }))} placeholder="e.g. dairy, peanuts"/></label>
              {menuDraft.variants.length
                ? <div className="owner-menu-variants">
                  <div className="row"><b>Size / variant prices</b><button className="btn ghost sm" type="button" onClick={() => setMenuDraft(current => ({ ...current, variants: [...current.variants, { name: '', price: '' }] }))} disabled={menuDraft.variants.length >= 10}>+ Add size</button></div>
                  {menuDraft.variants.map((variant, index) => <div className="owner-menu-variant" key={index}>
                    <label>Size<input value={variant.name} maxLength={30} onChange={event => setMenuDraft(current => ({ ...current, variants: current.variants.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) }))} placeholder="e.g. Regular" required/></label>
                    <label>Price (₹)<input type="number" min="0.01" max="100000" step="0.01" value={variant.price} onChange={event => setMenuDraft(current => ({ ...current, variants: current.variants.map((item, itemIndex) => itemIndex === index ? { ...item, price: event.target.value } : item) }))} placeholder="0.00" required/></label>
                    <button className="owner-menu-delete" type="button" aria-label={`Remove size ${variant.name || index + 1}`} onClick={() => setMenuDraft(current => ({ ...current, variants: current.variants.filter((_, itemIndex) => itemIndex !== index) }))}>×</button>
                  </div>)}
                </div>
                : <div className="owner-menu-price-field">
                  <label>Price (₹)<input type="number" min="0.01" max="100000" step="0.01" value={menuDraft.price} onChange={event => setMenuDraft(current => ({ ...current, price: event.target.value }))} placeholder="0.00" required/></label>
                  <button className="btn ghost sm" type="button" onClick={() => setMenuDraft(current => ({ ...current, variants: [{ name: 'Regular', price: current.price }] }))}>Add sizes / variants</button>
                </div>}
              {menuDraft.imageData && <img className="owner-menu-image-preview" src={menuDraft.imageData} alt="Selected dish preview"/>}
            </div>
            <button className="btn sm" type="submit" disabled={processingMenuImage}>+ Add dish</button>
          </form>
          <section className="card owner-menu-list">
            <div className="row"><div><h3>Menu items</h3><p className="small muted">Turn dishes off when they’re unavailable.</p></div><span className="menu-count">{menuItems.length}</span></div>
            {menuItems.map(item => <article className="owner-menu-item" key={item.id}>
              {item.imageData && <img className="owner-menu-thumbnail" src={item.imageData} alt=""/>}
              <div className="owner-menu-item-copy"><div className="row"><b>{item.name}</b><b className="owner-menu-price">{item.variants.length ? `From ${formatPrice(item.pricePaise)}` : formatPrice(item.pricePaise)}</b></div>
                <p className="small muted">{item.category}{item.description ? ` · ${item.description}` : ''}</p>
                <p className="small muted">{[item.dietaryType, item.spiceLevel && `${item.spiceLevel} spice`, item.allergens && `Allergens: ${item.allergens}`].filter(Boolean).join(' · ')}</p>
                {item.variants.length > 0 && <p className="small muted">{item.variants.map(variant => `${variant.name}: ${formatPrice(variant.pricePaise)}`).join(' · ')}</p>}
                <span className={`menu-availability${item.available ? ' available' : ''}`}>{item.available ? 'Available to customers' : 'Hidden from customers'}</span>
              </div>
              <button className={'tog' + (item.available ? ' on' : '')} onClick={() => toggleMenuItem(item)}
                aria-label={`${item.available ? 'Hide' : 'Show'} ${item.name}`} aria-pressed={item.available}><i/></button>
              <button className="owner-menu-delete" onClick={() => deleteMenuItem(item)} aria-label={`Delete ${item.name}`}>×</button>
            </article>)}
            {!menuItems.length && <div className="owner-menu-empty"><span>🍽</span><b>Your food menu is empty</b><p>Add your first dish above to show customers what’s cooking.</p></div>}
          </section>
        </>}
        {nav === 'QR and NFC' && <div className="card">
          <h3>Visit check-in</h3>
          <p className="small muted">Customers scan this code to request a visit. Confirm they are at your business before approving; approval awards {settings.pointsPerVisit} points.</p>
          {qr && <img className="counter-qr" src={qr} alt="Customer visit check-in QR code"/>}
          <div className="row gap"><button className="btn sm" onClick={writeNfcTag}>Write NFC tag</button>
            <button className="btn ghost sm" onClick={() => window.print()}>Print QR</button></div>
          <h3>Waiting for approval</h3>
          {checkIns.map(checkIn => <div className="row item" key={checkIn.id}>
            <div className="grow"><b>{checkIn.name}</b><div className="small muted">{checkIn.email} · {new Date(`${checkIn.requested_at.replace(' ', 'T')}Z`).toLocaleString()}</div></div>
            <button className="btn sm" onClick={() => approveVisit(checkIn.id)}>Approve visit</button>
          </div>)}
          {!checkIns.length && <p className="small muted">No visit requests are waiting.</p>}
        </div>}
        {nav === 'Settings' && <form className="card owner-settings" onSubmit={saveSettings}>
          <h3>Business settings</h3>
          <label>Business name<input value={settings.name} maxLength={120} required onChange={event => setSettings(current => ({ ...current, name: event.target.value }))}/></label>
          <label>Points per approved visit<input type="number" min="1" max="10000" value={settings.pointsPerVisit} required
            onChange={event => setSettings(current => ({ ...current, pointsPerVisit: event.target.value }))}/></label>
          <label>External menu link <span className="muted">(optional)</span><input type="url" placeholder="https://example.com/menu" value={settings.menuUrl}
            onChange={event => setSettings(current => ({ ...current, menuUrl: event.target.value }))}/></label>
          <div className="row"><h3>Delivery location</h3><button type="button" className="btn ghost sm" onClick={captureRestaurantLocation}>Use current location</button></div>
          <p className="small muted">Delivery is enabled after both coordinates are set. Free within 5 km, then ₹20 + ₹10 per extra kilometer.</p>
          <div className="row gap">
            <label className="grow">Latitude<input type="number" step="any" min="-90" max="90" value={settings.latitude ?? ''}
              onChange={event => setSettings(current => ({ ...current, latitude: event.target.value }))}/></label>
            <label className="grow">Longitude<input type="number" step="any" min="-180" max="180" value={settings.longitude ?? ''}
              onChange={event => setSettings(current => ({ ...current, longitude: event.target.value }))}/></label>
          </div>
          <button type="button" className="link" onClick={() => setSettings(current => ({ ...current, latitude: '', longitude: '' }))}>Disable delivery</button>
          <button className="btn sm" type="submit">Save settings</button>
        </form>}
      </main>
      <footer className="owner-footer">
        <div><b>Repeato</b><span>Helping {businessName} bring customers back.</span></div>
        <nav aria-label="Dashboard footer navigation">
          {['Overview', 'Orders', 'Delivery', 'Customers', 'Rewards', 'Food Menu', 'Settings'].map(item =>
            <button key={item} type="button" onClick={() => { setNav(item); window.scrollTo(0, 0); }}>{item}</button>)}
        </nav>
        <span className="owner-footer-copy">© {new Date().getFullYear()} Repeato</span>
      </footer>
      </div>
    </div>);
}
function formatPrice(pricePaise) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(pricePaise / 100);
}
function formatOrderTime(createdAt) {
    return new Date(`${createdAt.replace(' ', 'T')}Z`).toLocaleString();
}
function Stat({ l, v, s, g, y }) {
    return <div className="card"><span className="muted small">{l}</span><div className={'pts' + (y ? ' y' : '')}>{v}</div><span className={'small ' + (g ? 'green' : 'muted')}>{s}</span></div>;
}
