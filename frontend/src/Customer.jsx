import { useEffect, useRef, useState } from 'react';
import Logo from './Logo';
import { BUSINESS, REWARDS } from './data';
import { api } from './api';
export default function Customer({ theme, setTheme, onBack }) {
    const [screen, setScreen] = useState('auth');
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [authMode, setAuthMode] = useState('signin');
    const [showPassword, setShowPassword] = useState(false);
    const [businesses, setBusinesses] = useState([]);
    const [selectedBusinessId, setSelectedBusinessId] = useState(() => new URLSearchParams(window.location.search).get('business') || '');
    const [restaurantSearch, setRestaurantSearch] = useState('');
    const [restaurantResults, setRestaurantResults] = useState([]);
    const [searchingRestaurants, setSearchingRestaurants] = useState(false);
    const [restaurantSearchError, setRestaurantSearchError] = useState('');
    const [orderingBusiness, setOrderingBusiness] = useState(null);
    const [loadingRestaurantMenu, setLoadingRestaurantMenu] = useState(false);
    const [restaurantMenuError, setRestaurantMenuError] = useState('');
    const [menuSearch, setMenuSearch] = useState('');
    const [menuCategory, setMenuCategory] = useState('');
    const menuRequestRef = useRef(0);
    const [orderBusinessId, setOrderBusinessId] = useState(null);
    const [fulfillment, setFulfillment] = useState('pickup');
    const [deliveryAddress, setDeliveryAddress] = useState('');
    const [deliveryLocation, setDeliveryLocation] = useState(null);
    const [gettingLocation, setGettingLocation] = useState(false);
    const [points, setPoints] = useState(0);
    const [visits, setVisits] = useState(0);
    const [claimed, setClaimed] = useState(0);
    const [referrals, setReferrals] = useState(0);
    const [referralCode, setReferralCode] = useState('');
    const [referredById, setReferredById] = useState(null);
    const [business, setBusiness] = useState({ id: null, menuUrl: '', pointsPerVisit: 10 });
    const [pendingCheckIn, setPendingCheckIn] = useState(null);
    const [scannerOpen, setScannerOpen] = useState(false);
    const [scannerMessage, setScannerMessage] = useState('');
    const [cameraStream, setCameraStream] = useState(null);
    const videoRef = useRef(null);
    const nfcAbortRef = useRef(null);
    const [birthday, setBirthday] = useState('');
    const [notificationsEnabled, setNotificationsEnabled] = useState(true);
    const [tx, setTx] = useState([]);
    const [rewards, setRewards] = useState(REWARDS);
    const [menuItems, setMenuItems] = useState([]);
    const [accountMenuItems, setAccountMenuItems] = useState([]);
    const [orders, setOrders] = useState([]);
    const [cart, setCart] = useState([]);
    const [selectedVariants, setSelectedVariants] = useState({});
    const [paymentMethod, setPaymentMethod] = useState('cash_on_pickup');
    const [paymentConfig, setPaymentConfig] = useState({ razorpayEnabled: false, razorpayKeyId: '' });
    const [placingOrder, setPlacingOrder] = useState(false);
    const [businessName, setBusinessName] = useState(BUSINESS);
    const [toast, setToast] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    useEffect(() => {
        let active = true;
        api('/api/businesses').then(result => {
            if (!active) return;
            setBusinesses(result.businesses);
        }).catch(requestError => {
            if (active) setError(requestError.message);
        });
        return () => { active = false; };
    }, []);
    useEffect(() => {
        const search = restaurantSearch.trim();
        if (screen !== 'home' || !search) {
            setRestaurantResults([]);
            setRestaurantSearchError('');
            setSearchingRestaurants(false);
            return undefined;
        }
        let active = true;
        const timer = setTimeout(() => {
            setSearchingRestaurants(true);
            setRestaurantSearchError('');
            api(`/api/businesses?search=${encodeURIComponent(search)}`).then(result => {
                if (active) setRestaurantResults(result.businesses);
            }).catch(requestError => {
                if (active) setRestaurantSearchError(requestError.message);
            }).finally(() => {
                if (active) setSearchingRestaurants(false);
            });
        }, 250);
        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [restaurantSearch, screen]);
    const updateDashboard = (dashboard) => {
        setName(dashboard.user.name);
        setEmail(dashboard.user.email);
        setBirthday(dashboard.user.birthday || '');
        setNotificationsEnabled(dashboard.user.notificationsEnabled);
        setBusinessName(dashboard.user.businessName);
        setBusiness(dashboard.business);
        setOrderingBusiness(dashboard.business);
        setOrderBusinessId(dashboard.business.id);
        setPaymentConfig(dashboard.payment ?? { razorpayEnabled: false, razorpayKeyId: '' });
        setPoints(dashboard.points);
        setVisits(dashboard.visits);
        setClaimed(dashboard.claimed);
        setReferrals(dashboard.referrals ?? 0);
        setReferralCode(dashboard.user.referralCode || '');
        setReferredById(dashboard.user.referredById);
        setPendingCheckIn(dashboard.pendingCheckIn);
        setRewards(dashboard.rewards);
        setMenuItems(dashboard.menuItems ?? []);
        setAccountMenuItems(dashboard.menuItems ?? []);
        setOrders(dashboard.orders ?? []);
        setTx(dashboard.transactions);
    };
    const requestVisitFromCode = async (value, expectedBusinessId = business.id) => {
        let scannedBusinessId;
        const reportScanError = (message) => scannerOpen ? setScannerMessage(message) : setError(message);
        try {
            const scannedUrl = new URL(value, window.location.origin);
            if (scannedUrl.origin !== window.location.origin) {
                throw new Error('This QR or NFC tag is not a Repeato visit code.');
            }
            scannedBusinessId = Number(scannedUrl.searchParams.get('business'));
        } catch (scanError) {
            reportScanError(scanError.message || 'This is not a valid Repeato visit code.');
            return;
        }
        if (!Number.isSafeInteger(scannedBusinessId) || scannedBusinessId !== expectedBusinessId) {
            reportScanError('This QR or NFC tag is not for your rewards business.');
            return;
        }
        setScannerOpen(false);
        setScannerMessage('');
        if (pendingCheckIn) {
            setToast('Your visit is already waiting for owner approval.');
            return;
        }
        try {
            const result = await api('/api/customer/check-ins', {
                method: 'POST',
                body: JSON.stringify({ businessId: expectedBusinessId })
            });
            setPendingCheckIn(result.checkInId);
            setToast('Visit request sent. The owner will confirm it.');
        } catch (requestError) {
            if (requestError.status === 409) {
                await refreshDashboard();
                setToast(requestError.message);
            } else {
                setError(requestError.message);
            }
        }
    };
    const startQrScanner = async () => {
        setError('');
        setScannerMessage('');
        if (!('BarcodeDetector' in window)) {
            setError('QR camera scanning is not supported in this browser. Use your camera app to open the business QR, or try Tap NFC.');
            return;
        }
        if (!navigator.mediaDevices?.getUserMedia) {
            setError('Camera access is not available. Use your camera app to open the business QR, or try Tap NFC.');
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: 'environment' } },
                audio: false
            });
            setCameraStream(stream);
            setScannerOpen(true);
            setScannerMessage('Point your camera at the business QR code.');
        } catch (cameraError) {
            setError(cameraError.name === 'NotAllowedError'
                ? 'Allow camera access to scan the business QR code.'
                : `Could not start the camera: ${cameraError.message}`);
        }
    };
    const startNfcScan = async () => {
        const NfcReader = window.NDEFReader;
        if (!NfcReader) {
            setError('NFC scanning is not supported by this browser or device. Scan the counter QR code instead.');
            return;
        }
        setError('');
        setScannerMessage('Hold your phone near the business NFC tag.');
        try {
            const controller = new AbortController();
            const reader = new NfcReader();
            nfcAbortRef.current?.abort();
            nfcAbortRef.current = controller;
            reader.addEventListener('reading', event => {
                const urlRecord = event.message.records.find(record => record.recordType === 'url');
                const scannedUrl = urlRecord ? decodeNdefUrl(urlRecord) : null;
                if (!scannedUrl) {
                    setScannerMessage('This NFC tag does not contain a Repeato visit link.');
                    return;
                }
                controller.abort();
                setScannerOpen(false);
                void requestVisitFromCode(scannedUrl);
            }, { signal: controller.signal });
            reader.addEventListener('readingerror', () => {
                setScannerMessage('Could not read the NFC tag. Try again or scan the QR code.');
            }, { signal: controller.signal });
            await reader.scan({ signal: controller.signal });
            setScannerOpen(true);
        } catch (nfcError) {
            if (nfcError.name !== 'AbortError') {
                setError(nfcError.name === 'NotAllowedError'
                    ? 'Allow NFC access to read the business tag.'
                    : `Could not start NFC scanning: ${nfcError.message}`);
            }
        }
    };
    const closeScanner = () => {
        nfcAbortRef.current?.abort();
        nfcAbortRef.current = null;
        setScannerOpen(false);
        setCameraStream(null);
    };
    const toggleNotifications = async () => {
        if (!notificationsEnabled && 'Notification' in window && Notification.permission === 'default') {
            try {
                await Notification.requestPermission();
            } catch {
                setError('Could not enable browser notifications.');
                return;
            }
        }
        setNotificationsEnabled(enabled => !enabled);
    };
    const checkInFromQr = async (dashboard) => {
        const query = new URLSearchParams(window.location.search);
        const scannedBusinessId = query.get('business');
        if (!scannedBusinessId) return;
        const isReferralLink = query.has('ref');
        query.delete('business');
        query.delete('ref');
        const remainingQuery = query.toString();
        window.history.replaceState({}, '', `${window.location.pathname}${remainingQuery ? `?${remainingQuery}` : ''}${window.location.hash}`);
        if (isReferralLink) return;
        await requestVisitFromCode(
            `${window.location.origin}/?business=${encodeURIComponent(scannedBusinessId)}`,
            dashboard.business.id
        );
    };
    useEffect(() => { if (toast) {
        const t = setTimeout(() => setToast(''), 2500);
        return () => clearTimeout(t);
    } }, [toast]);
    useEffect(() => {
        let active = true;
        api('/api/customer/dashboard').then(dashboard => {
            if (!active) return;
            updateDashboard(dashboard);
            setScreen('home');
            checkInFromQr(dashboard);
        }).catch(requestError => {
            if (active && requestError.status !== 401) setError(requestError.message);
        });
        return () => { active = false; };
    }, []);
    useEffect(() => {
        if (screen !== 'orders') return undefined;
        const loadOrders = async () => {
            try {
                const result = await api('/api/customer/orders');
                setOrders(result.orders);
            } catch (requestError) {
                setError(requestError.message);
            }
        };
        loadOrders();
        const timer = setInterval(loadOrders, 8000);
        return () => clearInterval(timer);
    }, [screen]);
    useEffect(() => {
        if (!pendingCheckIn) return undefined;
        const timer = setInterval(async () => {
            try {
                const dashboard = await api('/api/customer/dashboard');
                if (!dashboard.pendingCheckIn) {
                    setToast('Your visit was approved. Points added!');
                    if (notificationsEnabled && 'Notification' in window && Notification.permission === 'granted') {
                        new Notification('Visit approved', { body: `You earned points at ${dashboard.user.businessName}.` });
                    }
                }
                updateDashboard(dashboard);
            } catch (requestError) {
                setError(requestError.message);
            }
        }, 5000);
        return () => clearInterval(timer);
    }, [pendingCheckIn, notificationsEnabled]);
    useEffect(() => {
        if (!scannerOpen || !cameraStream || !videoRef.current) return undefined;
        let stopped = false;
        let animationFrame;
        const video = videoRef.current;
        let detector;
        try {
            detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        } catch (scanError) {
            setScannerMessage(`Could not initialize QR scanning: ${scanError.message}`);
            setScannerOpen(false);
            return undefined;
        }
        video.srcObject = cameraStream;
        const detect = async () => {
            if (stopped) return;
            if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                try {
                    const codes = await detector.detect(video);
                    if (codes[0]?.rawValue) {
                        await requestVisitFromCode(codes[0].rawValue);
                        return;
                    }
                } catch (scanError) {
                    setScannerMessage(`QR scan failed: ${scanError.message}`);
                    setScannerOpen(false);
                    return;
                }
            }
            if (!stopped) animationFrame = requestAnimationFrame(detect);
        };
        video.play().then(detect).catch(cameraError => {
            if (!stopped) setScannerMessage(`Could not start camera preview: ${cameraError.message}`);
        });
        return () => {
            stopped = true;
            cancelAnimationFrame(animationFrame);
            video.pause();
            video.srcObject = null;
            cameraStream.getTracks().forEach(track => track.stop());
        };
    }, [scannerOpen, cameraStream]);
    const join = async (event) => {
        event.preventDefault();
        setError('');
        setLoading(true);
        try {
            const search = new URLSearchParams(window.location.search);
            const linkedBusinessValue = search.get('business');
            const scannedBusinessId = linkedBusinessValue ? Number(linkedBusinessValue) : null;
            const referralCode = search.get('ref');
            const businessId = authMode === 'signup'
                ? (Number.isSafeInteger(scannedBusinessId) && scannedBusinessId > 0
                    ? scannedBusinessId
                    : Number(selectedBusinessId))
                : null;
            if (authMode === 'signup' && (!Number.isSafeInteger(businessId) || businessId <= 0)) {
                throw new Error('Select a restaurant to create your customer account.');
            }
            await api(authMode === 'signup' ? '/api/auth/register' : '/api/auth/login', {
                method: 'POST',
                body: JSON.stringify(authMode === 'signup'
                    ? {
                        name,
                        email,
                        password,
                        businessId,
                        ...(referralCode ? { referralCode } : {})
                    }
                    : { email, password, role: 'customer' })
            });
            const dashboard = await api('/api/customer/dashboard');
            updateDashboard(dashboard);
            setScreen('success');
            await checkInFromQr(dashboard);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading(false);
        }
    };
    const refreshDashboard = async () => {
        const dashboard = await api('/api/customer/dashboard');
        updateDashboard(dashboard);
    };
    const saveProfile = async () => {
        setError('');
        try {
            const result = await api('/api/customer/profile', {
                method: 'PATCH',
                body: JSON.stringify({ name, birthday: birthday || null, notificationsEnabled })
            });
            setName(result.user.name);
            setBirthday(result.user.birthday || '');
            setToast('Profile saved.');
        } catch (requestError) {
            setError(requestError.message);
        }
    };
    const shareInvite = async () => {
        if (!business.id || !referralCode) {
            setError('Your invite link is still loading. Please try again.');
            return;
        }
        const inviteUrl = `${window.location.origin}/?business=${business.id}&ref=${encodeURIComponent(referralCode)}`;
        try {
            if (navigator.share) await navigator.share({ title: 'Join Repeato rewards', url: inviteUrl });
            else {
                await navigator.clipboard.writeText(inviteUrl);
                setToast('Invite link copied.');
            }
        } catch (shareError) {
            if (shareError.name !== 'AbortError') setError('Could not share the invite link.');
        }
    };
    const deleteAccount = async () => {
        if (!window.confirm('Delete your account and its rewards history? This cannot be undone.')) return;
        const passwordToConfirm = prompt('Enter your password to confirm account deletion.');
        if (passwordToConfirm === null) return;
        setError('');
        try {
            await api('/api/customer/account', {
                method: 'DELETE',
                body: JSON.stringify({ password: passwordToConfirm })
            });
            setEmail('');
            setPassword('');
            setConfirmPassword('');
            setName('');
            setPoints(0);
            setPendingCheckIn(null);
            setTx([]);
            setScreen('welcome');
        } catch (requestError) {
            setError(requestError.message);
        }
    };
    const redeem = async (reward) => {
        setError('');
        try {
            await api(`/api/customer/rewards/${reward.id}/redeem`, { method: 'POST' });
            await refreshDashboard();
            setToast(`${reward.name} redeemed`);
        } catch (requestError) {
            setError(requestError.message);
        }
    };
    const addToCart = (item) => {
        const variantName = selectedVariants[item.id] ?? item.variants[0]?.name ?? '';
        const variant = item.variants.find(option => option.name === variantName);
        const line = {
            menuItemId: item.id,
            name: item.name,
            imageData: item.imageData,
            variantName,
            unitPricePaise: variant?.pricePaise ?? item.pricePaise,
            quantity: 1
        };
        const key = `${line.menuItemId}:${line.variantName}`;
        const existing = cart.find(itemInCart => `${itemInCart.menuItemId}:${itemInCart.variantName}` === key);
        if (!existing && cart.length >= 30) {
            setError('An order can contain up to 30 different dishes.');
            return;
        }
        setCart(current => {
            const existing = current.find(itemInCart => `${itemInCart.menuItemId}:${itemInCart.variantName}` === key);
            return existing
                ? current.map(itemInCart => `${itemInCart.menuItemId}:${itemInCart.variantName}` === key
                    ? { ...itemInCart, quantity: Math.min(20, itemInCart.quantity + 1) }
                    : itemInCart)
                : [...current, line];
        });
        setToast(`${item.name} added to cart`);
    };
    const openRestaurant = async (restaurant) => {
        if (cart.length && orderBusinessId !== restaurant.id) {
            if (!window.confirm('Starting an order from another restaurant will clear your current cart. Continue?')) return;
            setCart([]);
        }
        if (orderBusinessId !== restaurant.id) {
            setFulfillment('pickup');
            setPaymentMethod('cash_on_pickup');
        }
        setOrderingBusiness({ ...restaurant, deliveryEnabled: Boolean(restaurant.deliveryEnabled) });
        setOrderBusinessId(restaurant.id);
        setMenuItems([]);
        setMenuSearch('');
        setMenuCategory('');
        setRestaurantMenuError('');
        const requestId = ++menuRequestRef.current;
        setLoadingRestaurantMenu(true);
        setScreen('menu');
        setError('');
        try {
            const result = await api(`/api/businesses/${restaurant.id}/menu`);
            if (requestId !== menuRequestRef.current) return;
            setOrderingBusiness(result.business);
            setMenuItems(result.menuItems);
        } catch (requestError) {
            if (requestId === menuRequestRef.current) setRestaurantMenuError(requestError.message);
        } finally {
            if (requestId === menuRequestRef.current) setLoadingRestaurantMenu(false);
        }
    };
    const leaveRestaurantMenu = () => {
        menuRequestRef.current += 1;
        setLoadingRestaurantMenu(false);
        setScreen('home');
    };
    const openAccountMenu = () => {
        if (cart.length && orderBusinessId !== business.id) {
            if (!window.confirm('Starting an order from another restaurant will clear your current cart. Continue?')) return;
            setCart([]);
        }
        if (orderBusinessId !== business.id) {
            setFulfillment('pickup');
            setPaymentMethod('cash_on_pickup');
        }
        setOrderingBusiness({ ...business, name: businessName });
        setOrderBusinessId(business.id);
        setMenuItems(accountMenuItems);
        setMenuSearch('');
        setMenuCategory('');
        setRestaurantMenuError('');
        menuRequestRef.current += 1;
        setLoadingRestaurantMenu(false);
        setScreen('menu');
    };
    const captureDeliveryLocation = () => {
        if (!navigator.geolocation) {
            setError('Location is not supported by this browser. Allow location access or use a device with GPS.');
            return;
        }
        setGettingLocation(true);
        setError('');
        navigator.geolocation.getCurrentPosition(
            position => {
                setDeliveryLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
                setGettingLocation(false);
            },
            locationError => {
                setGettingLocation(false);
                setError(locationError.code === locationError.PERMISSION_DENIED
                    ? 'Allow location access to calculate your delivery fee.'
                    : 'Could not get your location. Please try again.');
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
    };
    const updateCartQuantity = (line, change) => {
        const key = `${line.menuItemId}:${line.variantName}`;
        setCart(current => current.flatMap(item => {
            if (`${item.menuItemId}:${item.variantName}` !== key) return [item];
            const quantity = item.quantity + change;
            return quantity > 0 ? [{ ...item, quantity }] : [];
        }));
    };
    const payForOrder = async (order) => {
        try {
            const intent = await api(`/api/customer/orders/${order.id}/payment-intent`, { method: 'POST' });
            await loadRazorpayCheckout();
            await new Promise((resolve, reject) => {
                const checkout = new window.Razorpay({
                    key: intent.keyId,
                    amount: intent.amount,
                    currency: intent.currency,
                    name: intent.name,
                    description: intent.description,
                    order_id: intent.razorpayOrderId,
                    prefill: intent.customer,
                    theme: { color: '#FF6B2C' },
                    handler: async response => {
                        try {
                            const verified = await api(`/api/customer/orders/${order.id}/verify-payment`, {
                                method: 'POST',
                                body: JSON.stringify(response)
                            });
                            setOrders(current => current.map(item => item.id === order.id ? verified.order : item));
                            setToast('Payment successful. Your order is with the restaurant.');
                            resolve();
                        } catch (requestError) {
                            reject(requestError);
                        }
                    },
                    modal: { ondismiss: () => reject(new Error('Payment cancelled. Your order is saved; retry from Orders.')) }
                });
                checkout.on('payment.failed', response => {
                    reject(new Error(response.error?.description || 'Payment failed. Your order is saved; you can retry it from Orders.'));
                });
                checkout.open();
            });
        } catch (requestError) {
            setError(requestError.message);
        }
    };
    const placeOrder = async () => {
        if (!cart.length || placingOrder) return;
        setError('');
        setPlacingOrder(true);
        try {
            const result = await api('/api/customer/orders', {
                method: 'POST',
                body: JSON.stringify({
                    paymentMethod,
                    businessId: orderBusinessId,
                    fulfillment,
                    ...(fulfillment === 'delivery' ? {
                        deliveryAddress,
                        deliveryLatitude: deliveryLocation?.latitude,
                        deliveryLongitude: deliveryLocation?.longitude
                    } : {}),
                    items: cart.map(item => ({
                        menuItemId: item.menuItemId,
                        variantName: item.variantName,
                        quantity: item.quantity
                    }))
                })
            });
            setOrders(current => [result.order, ...current.filter(order => order.id !== result.order.id)].slice(0, 50));
            setCart([]);
            setScreen('orders');
            if (paymentMethod === 'razorpay') {
                await payForOrder(result.order);
            } else {
                setToast(fulfillment === 'delivery'
                    ? 'Order sent to restaurant. Pay cash when it arrives.'
                    : 'Order sent to restaurant. Pay cash when you pick it up.');
            }
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setPlacingOrder(false);
        }
    };
    const next = rewards[0]?.pts ?? REWARDS[0].pts;
    const pct = Math.min(100, (points / next) * 100);
    const cartTotalPaise = cart.reduce((total, item) => total + item.unitPricePaise * item.quantity, 0);
    const deliveryFeePaise = fulfillment === 'delivery'
        ? estimateDeliveryFee(orderingBusiness, deliveryLocation)
        : 0;
    const checkoutTotalPaise = cartTotalPaise + deliveryFeePaise;
    const filteredMenuItems = menuItems.filter(item => {
        const matchesSearch = `${item.name} ${item.description} ${item.category}`
            .toLocaleLowerCase().includes(menuSearch.trim().toLocaleLowerCase());
        return matchesSearch && (!menuCategory || item.category === menuCategory);
    });
    const menuGroups = groupMenuItems(filteredMenuItems);
    const menuCategories = [...new Set(menuItems.map(item => item.category))];
    return (<div className={`phone${['welcome', 'auth'].includes(screen) ? ' auth-page' : ''}${['home', 'rewards', 'activity', 'orders'].includes(screen) ? ' customer-shell' : ''}${screen === 'menu' ? ' customer-menu-shell' : ''}`}>
      {screen === 'welcome' && (<div className="auth-layout">
          <section className="auth-story">
            <div className="row auth-brand"><div className="logo-tile xs"><Logo size={30}/></div><b>Repeato</b></div>
            <div className="auth-copy">
              <span className="eyebrow">A little more love for local</span>
              <h1>Good visits.<br/><span>Great rewards.</span></h1>
              <p>Discover neighbourhood favourites, collect points with every visit, and make your next treat feel even sweeter.</p>
            </div>
            <div className="auth-benefits">
              <div><span>01</span><p><b>Visit your favourites</b><small>Support the local spots you love.</small></p></div>
              <div><span>02</span><p><b>Collect points</b><small>Every visit brings you closer to a treat.</small></p></div>
              <div><span>03</span><p><b>Enjoy the little wins</b><small>Redeem rewards made for you.</small></p></div>
            </div>
            <div className="auth-note"><span>✦</span> Your neighbourhood, a little more rewarding.</div>
          </section>
          <section className="auth-card">
            <button className="auth-back" onClick={onBack}>← <span>Main menu</span></button>
            <div className="auth-mobile-brand"><Logo size={38}/><b>Repeato</b></div>
            <span className="eyebrow">YOUR LOCAL REWARDS CLUB</span>
            <h2>Create your account</h2>
            <p className="muted">Join free and start earning points on the things you already love.</p>
            <button className="btn auth-primary" onClick={() => { setAuthMode('signup'); setScreen('auth'); }}>Create a free account <span>→</span></button>
            <button className="btn ghost auth-secondary" onClick={() => { setAuthMode('signin'); setScreen('auth'); }}>I already have an account</button>
            <div className="auth-trust"><span>✓</span> Free to join <i/> No app download <i/> Made for local</div>
            <p className="auth-demo-note">Your account and rewards are saved securely.</p>
          </section>
        </div>)}

      {screen === 'auth' && (<div className="auth-layout auth-layout-form">
          <section className="auth-story auth-story-compact">
            <div className="row auth-brand"><div className="logo-tile xs"><Logo size={30}/></div><b>Repeato</b></div>
            <div className="auth-copy">
              <span className="eyebrow">A LITTLE SOMETHING EXTRA</span>
              <h1>Your next<br/><span>treat awaits.</span></h1>
              <p>One account for all your favourite neighbourhood rewards.</p>
            </div>
            <div className="auth-note"><span>✦</span> Visit. Earn. Return.</div>
          </section>
          <section className="auth-card auth-card-form">
            <button className="auth-back" onClick={() => setScreen('welcome')}>← <span>Back</span></button>
            <span className="eyebrow">{authMode === 'signup' ? 'GET STARTED' : 'WELCOME BACK'}</span>
            <h2>{authMode === 'signup' ? 'Create your account' : 'Sign in to Repeato'}</h2>
            <p className="muted">{authMode === 'signup' ? 'A few details and you’re ready to earn.' : 'Pick up right where you left off.'}</p>
            <form className="auth-form" onSubmit={join}>
              {authMode === 'signup' && <label className="auth-input-wrap">
                <span>Your name</span>
                <input autoComplete="name" placeholder="e.g. Alex Morgan" value={name} onChange={e => setName(e.target.value)} required/>
              </label>}
              {authMode === 'signup' && (() => {
                  const linkedId = Number(new URLSearchParams(window.location.search).get('business'));
                  const linkedBusiness = businesses.find(item => item.id === linkedId);
                  return linkedBusiness
                      ? <p className="business-link-note">Joining {linkedBusiness.name} from its restaurant link.</p>
                      : <label className="auth-input-wrap">
                        <span>Choose a restaurant</span>
                        <select value={selectedBusinessId} onChange={event => setSelectedBusinessId(event.target.value)} required>
                          <option value="">Select a restaurant</option>
                          {businesses.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                        <small className="muted">{businesses.length
                            ? 'You can create your account with your email and password—no QR code needed.'
                            : 'No restaurants are available yet. Ask your restaurant to join Repeato first.'}</small>
                      </label>;
              })()}
              <label className="auth-input-wrap">
                <span>Email address</span>
                <input type="email" autoComplete="email" inputMode="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required/>
              </label>
              <label className="auth-input-wrap">
                <span>Password</span>
                <div className="auth-password">
                  <input type={showPassword ? 'text' : 'password'} autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} placeholder="At least 8 characters" value={password} onChange={e => setPassword(e.target.value)} minLength={8} required/>
                  <button type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button>
                </div>
              </label>
              {authMode === 'signup' && <label className="auth-input-wrap">
                <span>Confirm password</span>
                <input type="password" autoComplete="new-password" placeholder="Re-enter your password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} minLength={8} required/>
              </label>}
              {authMode === 'signup' && password && confirmPassword && password !== confirmPassword && <p className="auth-error" role="alert">Passwords don’t match yet.</p>}
              {error && <p className="auth-error" role="alert">{error}</p>}
              <button className="btn auth-primary" type="submit" disabled={loading || (authMode === 'signup' && password !== confirmPassword)}>
                {loading ? 'Please wait…' : authMode === 'signup' ? 'Create account' : 'Sign in'} <span>→</span>
              </button>
            </form>
            <p className="auth-mode-toggle">{authMode === 'signup' ? 'Already a member?' : 'New to Repeato?'} <button onClick={() => { setAuthMode(authMode === 'signup' ? 'signin' : 'signup'); setConfirmPassword(''); }}> {authMode === 'signup' ? 'Sign in' : 'Create an account'}</button></p>
            <p className="auth-demo-note">Your account and rewards are saved securely.</p>
          </section>
        </div>)}

      {screen === 'success' && (<div className="col full">
          <h3 className="c">{businessName}</h3>
          <div className="center grow">
            <div className="star">★</div>
            <h2 className="big c">You're in!</h2>
            <p className="muted c">{authMode === 'signup'
                ? `Welcome to ${businessName} rewards. We’ve added ${referredById ? '30 points' : '10 points'} to get you started.`
                : `Welcome back to ${businessName} rewards.`}</p>
            <div className="card w100">
              <div className="row"><span className="muted">Your points</span><b className="pts">{points} <small>/ {next}</small></b></div>
              <Bar pct={pct}/>
              <p>{Math.max(0, next - points)} more points to your first reward: <b>{rewards[0]?.name ?? REWARDS[0].name}</b></p>
            </div>
          </div>
          <button className="btn" onClick={() => setScreen('home')}>See my rewards</button>
          <button className="link" onClick={() => setToast('Use your browser menu → Add to Home Screen')}>Add to home screen</button>
          <p className="muted c small">Powered by Repeato</p>
        </div>)}

      {['home', 'rewards', 'activity', 'orders'].includes(screen) && (<div className="col full nopad">
          <div className="scroll">
            <div className="row head customer-header">
              <div><span className="eyebrow">{screen === 'home' ? 'YOUR LOCAL REWARDS CLUB' : screen === 'orders' ? 'ORDER UPDATES' : screen === 'rewards' ? 'LITTLE TREATS, EARNED' : 'YOUR VISIT HISTORY'}</span>
                <h2 className="big sm">{screen === 'home' ? `Hey, ${name.trim().split(/\s+/)[0] || 'there'}!` : screen === 'orders' ? 'Your orders' : screen === 'rewards' ? 'Your rewards' : 'Recent activity'}</h2>
                <p className="small muted">{businessName} member</p></div>
              <button className="icon customer-profile-button" onClick={() => setScreen('profile')} aria-label="Open your profile">👤</button>
            </div>
            {screen === 'home' && (<>
              <div className="customer-home-grid">
                <section className="restaurant-search">
                  <label htmlFor="restaurant-search-input">Find your next favourite</label>
                  <div className="restaurant-search-box">
                    <span aria-hidden="true">⌕</span>
                    <input id="restaurant-search-input" type="search" value={restaurantSearch}
                      onChange={event => setRestaurantSearch(event.target.value)}
                      placeholder="Search restaurants on Repeato"/>
                    {restaurantSearch && <button type="button" onClick={() => setRestaurantSearch('')}
                      aria-label="Clear restaurant search">×</button>}
                  </div>
                  {restaurantSearch.trim() && <div className="restaurant-search-results" aria-live="polite">
                    {searchingRestaurants && <p className="muted small">Searching restaurants…</p>}
                    {!searchingRestaurants && restaurantSearchError && <p className="auth-error" role="alert">{restaurantSearchError}</p>}
                    {!searchingRestaurants && !restaurantSearchError && restaurantResults.length > 0 && <>
                      <p className="restaurant-results-label">Restaurants on Repeato</p>
                      {restaurantResults.map(item => <button className="restaurant-result" key={item.id}
                        onClick={() => openRestaurant(item)}>
                        <span className="restaurant-result-icon">⌂</span>
                        <span><b>{item.name}</b><small>Open menu and start an order</small></span>
                        <span className="restaurant-result-check" aria-label="Open menu">→</span>
                      </button>)}
                    </>}
                    {!searchingRestaurants && !restaurantSearchError && restaurantResults.length === 0 && <p className="muted small">No restaurants found. Only restaurants whose owners joined Repeato appear here.</p>}
                  </div>}
                </section>
                <section className="marketplace-restaurants">
                  <div className="row"><div><span className="eyebrow">GOOD FOOD, RIGHT AROUND YOU</span><h3>Order from local favourites</h3></div>
                    <span className="muted small">{businesses.filter(item => item.hasMenu).length} menus</span></div>
                  <div className="marketplace-restaurant-grid">
                    {businesses.filter(item => item.hasMenu).map(item => <button className="marketplace-restaurant-card" key={item.id}
                      onClick={() => openRestaurant(item)}>
                      <span className="marketplace-restaurant-image" aria-hidden="true">🍽</span>
                      <span><b>{item.name}</b><small>{item.deliveryEnabled ? 'Pickup · Delivery available' : 'Pickup only'}</small></span>
                      <span className="marketplace-restaurant-action">View menu <span aria-hidden="true">→</span></span>
                    </button>)}
                    {!businesses.some(item => item.hasMenu) && <p className="muted small">Restaurant menus will appear here when available.</p>}
                  </div>
                </section>
                <section className="hero customer-points-hero">
                  <div className="customer-points-label"><span>✦</span> YOUR REWARDS</div>
                  <p className="customer-points-caption">You have</p>
                  <div className="customer-points-value">{points}<small>points</small></div>
                  <div className="customer-points-progress-copy"><span>{Math.max(0, next - points)} points to your next treat</span><b>{Math.round(pct)}%</b></div>
                  <Bar pct={pct} dark/>
                  <div className="customer-next-reward"><span aria-hidden="true">{rewards[0]?.icon ?? REWARDS[0].icon}</span>
                    <div><small>NEXT REWARD</small><b>{rewards[0]?.name ?? REWARDS[0].name}</b></div>
                    <button onClick={() => setScreen('rewards')} aria-label="See all rewards">→</button>
                  </div>
                </section>
                <section className="customer-visit-card">
                  <div className="customer-visit-copy"><span className="customer-visit-icon" aria-hidden="true">▦</span>
                    <div><span className="eyebrow">AT THE COUNTER?</span><h3>Earn points on your visit</h3>
                      <p>{pendingCheckIn ? 'Your visit is waiting for the owner to confirm.' : 'Scan the restaurant QR or tap NFC to request points.'}</p></div>
                  </div>
                  <div className="customer-visit-actions">
                    <button className="btn" onClick={startQrScanner} disabled={Boolean(pendingCheckIn)}>
                      {pendingCheckIn ? 'Awaiting approval…' : 'Scan QR code'}
                    </button>
                    <button className="btn ghost" onClick={startNfcScan} disabled={Boolean(pendingCheckIn)}>Tap NFC</button>
                  </div>
                  <button className="customer-linked-menu" onClick={openAccountMenu}>🍴 Browse {businessName} menu <span>→</span></button>
                </section>
                <section className="customer-home-section customer-home-rewards">
                  <div className="customer-section-heading"><div><span className="eyebrow">A LITTLE SOMETHING EXTRA</span><h3>Rewards for you</h3></div>
                    <button className="link" onClick={() => setScreen('rewards')}>See all <span aria-hidden="true">→</span></button></div>
                  <RewardList points={points} rewards={rewards} onRedeem={redeem}/>
                </section>
                <section className="customer-home-section customer-home-activity">
                  <div className="customer-section-heading"><div><span className="eyebrow">YOUR JOURNEY</span><h3>Recent activity</h3></div>
                    <button className="link" onClick={() => setScreen('activity')}>View all <span aria-hidden="true">→</span></button></div>
                  <TxList tx={tx}/>
                </section>
              </div>
            </>)}
            {screen === 'rewards' && <section className="customer-page-section">
              <p className="muted">Every visit brings you closer to a little treat.</p>
              <RewardList points={points} rewards={rewards} onRedeem={redeem}/>
            </section>}
            {screen === 'activity' && <section className="customer-page-section"><TxList tx={tx}/></section>}
            {screen === 'orders' && <section className="customer-orders">
              <div className="row"><div><h3>Order history</h3><p className="small muted">Restaurant updates and delivery tracking</p></div>
                <button className="btn ghost sm" onClick={() => api('/api/customer/orders')
                    .then(result => setOrders(result.orders))
                    .catch(requestError => setError(requestError.message))}>Refresh</button></div>
              {orders.map(order => <OrderCard key={order.id} order={order}
                onRetry={payForOrder} busy={placingOrder}/>)}
              {!orders.length && <div className="customer-menu-empty"><span>🛍</span><b>No orders yet</b>
                <p>Choose dishes from the menu to place your first pickup order.</p>
                <button className="btn sm" onClick={() => setScreen('menu')}>Browse menu</button></div>}
            </section>}
          </div>
          <nav className="tabs customer-tabs" aria-label="Customer navigation">
            {[['home', '⌂', 'Home'], ['orders', '🛍', 'Orders'], ['rewards', '🎁', 'Rewards'], ['activity', '◷', 'Activity']].map(([k, i, l]) => (<button key={k} className={screen === k ? 'on' : ''} aria-current={screen === k ? 'page' : undefined} onClick={() => setScreen(k)}><span aria-hidden="true">{i}</span>{l}</button>))}
          </nav>
        </div>)}

      {screen === 'menu' && (<div className="col full customer-menu-page">
          <div className="row customer-menu-heading">
          <button className="icon" onClick={leaveRestaurantMenu} aria-label="Back to restaurants">‹</button>
          <div><span className="eyebrow">RESTAURANT MENU</span><h2>{orderingBusiness?.name ?? businessName}</h2></div>
            <span className="profile-heading-spacer"/>
          </div>
          <div className="customer-menu-scroll">
            {orderingBusiness && <section className="restaurant-menu-summary">
              <span className="restaurant-menu-icon" aria-hidden="true">🍽</span>
              <div><span className="eyebrow">MENU</span>
                <h3>{orderingBusiness.name}</h3>
                <p className="small muted">
                  {menuItems.length} {menuItems.length === 1 ? 'dish' : 'dishes'} · Pickup
                  {orderingBusiness.deliveryEnabled ? ' · Delivery available' : ''}
                </p>
              </div>
            </section>}
            {orderingBusiness?.menuUrl && <a className="customer-menu-online-link" href={orderingBusiness.menuUrl} target="_blank" rel="noreferrer">View full online menu <span>↗</span></a>}
            {loadingRestaurantMenu && <div className="customer-menu-loading" role="status">Loading {orderingBusiness?.name ?? 'restaurant'} menu…</div>}
            {restaurantMenuError && <div className="customer-menu-empty" role="alert">
              <span>⚠</span><h3>Could not load this menu</h3><p>{restaurantMenuError}</p>
              <button className="btn sm" onClick={() => orderingBusiness && openRestaurant(orderingBusiness)}>Try again</button>
            </div>}
            {!loadingRestaurantMenu && !restaurantMenuError && menuItems.length > 0 && <>
              <label className="restaurant-menu-search">
                <span aria-hidden="true">⌕</span>
                <input type="search" value={menuSearch} onChange={event => setMenuSearch(event.target.value)}
                  placeholder={`Search dishes at ${orderingBusiness?.name ?? businessName}`}
                  aria-label="Search dishes in this restaurant menu"/>
              </label>
              {menuCategories.length > 1 && <nav className="restaurant-menu-categories" aria-label="Menu categories">
                <button className={!menuCategory ? 'active' : ''} onClick={() => setMenuCategory('')}>All</button>
                {menuCategories.map(category => <button key={category}
                  className={menuCategory === category ? 'active' : ''}
                  onClick={() => setMenuCategory(menuCategory === category ? '' : category)}>{category}</button>)}
              </nav>}
              {menuGroups.length
                ? menuGroups.map(([category, items], index) => <section className="customer-menu-category"
                    id={`restaurant-menu-category-${index}`} key={category}>
                  <h3>{category}</h3>
                  <div className="customer-menu-cards">
                  {items.map(item => {
                    const selectedVariantName = selectedVariants[item.id] ?? item.variants[0]?.name;
                    const selectedVariant = item.variants.find(variant => variant.name === selectedVariantName);
                    return <article className="customer-menu-item" key={item.id}>
                    <div className="customer-menu-card-media">
                      {item.imageData
                        ? <img className="customer-menu-thumbnail" src={item.imageData} alt={item.name}/>
                        : <span className="customer-menu-image-placeholder" aria-hidden="true">🍽</span>}
                      {item.dietaryType && <span className={`customer-menu-dietary ${item.dietaryType === 'non-vegetarian' ? 'non-veg' : ''}`}>
                        <i/> {item.dietaryType === 'non-vegetarian' ? 'Non-veg' : item.dietaryType === 'vegan' ? 'Vegan' : 'Veg'}
                      </span>}
                    </div>
                    <div className="customer-menu-item-copy">
                      <b>{item.name}</b>
                      {item.description && <p>{item.description}</p>}
                      {item.spiceLevel && <p className="customer-menu-tags">{item.spiceLevel} spice</p>}
                      {item.allergens && <p className="customer-menu-allergens">Allergens: {item.allergens}</p>}
                      <div className="customer-menu-card-footer">
                        <div className="customer-menu-card-price">
                          <strong>{formatPrice(selectedVariant?.pricePaise ?? item.pricePaise)}</strong>
                          {item.variants.length > 0 && <select className="customer-menu-variant-select"
                            aria-label={`Choose a size for ${item.name}`}
                            value={selectedVariantName}
                            onChange={event => setSelectedVariants(current => ({ ...current, [item.id]: event.target.value }))}>
                            {item.variants.map(variant => <option key={variant.name} value={variant.name}>{variant.name} · {formatPrice(variant.pricePaise)}</option>)}
                          </select>}
                        </div>
                        <button className="btn sm customer-menu-add" onClick={() => addToCart(item)}>ADD</button>
                      </div>
                    </div>
                  </article>;
                  })}
                  </div>
                </section>)
                : <div className="customer-menu-empty"><span>⌕</span><h3>No matching dishes</h3><p>Try another dish name or menu category.</p></div>}
            </>}
            {!loadingRestaurantMenu && !restaurantMenuError && !menuItems.length
              && <div className="customer-menu-empty"><span>🍽</span><h3>Menu coming soon</h3>
                <p>{orderingBusiness?.name ?? businessName} hasn’t added any dishes yet. Check back soon.</p></div>}
            {cart.length > 0 && <section className="card customer-cart">
              <div className="row"><div><h3>Your cart</h3><p className="small muted">{fulfillment === 'delivery' ? `Delivery from ${orderingBusiness?.name ?? businessName}` : `Pickup from ${orderingBusiness?.name ?? businessName}`}</p></div>
                <button className="link" onClick={() => setCart([])}>Clear</button></div>
              {cart.map(item => <div className="customer-cart-line" key={`${item.menuItemId}:${item.variantName}`}>
                <div className="grow"><b>{item.name}{item.variantName ? ` · ${item.variantName}` : ''}</b>
                  <p className="small muted">{formatPrice(item.unitPricePaise)} each</p></div>
                <div className="customer-cart-quantity">
                  <button aria-label={`Remove one ${item.name}`} onClick={() => updateCartQuantity(item, -1)}>−</button>
                  <b>{item.quantity}</b>
                  <button aria-label={`Add one ${item.name}`} disabled={item.quantity >= 20} onClick={() => updateCartQuantity(item, 1)}>+</button>
                </div>
                <strong>{formatPrice(item.unitPricePaise * item.quantity)}</strong>
              </div>)}
              <fieldset className="customer-payment-method">
                <legend>How would you like your order?</legend>
                <label><input type="radio" name="fulfillment" checked={fulfillment === 'pickup'}
                  onChange={() => { setFulfillment('pickup'); setPaymentMethod('cash_on_pickup'); }}/> Pickup</label>
                <label className={orderingBusiness?.deliveryEnabled ? '' : 'disabled'}>
                  <input type="radio" name="fulfillment" checked={fulfillment === 'delivery'}
                    disabled={!orderingBusiness?.deliveryEnabled}
                    onChange={() => { setFulfillment('delivery'); setPaymentMethod('cash_on_delivery'); }}/> Delivery
                </label>
                {!orderingBusiness?.deliveryEnabled && <small className="muted">This restaurant has not set up delivery yet.</small>}
              </fieldset>
              {fulfillment === 'delivery' && <section className="delivery-address-form">
                <label htmlFor="delivery-address">Delivery address</label>
                <textarea id="delivery-address" maxLength={500} required value={deliveryAddress}
                  onChange={event => setDeliveryAddress(event.target.value)} placeholder="Flat, building, street, area and landmark"/>
                <button className="btn ghost sm" type="button" disabled={gettingLocation} onClick={captureDeliveryLocation}>
                  {gettingLocation ? 'Getting location…' : deliveryLocation ? 'Location captured ✓' : 'Use my current location'}
                </button>
                <p className="small muted">
                  {deliveryLocation
                    ? `Distance-based fee: ${deliveryFeePaise ? formatPrice(deliveryFeePaise) : 'Free'} (straight-line estimate).`
                    : 'Allow location access to estimate your delivery fee. Free within 5 km; beyond that ₹20 base + ₹10 per extra km.'}
                </p>
              </section>}
              <div className="row customer-cart-total"><b>Food total</b><b>{formatPrice(cartTotalPaise)}</b></div>
              {fulfillment === 'delivery' && <div className="row customer-cart-total"><span>Delivery fee</span>
                <b>{deliveryLocation ? formatPrice(deliveryFeePaise) : 'Calculated with location'}</b></div>}
              <div className="row customer-cart-total"><b>Order total</b><b>{formatPrice(checkoutTotalPaise)}</b></div>
              <fieldset className="customer-payment-method">
                <legend>Payment method</legend>
                <label><input type="radio" name="payment-method" value={fulfillment === 'delivery' ? 'cash_on_delivery' : 'cash_on_pickup'}
                  checked={paymentMethod !== 'razorpay'} onChange={() => setPaymentMethod(fulfillment === 'delivery' ? 'cash_on_delivery' : 'cash_on_pickup')}/>
                  {fulfillment === 'delivery' ? 'Cash on delivery' : 'Cash on pickup'}</label>
                <label className={!paymentConfig.razorpayEnabled ? 'disabled' : ''}>
                  <input type="radio" name="payment-method" value="razorpay"
                    checked={paymentMethod === 'razorpay'} disabled={!paymentConfig.razorpayEnabled}
                    onChange={() => setPaymentMethod('razorpay')}/>
                  Pay online with Razorpay
                </label>
                {!paymentConfig.razorpayEnabled && <small className="muted">Online payment is not set up yet. Cash on pickup is available.</small>}
              </fieldset>
              <p className="small muted">{paymentMethod === 'razorpay' ? 'Your order reaches the restaurant after payment is verified.' : fulfillment === 'delivery' ? 'Pay cash when your order arrives.' : 'Pay cash when you pick up your order.'}</p>
              <button className="btn" disabled={placingOrder || (fulfillment === 'delivery'
                && (!deliveryLocation || deliveryAddress.trim().length < 8))} onClick={placeOrder}>
                {placingOrder ? 'Placing order…' : `Place ${fulfillment} order · ${formatPrice(checkoutTotalPaise)}`}
              </button>
            </section>}
          </div>
          <button className="btn ghost customer-menu-back" onClick={leaveRestaurantMenu}>Back to restaurants</button>
        </div>)}

      {screen === 'profile' && (<div className="col full profile-page">
          <div className="row profile-heading">
            <button className="icon" onClick={() => setScreen('home')} aria-label="Back to rewards">‹</button>
            <div><span className="eyebrow">YOUR ACCOUNT</span><h2>Personal details</h2></div>
            <span className="profile-heading-spacer"/>
          </div>
          <section className="profile-identity">
            <div className="avatar">{(name || email || '?').trim().charAt(0).toUpperCase()}</div>
            <div className="profile-identity-copy">
              <h3>{name || email.split('@')[0]}</h3>
              <p>{email}</p>
              <span className="profile-member"><i/> {businessName} member</span>
            </div>
          </section>
          <div className="row gap stats profile-stats">
            {[[points, 'Points'], [visits, 'Visits'], [claimed, 'Rewards claimed']].map(([n, l]) => <div key={l} className="card c grow"><b>{n}</b><div className="muted small">{l}</div></div>)}
          </div>
          <section className="profile-section">
            <div className="profile-section-heading"><div><h3>Personal information</h3><p>Your details for this rewards account.</p></div><span>01</span></div>
            <div className="card profile-form">
              <label className="profile-field">
                <span>Full name</span>
                <input type="text" autoComplete="name" maxLength={100} value={name} onChange={event => setName(event.target.value)} />
              </label>
              <label className="profile-field">
                <span>Email address</span>
                <input type="email" value={email} readOnly aria-describedby="profile-email-note"/>
                <small id="profile-email-note">Email address cannot be changed here.</small>
              </label>
              <label className="profile-field">
                <span>Birthday <small>Optional</small></span>
                <input type="date" value={birthday} onChange={event => setBirthday(event.target.value)} />
              </label>
              <button className="btn profile-save" onClick={saveProfile}>Save changes <span>→</span></button>
            </div>
          </section>
          <section className="profile-section">
            <div className="profile-section-heading"><div><h3>Preferences</h3><p>Make Repeato feel right for you.</p></div><span>02</span></div>
            <div className="card profile-preferences">
              <button className="profile-setting" onClick={toggleNotifications} aria-pressed={notificationsEnabled}>
                <span className="profile-setting-icon">♧</span>
                <span className="profile-setting-copy"><b>Visit updates</b><small>Get notified when a visit is approved.</small></span>
                <span className={`profile-switch${notificationsEnabled ? ' on' : ''}`} aria-hidden="true"><i/></span>
              </button>
              <button className="profile-setting" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
                <span className="profile-setting-icon">◐</span>
                <span className="profile-setting-copy"><b>Appearance</b><small>Choose the look that suits you.</small></span>
                <span className="profile-setting-value">{theme === 'light' ? 'Light' : 'Dark'} <b>›</b></span>
              </button>
              <div className="profile-setting profile-help">
                <span className="profile-setting-icon">?</span>
                <span className="profile-setting-copy"><b>Need a hand?</b><small>Ask the team at {businessName}.</small></span>
              </div>
            </div>
          </section>
          <section className="profile-invite">
            <div className="profile-invite-icon">✦</div>
            <div className="profile-invite-copy">
              <span className="eyebrow">GOOD THINGS ARE BETTER SHARED</span>
              <h3>Bring a friend along</h3>
              <p>You both get 20 bonus points when they join. {referrals} friend{referrals === 1 ? '' : 's'} joined so far.</p>
            </div>
            <button className="btn profile-invite-button" onClick={shareInvite}>Share invite link <span>↗</span></button>
          </section>
          <section className="profile-section profile-account-section">
            <div className="profile-section-heading"><div><h3>Account</h3><p>Manage your Repeato account.</p></div><span>03</span></div>
            <div className="card profile-account-actions">
              <button className="profile-account-action" onClick={async () => {
                try {
                    await api('/api/auth/logout', { method: 'POST' });
                    setEmail(''); setPassword(''); setConfirmPassword(''); setName(''); setPoints(0);
                    setPendingCheckIn(null); setTx([]); setError(''); setScreen('welcome');
                } catch (requestError) {
                    setError(requestError.message);
                }
              }}><span>↪</span> Log out</button>
              <button className="profile-account-action danger" onClick={deleteAccount}><span>⌫</span> Delete my account</button>
            </div>
          </section>
        </div>)}
      {scannerOpen && <div className="modal customer-scanner" onClick={closeScanner}>
        <section className="card scanner-card" role="dialog" aria-modal="true" aria-labelledby="scanner-title"
          onClick={event => event.stopPropagation()}>
          <div className="row"><h3 id="scanner-title">Scan or tap to check in</h3>
            <button className="icon" type="button" onClick={closeScanner} aria-label="Close scanner">×</button></div>
          <video ref={videoRef} className="scanner-video" muted playsInline aria-label="Camera QR scanner"/>
          <p className="muted small" aria-live="polite">{scannerMessage}</p>
          <button className="btn ghost" type="button" onClick={startNfcScan}>Tap NFC tag instead</button>
          <p className="muted small">A successful scan sends a visit request; your business owner must approve it before points are added.</p>
        </section>
      </div>}
      {toast && <div className="toast">{toast}</div>}
      {error && screen !== 'auth' && <div className="toast" role="alert">{error}</div>}
    </div>);
}
function Bar({ pct, dark }) {
    return <div className={'bar' + (dark ? ' d' : '')}><i style={{ width: pct + '%' }}/></div>;
}
function RewardList({ points, rewards, onRedeem }) {
    if (!rewards.length) return <div className="customer-activity-empty"><span>✦</span><b>Rewards are on their way</b><p>Your restaurant will add rewards here soon.</p></div>;
    return <div className="customer-card-list">{rewards.map(r => (<div className="card row item customer-reward-row" key={r.id}>
      <div className="ico">{r.icon}</div>
      <div className="grow"><b>{r.name}</b><div className="muted small">{points >= r.pts ? 'Ready to claim' : `${r.pts - points} points to go`}</div></div>
      {points >= r.pts && <button className="btn sm" onClick={() => onRedeem(r)}>Claim</button>}
      <b>{r.pts} pts</b>
    </div>))}</div>;
}
function TxList({ tx }) {
    if (!tx.length) return <div className="customer-activity-empty"><span>◷</span><b>Your story starts here</b><p>Approved visits and redeemed rewards will show up here.</p></div>;
    return <div className="customer-card-list">{tx.map((t, i) => (<div className="card row item customer-activity-row" key={i}><div className="ico">{t.type === 'redeem' ? '🎁' : '✦'}</div>
      <div className="grow"><b>{t.title}</b><div className="muted small">{t.when}</div></div><b>{t.type === 'redeem' ? '-' : '+'}{t.pts} pts</b></div>))}</div>;
}
function OrderCard({ order, onRetry, busy }) {
    const deliverySteps = order.fulfillment === 'delivery'
        ? [['pending', 'Placed'], ['accepted', 'Confirmed'], ['preparing', 'Preparing'], ['ready', 'Ready'], ['out_for_delivery', 'On the way'], ['delivered', 'Delivered']]
        : [['pending', 'Placed'], ['accepted', 'Confirmed'], ['preparing', 'Preparing'], ['ready', 'Ready']];
    const currentStep = deliverySteps.findIndex(([status]) => status === order.status);
    return <article className="customer-order">
      <div className="row"><div><b>Order #{order.id}</b><p className="small muted">{formatOrderTime(order.createdAt)}</p></div>
        <span className={`order-status ${order.paymentStatus === 'pending' ? 'payment-pending' : order.status}`}>
          {order.paymentStatus === 'pending' ? 'Payment pending' : order.status.replaceAll('_', ' ')}
        </span></div>
      {order.status === 'rejected'
        ? <p className="customer-order-update">This order was declined by the restaurant. Please contact them if you need help.</p>
        : order.paymentStatus === 'pending'
            ? <p className="customer-order-update">Complete payment to send this order to the restaurant.</p>
            : <ol className={`customer-order-progress ${order.fulfillment}`} aria-label="Order progress">
              {deliverySteps.map(([status, label], index) => <li key={status}
                className={index < currentStep ? 'complete' : index === currentStep ? 'current' : ''}>
                <span aria-hidden="true">{index < currentStep ? '✓' : index + 1}</span><small>{label}</small>
              </li>)}
            </ol>}
      <div className="customer-order-items">{order.items.map((item, index) => <p key={`${item.name}-${index}`}>
        {item.quantity} × {item.name}{item.variantName ? ` (${item.variantName})` : ''} · {formatPrice(item.unitPricePaise * item.quantity)}
      </p>)}</div>
      {order.businessName && <p className="small muted">{order.businessName}</p>}
      {order.fulfillment === 'delivery' && <p className="small muted">
        Delivery · {order.deliveryAddress} · {order.deliveryFeePaise === 0 ? 'Free delivery' : formatPrice(order.deliveryFeePaise)}
        {order.deliveryPartnerName ? ` · ${order.deliveryPartnerName} is delivering` : ''}
      </p>}
      <div className="row"><span className="small muted">
        {order.fulfillment === 'delivery' ? 'Delivery' : 'Pickup'} · {order.paymentMethod === 'razorpay'
          ? `Razorpay · ${order.paymentStatus}`
          : order.paymentMethod === 'cash_on_delivery' ? 'Cash on delivery' : 'Cash on pickup'}
      </span><b>{formatPrice(order.totalPaise)}</b></div>
      {order.paymentMethod === 'razorpay' && order.paymentStatus === 'pending'
        && <button className="btn sm" disabled={busy} onClick={() => onRetry(order)}>Retry online payment</button>}
    </article>;
}
function groupMenuItems(items) {
    const groups = new Map();
    items.forEach(item => {
        const categoryItems = groups.get(item.category) ?? [];
        categoryItems.push(item);
        groups.set(item.category, categoryItems);
    });
    return [...groups.entries()];
}
function formatPrice(pricePaise) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(pricePaise / 100);
}
function estimateDeliveryFee(business, location) {
    if (!business || !location || business.latitude === null || business.longitude === null) return 0;
    const radians = degrees => degrees * Math.PI / 180;
    const latitudeDelta = radians(location.latitude - business.latitude);
    const longitudeDelta = radians(location.longitude - business.longitude);
    const a = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(radians(business.latitude)) * Math.cos(radians(location.latitude))
        * Math.sin(longitudeDelta / 2) ** 2;
    const boundedA = Math.min(1, Math.max(0, a));
    const distance = 6371 * 2 * Math.atan2(Math.sqrt(boundedA), Math.sqrt(1 - boundedA));
    if (distance <= 5) return 0;
    return (business.deliveryBaseFeePaise ?? 2000)
        + Math.ceil((distance - 5) * (business.deliveryPerKmPaise ?? 1000));
}
function formatOrderTime(createdAt) {
    return new Date(`${createdAt.replace(' ', 'T')}Z`).toLocaleString();
}
async function loadRazorpayCheckout() {
    if (window.Razorpay) return;
    await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Could not load Razorpay Checkout. Check your internet connection and retry.'));
        document.body.appendChild(script);
    });
    if (!window.Razorpay) throw new Error('Razorpay Checkout did not initialize. Please retry.');
}
function decodeNdefUrl(record) {
    if (typeof record.data === 'string') return record.data;
    if (!(record.data instanceof DataView) || record.data.byteLength === 0) return null;
    const prefixes = [
        '', 'http://www.', 'https://www.', 'http://', 'https://', 'tel:', 'mailto:',
        'ftp://anonymous:anonymous@', 'ftp://ftp.', 'ftps://', 'sftp://', 'smb://', 'nfs://',
        'ftp://', 'dav://', 'news:', 'telnet://', 'imap:', 'rtsp://', 'urn:', 'pop:', 'sip:',
        'sips:', 'tftp:', 'btspp://', 'btl2cap://', 'btgoep://', 'tcpobex://', 'irdaobex://',
        'file://', 'urn:epc:id:', 'urn:epc:tag:', 'urn:epc:pat:', 'urn:epc:raw:', 'urn:epc:',
        'urn:nfc:'
    ];
    const bytes = new Uint8Array(record.data.buffer, record.data.byteOffset, record.data.byteLength);
    const prefix = prefixes[bytes[0]];
    if (prefix === undefined) return null;
    return prefix + new TextDecoder().decode(bytes.subarray(1));
}
