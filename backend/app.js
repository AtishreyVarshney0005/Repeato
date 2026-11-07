import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'repeato_session';
const CUSTOMER_BONUS = 10;
const PASSWORD_HASH_ROUNDS = 10;

function publicUser(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        businessId: user.business_id,
        businessName: user.business_name,
        points: user.points,
        birthday: user.birthday,
        notificationsEnabled: Boolean(user.notifications_enabled),
        referralCode: user.referral_code,
        referredById: user.referred_by_id ?? null
    };
}

function validCredentials({ email, password }) {
    return typeof email === 'string'
        && email.trim().length <= 254
        && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
        && typeof password === 'string'
        && password.length >= 8
        && password.length <= 128;
}

function validBirthday(value) {
    if (value === null || value === '') return true;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime())
        && date.toISOString().slice(0, 10) === value
        && value <= new Date().toISOString().slice(0, 10);
}

function rewardView(reward) {
    return {
        id: reward.id,
        name: reward.name,
        pts: reward.points_required,
        icon: reward.icon,
        claimed: reward.claimed ?? 0,
        on: Boolean(reward.active)
    };
}

function menuItemView(item) {
    const { variantsJson, ...menuItem } = item;
    return {
        ...menuItem,
        variants: JSON.parse(variantsJson),
        ...(item.available === undefined ? {} : { available: Boolean(item.available) })
    };
}

function validMenuImage(imageData) {
    if (imageData === '') return true;
    if (typeof imageData !== 'string' || imageData.length > 1400000) return false;
    const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(imageData);
    if (!match) return false;
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > 1024 * 1024) return false;
    if (match[1] === 'png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (match[1] === 'jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
}

function orderItemsView(db, orderId) {
    return db.prepare(`
        SELECT item_name AS name, variant_name AS variantName, quantity,
            unit_price_paise AS unitPricePaise
        FROM order_items WHERE order_id = ? ORDER BY id
    `).all(orderId);
}

function orderView(db, order) {
    return {
        id: order.id,
        status: order.status,
        paymentMethod: order.payment_method,
        paymentStatus: order.payment_status,
        fulfillment: order.fulfillment,
        totalPaise: order.total_paise,
        businessName: order.business_name,
        deliveryAddress: order.delivery_address,
        deliveryDistanceKm: order.delivery_distance_km,
        deliveryFeePaise: order.delivery_fee_paise,
        deliveryPartnerName: order.delivery_partner_name,
        createdAt: order.created_at,
        ...(order.customer_name === undefined ? {} : {
            customerName: order.customer_name,
            customerEmail: order.customer_email
        }),
        items: orderItemsView(db, order.id)
    };
}

function distanceKm(firstLatitude, firstLongitude, secondLatitude, secondLongitude) {
    const radians = degrees => degrees * Math.PI / 180;
    const latitudeDelta = radians(secondLatitude - firstLatitude);
    const longitudeDelta = radians(secondLongitude - firstLongitude);
    const a = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(radians(firstLatitude)) * Math.cos(radians(secondLatitude))
        * Math.sin(longitudeDelta / 2) ** 2;
    const boundedA = Math.min(1, Math.max(0, a));
    return 6371 * 2 * Math.atan2(Math.sqrt(boundedA), Math.sqrt(1 - boundedA));
}

export function createApp(db, options = {}) {
    const app = express();
    const secret = options.jwtSecret || process.env.JWT_SECRET || 'local-development-secret-change-before-deploy';
    const razorpayKeyId = options.razorpayKeyId ?? process.env.RAZORPAY_KEY_ID ?? '';
    const razorpayKeySecret = options.razorpayKeySecret ?? process.env.RAZORPAY_KEY_SECRET ?? '';
    const razorpayFetch = options.razorpayFetch ?? fetch;
    const razorpayEnabled = Boolean(razorpayKeyId && razorpayKeySecret);
    const cookieOptions = {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000
    };
    const clearCookieOptions = {
        httpOnly: cookieOptions.httpOnly,
        sameSite: cookieOptions.sameSite,
        secure: cookieOptions.secure,
        path: cookieOptions.path
    };

    app.disable('x-powered-by');
    app.use(cookieParser());
    app.use((req, res, next) => express.json({
        limit: req.path === '/api/owner/menu' && req.method === 'POST' ? '2mb' : '10kb'
    })(req, res, next));

    const findUser = db.prepare(`
        SELECT users.*, businesses.name AS business_name
        FROM users JOIN businesses ON businesses.id = users.business_id
        WHERE users.id = ?
    `);
    const findPartner = db.prepare(`
        SELECT delivery_partners.*, businesses.name AS business_name, 'delivery_partner' AS role
        FROM delivery_partners JOIN businesses ON businesses.id = delivery_partners.business_id
        WHERE delivery_partners.id = ? AND delivery_partners.active = 1
    `);

    function requireAuth(req, res, next) {
        const token = req.cookies?.[COOKIE_NAME];
        if (!token) return res.status(401).json({ error: 'Please sign in to continue.' });
        try {
            const payload = jwt.verify(token, secret);
            const user = payload.role === 'delivery_partner'
                ? findPartner.get(payload.sub)
                : findUser.get(payload.sub);
            if (!user || user.role !== payload.role) {
                res.clearCookie(COOKIE_NAME, clearCookieOptions);
                return res.status(401).json({ error: 'Your session is no longer valid. Please sign in again.' });
            }
            req.user = user;
            return next();
        } catch {
            res.clearCookie(COOKIE_NAME, clearCookieOptions);
            return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
        }
    }

    function requireRole(role) {
        return (req, res, next) => {
            if (req.user.role !== role) return res.status(403).json({ error: 'You do not have permission to do that.' });
            return next();
        };
    }

    function setSession(res, user) {
        const token = jwt.sign({ sub: user.id, role: user.role }, secret, { expiresIn: '7d' });
        res.cookie(COOKIE_NAME, token, cookieOptions);
    }

    app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

    app.get('/api/businesses', (req, res) => {
        if (req.query.search !== undefined) {
            if (typeof req.query.search !== 'string' || req.query.search.trim().length > 100) {
                return res.status(400).json({ error: 'Enter a restaurant search of up to 100 characters.' });
            }
            const search = req.query.search.trim();
            if (!search) return res.json({ businesses: [] });
            const term = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
            const businesses = db.prepare(`
                SELECT businesses.id, businesses.name
                FROM businesses
                WHERE businesses.name LIKE ? ESCAPE '\\'
                    AND EXISTS (
                        SELECT 1 FROM users
                        WHERE users.business_id = businesses.id AND users.role = 'owner'
                    )
                ORDER BY businesses.name COLLATE NOCASE, businesses.id
                LIMIT 50
            `).all(term);
            return res.json({ businesses });
        }
        const businesses = db.prepare(`
            SELECT businesses.id, businesses.name,
                EXISTS (SELECT 1 FROM menu_items WHERE menu_items.business_id = businesses.id AND available = 1) AS has_menu,
                (businesses.latitude IS NOT NULL AND businesses.longitude IS NOT NULL) AS delivery_enabled
            FROM businesses ORDER BY businesses.name COLLATE NOCASE, businesses.id
        `).all().map(item => ({
            id: item.id, name: item.name, hasMenu: Boolean(item.has_menu),
            deliveryEnabled: Boolean(item.delivery_enabled)
        }));
        return res.json({ businesses });
    });

    app.get('/api/businesses/:id/menu', (req, res) => {
        const businessId = Number(req.params.id);
        if (!Number.isSafeInteger(businessId) || businessId <= 0) {
            return res.status(400).json({ error: 'Choose a valid restaurant.' });
        }
        const business = db.prepare(`
            SELECT id, name, menu_url AS menuUrl, latitude, longitude,
                delivery_base_fee_paise AS deliveryBaseFeePaise,
                delivery_per_km_paise AS deliveryPerKmPaise
            FROM businesses WHERE id = ?
                AND EXISTS (SELECT 1 FROM users WHERE users.business_id = businesses.id AND users.role = 'owner')
        `).get(businessId);
        if (!business) return res.status(404).json({ error: 'Restaurant not found.' });
        const menuItems = db.prepare(`
            SELECT id, name, description, category, price_paise AS pricePaise,
                image_data AS imageData, dietary_type AS dietaryType, spice_level AS spiceLevel,
                allergens, variants_json AS variantsJson
            FROM menu_items WHERE business_id = ? AND available = 1
            ORDER BY category COLLATE NOCASE, name COLLATE NOCASE
        `).all(businessId).map(menuItemView);
        return res.json({
            business: { ...business, deliveryEnabled: business.latitude !== null && business.longitude !== null },
            menuItems
        });
    });

    app.post('/api/auth/register', async (req, res, next) => {
        try {
            const { name, email, password, businessId, referralCode } = req.body ?? {};
            if (!validCredentials({ email, password }) || typeof name !== 'string' || !name.trim() || name.trim().length > 100) {
                return res.status(400).json({ error: 'Enter your name, a valid email, and a password of 8 to 128 characters.' });
            }
            if (referralCode !== undefined && (typeof referralCode !== 'string' || referralCode.trim().length > 64)) {
                return res.status(400).json({ error: 'Invalid referral link.' });
            }
            const business = Number.isSafeInteger(businessId) && businessId > 0
                ? db.prepare('SELECT id FROM businesses WHERE id = ?').get(businessId)
                : null;
            if (!business) return res.status(400).json({ error: 'Choose a valid business to join.' });
            const referral = referralCode?.trim()
                ? db.prepare(`
                    SELECT id FROM users
                    WHERE referral_code = ? COLLATE NOCASE AND business_id = ? AND role = 'customer'
                `).get(referralCode.trim(), business.id)
                : null;
            if (referralCode?.trim() && !referral) {
                return res.status(400).json({ error: 'This referral link is invalid or belongs to another business.' });
            }
            const passwordHash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);
            const createCustomer = db.transaction(() => {
                const referralBonus = referral ? 20 : 0;
                const result = db.prepare(`
                    INSERT INTO users (
                        business_id, name, email, password_hash, role, points, referral_code, referred_by_id
                    ) VALUES (?, ?, ?, ?, 'customer', ?, ?, ?)
                `).run(
                    business.id,
                    name.trim(),
                    email.trim().toLowerCase(),
                    passwordHash,
                    CUSTOMER_BONUS + referralBonus,
                    randomBytes(8).toString('hex'),
                    referral?.id ?? null
                );
                const userId = Number(result.lastInsertRowid);
                db.prepare(`
                    INSERT INTO point_transactions (business_id, user_id, type, points_delta, description)
                    VALUES (?, ?, 'bonus', ?, 'Welcome bonus')
                `).run(business.id, userId, CUSTOMER_BONUS);
                if (referral) {
                    db.prepare('UPDATE users SET points = points + 20 WHERE id = ?').run(referral.id);
                    db.prepare(`
                        INSERT INTO point_transactions (business_id, user_id, type, points_delta, description)
                        VALUES (?, ?, 'bonus', 20, 'Friend referral bonus')
                    `).run(business.id, userId);
                    db.prepare(`
                        INSERT INTO point_transactions (business_id, user_id, type, points_delta, description)
                        VALUES (?, ?, 'bonus', 20, 'Friend referral bonus')
                    `).run(business.id, referral.id);
                }
                return userId;
            });
            const userId = createCustomer();
            const user = findUser.get(userId);
            setSession(res, user);
            return res.status(201).json({ user: publicUser(user) });
        } catch (error) {
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return res.status(409).json({ error: 'An account with this email already exists.' });
            }
            return next(error);
        }
    });

    app.post('/api/auth/register-owner', async (req, res, next) => {
        try {
            const { name, email, password, businessName } = req.body ?? {};
            if (!validCredentials({ email, password })
                || typeof name !== 'string' || !name.trim() || name.trim().length > 100
                || typeof businessName !== 'string' || !businessName.trim() || businessName.trim().length > 120) {
                return res.status(400).json({ error: 'Enter your name, business name, valid email, and a password of 8 to 128 characters.' });
            }
            const passwordHash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);
            const createOwner = db.transaction(() => {
                if (db.prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE AND role = 'owner'").get(email.trim())) {
                    const error = new Error('An owner account with this email already exists.');
                    error.code = 'SQLITE_CONSTRAINT_UNIQUE';
                    throw error;
                }
                const businessResult = db.prepare('INSERT INTO businesses (name) VALUES (?)').run(businessName.trim());
                const businessId = Number(businessResult.lastInsertRowid);
                const userResult = db.prepare(`
                    INSERT INTO users (business_id, name, email, password_hash, role)
                    VALUES (?, ?, ?, ?, 'owner')
                `).run(businessId, name.trim(), email.trim().toLowerCase(), passwordHash);
                const insertReward = db.prepare(`
                    INSERT INTO rewards (business_id, name, points_required, icon, active)
                    VALUES (?, ?, ?, ?, 1)
                `);
                insertReward.run(businessId, 'Free coffee', 100, '☕');
                insertReward.run(businessId, '10% off your bill', 150, '%');
                return Number(userResult.lastInsertRowid);
            });
            const user = findUser.get(createOwner());
            setSession(res, user);
            return res.status(201).json({ user: publicUser(user) });
        } catch (error) {
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return res.status(409).json({ error: 'An account with this email already exists for this business.' });
            }
            return next(error);
        }
    });

    app.post('/api/auth/login', async (req, res, next) => {
        try {
            const { email, password, role } = req.body ?? {};
            if (!validCredentials({ email, password }) || !['customer', 'owner', 'delivery_partner'].includes(role)) {
                return res.status(400).json({ error: 'Enter a valid email and password.' });
            }
            const user = role === 'delivery_partner'
                ? db.prepare(`
                    SELECT delivery_partners.*, businesses.name AS business_name, 'delivery_partner' AS role
                    FROM delivery_partners JOIN businesses ON businesses.id = delivery_partners.business_id
                    WHERE delivery_partners.email = ? COLLATE NOCASE AND delivery_partners.active = 1
                `).get(email.trim())
                : db.prepare(`
                    SELECT users.*, businesses.name AS business_name
                    FROM users JOIN businesses ON businesses.id = users.business_id
                    WHERE users.email = ? COLLATE NOCASE AND users.role = ?
                    ORDER BY users.id LIMIT 1
                `).get(email.trim(), role);
            if (!user || !(await bcrypt.compare(password, user.password_hash))) {
                return res.status(401).json({ error: 'Email or password is incorrect.' });
            }
            if (bcrypt.getRounds(user.password_hash) !== PASSWORD_HASH_ROUNDS) {
                const passwordHash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);
                db.prepare(role === 'delivery_partner'
                    ? 'UPDATE delivery_partners SET password_hash = ? WHERE id = ?'
                    : 'UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, user.id);
            }
            setSession(res, user);
            return res.json({ user: publicUser(user) });
        } catch (error) {
            return next(error);
        }
    });

    app.post('/api/auth/logout', (_req, res) => {
        res.clearCookie(COOKIE_NAME, clearCookieOptions);
        res.status(204).end();
    });

    app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

    app.post('/api/delivery-partner/register', async (req, res, next) => {
        try {
            const { name, email, password, inviteToken } = req.body ?? {};
            if (!validCredentials({ email, password }) || typeof name !== 'string'
                || !name.trim() || name.trim().length > 100
                || typeof inviteToken !== 'string' || inviteToken.length < 32 || inviteToken.length > 200) {
                return res.status(400).json({ error: 'Enter your name, a valid email, password, and invitation link.' });
            }
            const tokenHash = createHmac('sha256', secret).update(inviteToken).digest('hex');
            const invite = db.prepare(`
                SELECT * FROM delivery_partner_invites
                WHERE token_hash = ? AND email = ? COLLATE NOCASE
                    AND used_at IS NULL AND expires_at > datetime('now')
            `).get(tokenHash, email.trim());
            if (!invite) return res.status(400).json({ error: 'This delivery partner invitation is invalid or expired.' });
            const passwordHash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);
            const register = db.transaction(() => {
                const currentInvite = db.prepare(`
                    UPDATE delivery_partner_invites SET used_at = datetime('now')
                    WHERE id = ? AND used_at IS NULL AND expires_at > datetime('now')
                `).run(invite.id);
                if (!currentInvite.changes) return null;
                const result = db.prepare(`
                    INSERT INTO delivery_partners (business_id, name, email, password_hash)
                    VALUES (?, ?, ?, ?)
                `).run(invite.business_id, name.trim(), email.trim(), passwordHash);
                return findPartner.get(Number(result.lastInsertRowid));
            });
            const partner = register();
            if (!partner) return res.status(409).json({ error: 'This invitation has already been used.' });
            setSession(res, partner);
            return res.status(201).json({ user: publicUser(partner) });
        } catch (error) {
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return res.status(409).json({ error: 'An account with this email already exists.' });
            }
            return next(error);
        }
    });

    app.patch('/api/customer/profile', requireAuth, requireRole('customer'), (req, res) => {
        const { name, birthday, notificationsEnabled } = req.body ?? {};
        if (typeof name !== 'string' || !name.trim() || name.trim().length > 100
            || !validBirthday(birthday)
            || typeof notificationsEnabled !== 'boolean') {
            return res.status(400).json({ error: 'Enter a valid name, birthday, and notification setting.' });
        }
        db.prepare(`
            UPDATE users SET name = ?, birthday = ?, notifications_enabled = ?
            WHERE id = ? AND role = 'customer'
        `).run(name.trim(), birthday || null, notificationsEnabled ? 1 : 0, req.user.id);
        return res.json({ user: publicUser(findUser.get(req.user.id)) });
    });

    app.delete('/api/customer/account', requireAuth, requireRole('customer'), async (req, res, next) => {
        try {
            const { password } = req.body ?? {};
            if (typeof password !== 'string' || !(await bcrypt.compare(password, req.user.password_hash))) {
                return res.status(401).json({ error: 'Password is incorrect.' });
            }
            db.prepare('DELETE FROM users WHERE id = ? AND role = ?').run(req.user.id, 'customer');
            res.clearCookie(COOKIE_NAME, clearCookieOptions);
            return res.status(204).end();
        } catch (error) {
            return next(error);
        }
    });

    app.post('/api/customer/check-ins', requireAuth, requireRole('customer'), (req, res, next) => {
        const { businessId } = req.body ?? {};
        if (!Number.isSafeInteger(businessId) || businessId !== req.user.business_id) {
            return res.status(400).json({ error: 'This visit QR code is not for your rewards business.' });
        }
        try {
            const result = db.prepare(`
                INSERT INTO visit_checkins (business_id, user_id, status)
                VALUES (?, ?, 'pending')
            `).run(businessId, req.user.id);
            return res.status(201).json({ checkInId: Number(result.lastInsertRowid), status: 'pending' });
        } catch (error) {
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return res.status(409).json({ error: 'Your visit is already waiting for owner approval.' });
            }
            return next(error);
        }
    });

    app.get('/api/customer/dashboard', requireAuth, requireRole('customer'), (req, res) => {
        const business = db.prepare(`SELECT id, points_per_visit, menu_url, latitude, longitude,
            delivery_base_fee_paise, delivery_per_km_paise FROM businesses WHERE id = ?`)
            .get(req.user.business_id);
        const rewards = db.prepare(`
            SELECT rewards.*, COUNT(point_transactions.id) AS claimed
            FROM rewards LEFT JOIN point_transactions
                ON point_transactions.reward_id = rewards.id AND point_transactions.type = 'redeem'
            WHERE rewards.business_id = ? AND rewards.active = 1
            GROUP BY rewards.id ORDER BY rewards.points_required
        `).all(req.user.business_id).map(rewardView);
        const transactions = db.prepare(`
            SELECT description AS title, type, points_delta AS points, created_at
            FROM point_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 20
        `).all(req.user.id).map(item => ({
            title: item.title,
            type: item.type,
            pts: Math.abs(item.points),
            when: new Date(`${item.created_at.replace(' ', 'T')}Z`).toLocaleDateString()
        }));
        const visits = db.prepare(`
            SELECT COUNT(*) AS total FROM visit_checkins
            WHERE user_id = ? AND status = 'approved'
        `).get(req.user.id).total;
        const pendingCheckIn = db.prepare(`
            SELECT id FROM visit_checkins WHERE user_id = ? AND status = 'pending'
        `).get(req.user.id);
        const claimed = db.prepare(`
            SELECT COUNT(*) AS total FROM point_transactions WHERE user_id = ? AND type = 'redeem'
        `).get(req.user.id).total;
        const referrals = db.prepare(`
            SELECT COUNT(*) AS total FROM users WHERE referred_by_id = ? AND role = 'customer'
        `).get(req.user.id).total;
        const menuItems = db.prepare(`
            SELECT id, name, description, category, price_paise AS pricePaise,
                image_data AS imageData, dietary_type AS dietaryType, spice_level AS spiceLevel,
                allergens, variants_json AS variantsJson
            FROM menu_items
            WHERE business_id = ? AND available = 1
            ORDER BY category COLLATE NOCASE, name COLLATE NOCASE
        `).all(req.user.business_id).map(menuItemView);
        const orders = db.prepare(`
            SELECT orders.id, orders.status, orders.payment_method, orders.payment_status,
                orders.fulfillment, orders.total_paise, orders.delivery_address,
                orders.delivery_distance_km, orders.delivery_fee_paise, orders.created_at,
                businesses.name AS business_name, delivery_partners.name AS delivery_partner_name
            FROM orders JOIN businesses ON businesses.id = orders.business_id
            LEFT JOIN delivery_partners ON delivery_partners.id = orders.delivery_partner_id
            WHERE customer_id = ? ORDER BY orders.id DESC LIMIT 50
        `).all(req.user.id).map(order => orderView(db, order));
        return res.json({
            user: publicUser(req.user),
            business: {
                id: business.id, pointsPerVisit: business.points_per_visit, menuUrl: business.menu_url,
                name: req.user.business_name, latitude: business.latitude, longitude: business.longitude,
                deliveryBaseFeePaise: business.delivery_base_fee_paise,
                deliveryPerKmPaise: business.delivery_per_km_paise,
                deliveryEnabled: business.latitude !== null && business.longitude !== null
            },
            payment: { razorpayEnabled, razorpayKeyId: razorpayEnabled ? razorpayKeyId : '' },
            points: req.user.points,
            visits,
            claimed,
            referrals,
            pendingCheckIn: pendingCheckIn?.id ?? null,
            rewards,
            transactions,
            menuItems,
            orders
        });
    });

    app.get('/api/customer/orders', requireAuth, requireRole('customer'), (req, res) => {
        const orders = db.prepare(`
            SELECT orders.id, orders.status, orders.payment_method, orders.payment_status,
                orders.fulfillment, orders.total_paise, orders.delivery_address,
                orders.delivery_distance_km, orders.delivery_fee_paise, orders.created_at,
                businesses.name AS business_name, delivery_partners.name AS delivery_partner_name
            FROM orders JOIN businesses ON businesses.id = orders.business_id
            LEFT JOIN delivery_partners ON delivery_partners.id = orders.delivery_partner_id
            WHERE orders.customer_id = ? ORDER BY orders.id DESC LIMIT 50
        `).all(req.user.id).map(order => orderView(db, order));
        return res.json({ orders });
    });

    app.get('/api/customer/payment-config', requireAuth, requireRole('customer'), (req, res) => {
        return res.json({ enabled: razorpayEnabled, keyId: razorpayEnabled ? razorpayKeyId : '' });
    });

    app.post('/api/customer/orders', requireAuth, requireRole('customer'), (req, res) => {
        const {
            items, businessId = req.user.business_id, fulfillment = 'pickup',
            paymentMethod = fulfillment === 'delivery' ? 'cash_on_delivery' : 'cash_on_pickup',
            deliveryAddress, deliveryLatitude, deliveryLongitude
        } = req.body ?? {};
        if (!Number.isSafeInteger(businessId) || businessId <= 0
            || !['pickup', 'delivery'].includes(fulfillment)
            || !['cash_on_pickup', 'cash_on_delivery', 'razorpay'].includes(paymentMethod)
            || (fulfillment === 'pickup' && paymentMethod === 'cash_on_delivery')
            || (fulfillment === 'delivery' && paymentMethod === 'cash_on_pickup')) {
            return res.status(400).json({ error: 'Choose a valid restaurant, fulfillment, and payment method.' });
        }
        if (fulfillment === 'delivery' && (typeof deliveryAddress !== 'string'
            || deliveryAddress.trim().length < 8 || deliveryAddress.trim().length > 500
            || typeof deliveryLatitude !== 'number' || !Number.isFinite(deliveryLatitude)
            || deliveryLatitude < -90 || deliveryLatitude > 90
            || typeof deliveryLongitude !== 'number' || !Number.isFinite(deliveryLongitude)
            || deliveryLongitude < -180 || deliveryLongitude > 180)) {
            return res.status(400).json({ error: 'Enter a delivery address and allow location access to calculate delivery.' });
        }
        if (paymentMethod === 'razorpay' && !razorpayEnabled) {
            return res.status(503).json({ error: 'Online payment is not configured. Choose cash on pickup or contact the restaurant.' });
        }
        if (!Array.isArray(items) || items.length < 1 || items.length > 30
            || items.some(item => !item || !Number.isSafeInteger(item.menuItemId) || item.menuItemId <= 0
                || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 20
                || (item.variantName !== undefined && (typeof item.variantName !== 'string' || item.variantName.length > 30)))) {
            return res.status(400).json({ error: 'Your cart has invalid items. Please review it and try again.' });
        }
        const cartKeys = items.map(item => `${item.menuItemId}:${item.variantName ?? ''}`);
        if (new Set(cartKeys).size !== cartKeys.length) {
            return res.status(400).json({ error: 'Remove duplicate items from your cart and try again.' });
        }

        try {
            const orderId = db.transaction(() => {
                const orderLines = items.map(line => {
                    const menuItem = db.prepare(`
                        SELECT id, name, price_paise, variants_json
                        FROM menu_items
                        WHERE id = ? AND business_id = ? AND available = 1
                    `).get(line.menuItemId, businessId);
                    if (!menuItem) {
                        const error = new Error('One or more dishes are no longer available. Please review your cart.');
                        error.status = 409;
                        throw error;
                    }
                    const variants = JSON.parse(menuItem.variants_json);
                    let unitPricePaise = menuItem.price_paise;
                    let variantName = '';
                    if (variants.length) {
                        const variant = variants.find(candidate => candidate.name === line.variantName);
                        if (!variant) {
                            const error = new Error(`${menuItem.name} has an invalid size. Please review your cart.`);
                            error.status = 400;
                            throw error;
                        }
                        variantName = variant.name;
                        unitPricePaise = variant.pricePaise;
                    } else if (line.variantName) {
                        const error = new Error(`${menuItem.name} does not have size options.`);
                        error.status = 400;
                        throw error;
                    }
                    return { ...line, name: menuItem.name, variantName, unitPricePaise };
                });
                const itemTotalPaise = orderLines.reduce((total, item) => total + item.unitPricePaise * item.quantity, 0);
                const businessRow = db.prepare(`
                    SELECT latitude, longitude, delivery_base_fee_paise, delivery_per_km_paise
                    FROM businesses WHERE id = ?
                        AND EXISTS (SELECT 1 FROM users WHERE users.business_id = businesses.id AND users.role = 'owner')
                `).get(businessId);
                if (!businessRow) {
                    const error = new Error('Restaurant not found.');
                    error.status = 404;
                    throw error;
                }
                let deliveryDistanceKm = 0;
                let deliveryFeePaise = 0;
                if (fulfillment === 'delivery') {
                    if (businessRow.latitude === null || businessRow.longitude === null) {
                        const error = new Error('This restaurant has not set up delivery yet.');
                        error.status = 409;
                        throw error;
                    }
                    deliveryDistanceKm = distanceKm(
                        businessRow.latitude, businessRow.longitude, deliveryLatitude, deliveryLongitude
                    );
                    deliveryFeePaise = deliveryDistanceKm <= 5
                        ? 0
                        : businessRow.delivery_base_fee_paise
                            + Math.ceil((deliveryDistanceKm - 5) * businessRow.delivery_per_km_paise);
                }
                const totalPaise = itemTotalPaise + deliveryFeePaise;
                if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0 || totalPaise > 10000000) {
                    const error = new Error('The order total must be between ₹0.01 and ₹100,000.');
                    error.status = 400;
                    throw error;
                }
                const result = db.prepare(`
                    INSERT INTO orders (
                        business_id, customer_id, total_paise, payment_method, payment_status,
                        fulfillment, delivery_address, delivery_latitude, delivery_longitude,
                        delivery_distance_km, delivery_fee_paise
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    businessId, req.user.id, totalPaise, paymentMethod,
                    paymentMethod === 'razorpay' ? 'pending' : 'cash_due',
                    fulfillment, fulfillment === 'delivery' ? deliveryAddress.trim() : '',
                    fulfillment === 'delivery' ? deliveryLatitude : null,
                    fulfillment === 'delivery' ? deliveryLongitude : null,
                    deliveryDistanceKm, deliveryFeePaise
                );
                const addItem = db.prepare(`
                    INSERT INTO order_items (order_id, menu_item_id, item_name, variant_name, quantity, unit_price_paise)
                    VALUES (?, ?, ?, ?, ?, ?)
                `);
                for (const item of orderLines) {
                    addItem.run(result.lastInsertRowid, item.menuItemId, item.name, item.variantName, item.quantity, item.unitPricePaise);
                }
                return Number(result.lastInsertRowid);
            })();
            const order = db.prepare(`
                SELECT orders.id, orders.status, orders.payment_method, orders.payment_status,
                    orders.fulfillment, orders.total_paise, orders.delivery_address,
                    orders.delivery_distance_km, orders.delivery_fee_paise, orders.created_at,
                    businesses.name AS business_name
                FROM orders JOIN businesses ON businesses.id = orders.business_id
                WHERE orders.id = ? AND orders.customer_id = ?
            `).get(orderId, req.user.id);
            return res.status(201).json({ order: orderView(db, order) });
        } catch (error) {
            if (error.status) return res.status(error.status).json({ error: error.message });
            throw error;
        }
    });

    app.post('/api/customer/orders/:id/payment-intent', requireAuth, requireRole('customer'), async (req, res, next) => {
        const orderId = Number(req.params.id);
        if (!Number.isSafeInteger(orderId) || orderId <= 0) return res.status(400).json({ error: 'Choose a valid order.' });
        if (!razorpayEnabled) return res.status(503).json({ error: 'Razorpay online payment is not configured.' });
        const order = db.prepare(`
            SELECT id, status, payment_method, payment_status, total_paise, razorpay_order_id
            FROM orders WHERE id = ? AND customer_id = ?
        `).get(orderId, req.user.id);
        if (!order) return res.status(404).json({ error: 'Order not found.' });
        if (order.payment_method !== 'razorpay' || order.payment_status !== 'pending' || order.status !== 'pending') {
            return res.status(409).json({ error: 'This order is not awaiting online payment.' });
        }
        if (order.razorpay_order_id) {
            return res.json({
                keyId: razorpayKeyId,
                razorpayOrderId: order.razorpay_order_id,
                amount: order.total_paise,
                currency: 'INR',
                name: req.user.business_name,
                description: `Pickup order #${order.id}`,
                customer: { name: req.user.name, email: req.user.email }
            });
        }
        try {
            const response = await razorpayFetch('https://api.razorpay.com/v1/orders', {
                method: 'POST',
                headers: {
                    Authorization: `Basic ${Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString('base64')}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    amount: order.total_paise,
                    currency: 'INR',
                    receipt: `repeato-${order.id}`,
                    notes: { repeato_order_id: String(order.id) }
                })
            });
            const providerOrder = await response.json();
            if (!response.ok || providerOrder.amount !== order.total_paise || providerOrder.currency !== 'INR'
                || typeof providerOrder.id !== 'string' || !providerOrder.id.startsWith('order_')) {
                return res.status(502).json({ error: 'Razorpay could not prepare this payment. Please retry or choose cash on pickup.' });
            }
            const saved = db.prepare(`
                UPDATE orders SET razorpay_order_id = ?, updated_at = datetime('now')
                WHERE id = ? AND customer_id = ? AND payment_status = 'pending' AND razorpay_order_id IS NULL
            `).run(providerOrder.id, orderId, req.user.id);
            if (!saved.changes) {
                const current = db.prepare('SELECT razorpay_order_id FROM orders WHERE id = ? AND customer_id = ?')
                    .get(orderId, req.user.id);
                if (!current?.razorpay_order_id) return res.status(409).json({ error: 'This order changed. Refresh and retry payment.' });
                return res.json({
                    keyId: razorpayKeyId, razorpayOrderId: current.razorpay_order_id,
                    amount: order.total_paise, currency: 'INR', name: req.user.business_name,
                    description: `Pickup order #${order.id}`, customer: { name: req.user.name, email: req.user.email }
                });
            }
            return res.json({
                keyId: razorpayKeyId,
                razorpayOrderId: providerOrder.id,
                amount: order.total_paise,
                currency: 'INR',
                name: req.user.business_name,
                description: `Pickup order #${order.id}`,
                customer: { name: req.user.name, email: req.user.email }
            });
        } catch (error) {
            return next(error);
        }
    });

    app.post('/api/customer/orders/:id/verify-payment', requireAuth, requireRole('customer'), async (req, res, next) => {
        const orderId = Number(req.params.id);
        const { razorpay_order_id: razorpayOrderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body ?? {};
        if (!Number.isSafeInteger(orderId) || orderId <= 0
            || typeof razorpayOrderId !== 'string' || razorpayOrderId.length > 100
            || typeof paymentId !== 'string' || !/^pay_[A-Za-z0-9]+$/.test(paymentId)
            || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) {
            return res.status(400).json({ error: 'Razorpay returned invalid payment details.' });
        }
        if (!razorpayEnabled) return res.status(503).json({ error: 'Razorpay online payment is not configured.' });
        const order = db.prepare(`
            SELECT id, status, payment_method, payment_status, total_paise, razorpay_order_id
            FROM orders WHERE id = ? AND customer_id = ?
        `).get(orderId, req.user.id);
        if (!order) return res.status(404).json({ error: 'Order not found.' });
        if (order.payment_method !== 'razorpay' || order.razorpay_order_id !== razorpayOrderId) {
            return res.status(400).json({ error: 'This payment does not match your order.' });
        }
        const expectedSignature = createHmac('sha256', razorpayKeySecret)
            .update(`${razorpayOrderId}|${paymentId}`)
            .digest('hex');
        const suppliedBuffer = Buffer.from(signature.toLowerCase(), 'ascii');
        const expectedBuffer = Buffer.from(expectedSignature, 'ascii');
        if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) {
            return res.status(400).json({ error: 'Payment verification failed. Please contact support if money was deducted.' });
        }
        if (order.payment_status === 'paid') {
            return res.json({ order: orderView(db, db.prepare(`
                SELECT id, status, payment_method, payment_status, fulfillment, total_paise, created_at
                FROM orders WHERE id = ? AND customer_id = ?
            `).get(orderId, req.user.id)) });
        }
        if (order.payment_status !== 'pending') {
            return res.status(409).json({ error: 'This order is no longer awaiting payment.' });
        }
        try {
            const auth = `Basic ${Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString('base64')}`;
            let paymentResponse = await razorpayFetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
                headers: { Authorization: auth }
            });
            let payment = await paymentResponse.json();
            if (!paymentResponse.ok || payment.order_id !== razorpayOrderId
                || payment.amount !== order.total_paise || payment.currency !== 'INR') {
                return res.status(400).json({ error: 'Payment amount or order could not be verified.' });
            }
            if (payment.status === 'authorized') {
                paymentResponse = await razorpayFetch(`https://api.razorpay.com/v1/payments/${paymentId}/capture`, {
                    method: 'POST',
                    headers: { Authorization: auth, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ amount: order.total_paise, currency: 'INR' })
                });
                payment = await paymentResponse.json();
            }
            if (!paymentResponse.ok || payment.status !== 'captured' || payment.order_id !== razorpayOrderId
                || payment.amount !== order.total_paise || payment.currency !== 'INR') {
                return res.status(409).json({ error: 'Payment is not captured yet. Please retry verification shortly.' });
            }
            db.prepare(`
                UPDATE orders SET payment_status = 'paid', razorpay_payment_id = ?, updated_at = datetime('now')
                WHERE id = ? AND customer_id = ? AND payment_status = 'pending'
            `).run(paymentId, orderId, req.user.id);
            const verifiedOrder = db.prepare(`
                SELECT id, status, payment_method, payment_status, fulfillment, total_paise, created_at
                FROM orders WHERE id = ? AND customer_id = ?
            `).get(orderId, req.user.id);
            return res.json({ order: orderView(db, verifiedOrder) });
        } catch (error) {
            return next(error);
        }
    });

    app.post('/api/customer/rewards/:id/redeem', requireAuth, requireRole('customer'), (req, res, next) => {
        const rewardId = Number(req.params.id);
        if (!Number.isSafeInteger(rewardId) || rewardId <= 0) return res.status(400).json({ error: 'Invalid reward.' });
        try {
            const redeem = db.transaction(() => {
                const reward = db.prepare(`
                    SELECT * FROM rewards WHERE id = ? AND business_id = ? AND active = 1
                `).get(rewardId, req.user.business_id);
                if (!reward) {
                    const error = new Error('This reward is not available.');
                    error.status = 404;
                    throw error;
                }
                const user = db.prepare('SELECT points FROM users WHERE id = ?').get(req.user.id);
                if (user.points < reward.points_required) {
                    const error = new Error('You do not have enough points for this reward.');
                    error.status = 400;
                    throw error;
                }
                db.prepare('UPDATE users SET points = points - ? WHERE id = ?')
                    .run(reward.points_required, req.user.id);
                db.prepare(`
                    INSERT INTO point_transactions (business_id, user_id, reward_id, type, points_delta, description)
                    VALUES (?, ?, ?, 'redeem', ?, ?)
                `).run(req.user.business_id, req.user.id, reward.id, -reward.points_required, reward.name);
            });
            redeem();
            const updatedUser = findUser.get(req.user.id);
            return res.json({ points: updatedUser.points });
        } catch (error) {
            if (error.status) return res.status(error.status).json({ error: error.message });
            return next(error);
        }
    });

    app.get('/api/owner/dashboard', requireAuth, requireRole('owner'), (req, res) => {
        const businessId = req.user.business_id;
        const totals = db.prepare(`
            SELECT
                COUNT(DISTINCT users.id) AS customers,
                COALESCE(SUM(CASE WHEN points_delta > 0 AND point_transactions.created_at >= datetime('now', '-7 days') THEN points_delta ELSE 0 END), 0) AS points_issued,
                COALESCE(SUM(CASE WHEN type = 'redeem' AND point_transactions.created_at >= datetime('now', '-7 days') THEN -points_delta ELSE 0 END), 0) AS points_redeemed
            FROM users LEFT JOIN point_transactions
                ON point_transactions.user_id = users.id AND point_transactions.business_id = users.business_id
            WHERE users.business_id = ? AND users.role = 'customer'
        `).get(businessId);
        const customers = db.prepare(`
            SELECT users.name, users.email, users.points, COUNT(visit_checkins.id) AS visits
            FROM users LEFT JOIN visit_checkins
                ON visit_checkins.user_id = users.id
                AND visit_checkins.business_id = users.business_id
                AND visit_checkins.status = 'approved'
            WHERE users.business_id = ? AND users.role = 'customer'
            GROUP BY users.id
            ORDER BY visits DESC, users.points DESC, users.created_at DESC LIMIT 5
        `).all(businessId);
        const signups = db.prepare(`
            SELECT CAST(strftime('%w', created_at) AS INTEGER) AS weekday, COUNT(*) AS total
            FROM users WHERE business_id = ? AND role = 'customer'
                AND created_at >= datetime('now', '-6 days')
            GROUP BY weekday
        `).all(businessId);
        const signupTotals = new Map(signups.map(row => [row.weekday, row.total]));
        const newCustomers = signups.reduce((sum, row) => sum + row.total, 0);
        const weeklySignups = Array.from({ length: 7 }, (_, index) => {
            const date = new Date();
            date.setDate(date.getDate() - (6 - index));
            const weekday = date.getDay();
            return {
                day: date.toLocaleDateString('en', { weekday: 'short' }),
                total: signupTotals.get(weekday) || 0
            };
        });
        const visits = db.prepare(`
            SELECT CAST(strftime('%w', approved_at) AS INTEGER) AS weekday, COUNT(*) AS total
            FROM visit_checkins
            WHERE business_id = ? AND status = 'approved'
                AND approved_at >= datetime('now', '-6 days')
            GROUP BY weekday
        `).all(businessId);
        const visitTotals = new Map(visits.map(row => [row.weekday, row.total]));
        const weeklyVisits = Array.from({ length: 7 }, (_, index) => {
            const date = new Date();
            date.setDate(date.getDate() - (6 - index));
            const weekday = date.getDay();
            return {
                day: date.toLocaleDateString('en', { weekday: 'short' }),
                total: visitTotals.get(weekday) || 0
            };
        });
        const redemptions = db.prepare(`
            SELECT point_transactions.description AS name, users.email, point_transactions.created_at
            FROM point_transactions JOIN users ON users.id = point_transactions.user_id
            WHERE point_transactions.business_id = ? AND point_transactions.type = 'redeem'
            ORDER BY point_transactions.id DESC LIMIT 5
        `).all(businessId).map(item => ({
            name: item.name,
            email: item.email,
            when: new Date(`${item.created_at.replace(' ', 'T')}Z`).toLocaleDateString()
        }));
        const claims = db.prepare(`
            SELECT COUNT(*) AS total FROM point_transactions
            WHERE business_id = ? AND type = 'redeem' AND created_at >= datetime('now', '-7 days')
        `).get(businessId).total;
        const repeatVisits = db.prepare(`
            SELECT COUNT(*) AS total FROM (
                SELECT user_id FROM visit_checkins
                WHERE business_id = ? AND status = 'approved'
                GROUP BY user_id HAVING COUNT(*) > 1
            )
        `).get(businessId).total;
        const repeatVisitRate = totals.customers
            ? Math.round((repeatVisits / totals.customers) * 100)
            : 0;
        return res.json({
            stats: {
                customers: totals.customers,
                pointsIssued: totals.points_issued,
                pointsRedeemed: totals.points_redeemed,
                rewardsClaimed: claims,
                newCustomers,
                returningCustomers: repeatVisits,
                repeatVisitRate
            },
            weeklySignups,
            weeklyVisits,
            topCustomers: customers,
            redemptions
        });
    });

    app.get('/api/owner/customers', requireAuth, requireRole('owner'), (req, res) => {
        const customers = db.prepare(`
            SELECT users.id, users.name, users.email, users.points, users.created_at,
                COUNT(DISTINCT visit_checkins.id) AS visits,
                COUNT(DISTINCT CASE WHEN point_transactions.type = 'redeem' THEN point_transactions.id END) AS rewards_claimed,
                MAX(CASE WHEN visit_checkins.status = 'approved' THEN visit_checkins.approved_at END) AS last_visit
            FROM users
            LEFT JOIN visit_checkins ON visit_checkins.user_id = users.id AND visit_checkins.status = 'approved'
            LEFT JOIN point_transactions ON point_transactions.user_id = users.id
            WHERE users.business_id = ? AND users.role = 'customer'
            GROUP BY users.id
            ORDER BY users.created_at DESC
            LIMIT 200
        `).all(req.user.business_id);
        return res.json({ customers });
    });

    app.get('/api/owner/check-ins', requireAuth, requireRole('owner'), (req, res) => {
        const checkIns = db.prepare(`
            SELECT visit_checkins.id, visit_checkins.requested_at, users.name, users.email
            FROM visit_checkins JOIN users ON users.id = visit_checkins.user_id
            WHERE visit_checkins.business_id = ? AND visit_checkins.status = 'pending'
            ORDER BY visit_checkins.requested_at
        `).all(req.user.business_id);
        return res.json({ checkIns });
    });

    app.post('/api/owner/check-ins/:id/approve', requireAuth, requireRole('owner'), (req, res) => {
        const checkInId = Number(req.params.id);
        if (!Number.isSafeInteger(checkInId) || checkInId <= 0) {
            return res.status(400).json({ error: 'Invalid visit request.' });
        }
        const approve = db.transaction(() => {
            const checkIn = db.prepare(`
                SELECT id, user_id FROM visit_checkins
                WHERE id = ? AND business_id = ? AND status = 'pending'
            `).get(checkInId, req.user.business_id);
            if (!checkIn) return null;
            const points = db.prepare('SELECT points_per_visit FROM businesses WHERE id = ?')
                .get(req.user.business_id).points_per_visit;
            db.prepare(`
                UPDATE visit_checkins SET status = 'approved', points_awarded = ?, approved_at = datetime('now')
                WHERE id = ? AND status = 'pending'
            `).run(points, checkInId);
            db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(points, checkIn.user_id);
            db.prepare(`
                INSERT INTO point_transactions (business_id, user_id, type, points_delta, description)
                VALUES (?, ?, 'earn', ?, 'Verified visit')
            `).run(req.user.business_id, checkIn.user_id, points);
            return { points };
        });
        const result = approve();
        if (!result) return res.status(404).json({ error: 'Visit request not found or already approved.' });
        return res.json(result);
    });

    app.get('/api/owner/settings', requireAuth, requireRole('owner'), (req, res) => {
        const business = db.prepare(`
            SELECT id, name, points_per_visit AS pointsPerVisit, menu_url AS menuUrl,
                latitude, longitude, delivery_base_fee_paise AS deliveryBaseFeePaise,
                delivery_per_km_paise AS deliveryPerKmPaise
            FROM businesses WHERE id = ?
        `).get(req.user.business_id);
        return res.json({ business });
    });

    app.patch('/api/owner/settings', requireAuth, requireRole('owner'), (req, res) => {
        const { name, pointsPerVisit, menuUrl } = req.body ?? {};
        const currentBusiness = db.prepare('SELECT latitude, longitude FROM businesses WHERE id = ?')
            .get(req.user.business_id);
        const latitude = Object.hasOwn(req.body ?? {}, 'latitude') ? req.body.latitude : currentBusiness.latitude;
        const longitude = Object.hasOwn(req.body ?? {}, 'longitude') ? req.body.longitude : currentBusiness.longitude;
        let validMenuUrl = '';
        if (typeof menuUrl !== 'string' || menuUrl.length > 500) {
            return res.status(400).json({ error: 'Enter a valid menu URL.' });
        }
        if (menuUrl.trim()) {
            try {
                const url = new URL(menuUrl.trim());
                if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported protocol.');
                validMenuUrl = url.href;
            } catch {
                return res.status(400).json({ error: 'Menu link must be a valid http or https URL.' });
            }
        }
        if (typeof name !== 'string' || !name.trim() || name.trim().length > 120
            || !Number.isSafeInteger(pointsPerVisit) || pointsPerVisit < 1 || pointsPerVisit > 10000) {
            return res.status(400).json({ error: 'Enter a business name and points per visit between 1 and 10000.' });
        }
        const locationIsEmpty = (latitude === null || latitude === '') && (longitude === null || longitude === '');
        if (!locationIsEmpty && (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
            || typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
            return res.status(400).json({ error: 'Enter valid restaurant map coordinates, or leave both blank to disable delivery.' });
        }
        db.prepare(`
            UPDATE businesses SET name = ?, points_per_visit = ?, menu_url = ?, latitude = ?, longitude = ?
            WHERE id = ?
        `).run(name.trim(), pointsPerVisit, validMenuUrl,
            locationIsEmpty ? null : latitude, locationIsEmpty ? null : longitude, req.user.business_id);
        return res.json({
            business: db.prepare(`
                SELECT id, name, points_per_visit AS pointsPerVisit, menu_url AS menuUrl,
                    latitude, longitude, delivery_base_fee_paise AS deliveryBaseFeePaise,
                    delivery_per_km_paise AS deliveryPerKmPaise
                FROM businesses WHERE id = ?
            `).get(req.user.business_id)
        });
    });

    app.get('/api/owner/menu', requireAuth, requireRole('owner'), (req, res) => {
        const menuItems = db.prepare(`
            SELECT id, name, description, category, price_paise AS pricePaise, available,
                image_data AS imageData, dietary_type AS dietaryType, spice_level AS spiceLevel,
                allergens, variants_json AS variantsJson
            FROM menu_items WHERE business_id = ?
            ORDER BY category COLLATE NOCASE, name COLLATE NOCASE
        `).all(req.user.business_id).map(menuItemView);
        return res.json({ menuItems });
    });

    app.get('/api/owner/orders', requireAuth, requireRole('owner'), (req, res) => {
        const orders = db.prepare(`
            SELECT orders.id, orders.status, orders.payment_method, orders.payment_status, orders.fulfillment,
                orders.total_paise, orders.delivery_address, orders.delivery_distance_km,
                orders.delivery_fee_paise, orders.created_at, users.name AS customer_name,
                users.email AS customer_email, businesses.name AS business_name,
                delivery_partners.name AS delivery_partner_name
            FROM orders JOIN users ON users.id = orders.customer_id
            JOIN businesses ON businesses.id = orders.business_id
            LEFT JOIN delivery_partners ON delivery_partners.id = orders.delivery_partner_id
            WHERE orders.business_id = ?
                AND (orders.payment_method != 'razorpay' OR orders.payment_status = 'paid')
            ORDER BY orders.id DESC LIMIT 100
        `).all(req.user.business_id).map(order => orderView(db, order));
        return res.json({ orders });
    });

    app.patch('/api/owner/orders/:id', requireAuth, requireRole('owner'), async (req, res, next) => {
        const orderId = Number(req.params.id);
        const { status } = req.body ?? {};
        if (!Number.isSafeInteger(orderId) || orderId <= 0
            || !['accepted', 'rejected', 'preparing', 'ready'].includes(status)) {
            return res.status(400).json({ error: 'Choose a valid order status.' });
        }
        const currentOrder = db.prepare(`
            SELECT id, status, payment_method, payment_status, total_paise, razorpay_payment_id
            FROM orders WHERE id = ? AND business_id = ?
        `).get(orderId, req.user.business_id);
        if (!currentOrder) return res.status(404).json({ error: 'Order not found.' });
        const validTransition = (currentOrder.status === 'pending' && ['accepted', 'rejected'].includes(status))
            || (currentOrder.status === 'accepted' && status === 'preparing')
            || (currentOrder.status === 'preparing' && status === 'ready');
        if (!validTransition) return res.status(409).json({ error: 'This order cannot move to that status.' });
        if (status === 'rejected' && currentOrder.payment_method === 'razorpay'
            && currentOrder.payment_status === 'paid') {
            if (!razorpayEnabled || !currentOrder.razorpay_payment_id) {
                return res.status(503).json({ error: 'Razorpay refund is not available. The paid order has not been rejected.' });
            }
            const claimedRefund = db.prepare(`
                UPDATE orders SET payment_status = 'refund_pending', updated_at = datetime('now')
                WHERE id = ? AND business_id = ? AND status = 'pending' AND payment_status = 'paid'
            `).run(orderId, req.user.business_id);
            if (!claimedRefund.changes) return res.status(409).json({ error: 'This order is already being processed.' });
            try {
                const refundResponse = await razorpayFetch(
                    `https://api.razorpay.com/v1/payments/${currentOrder.razorpay_payment_id}/refund`,
                    {
                        method: 'POST',
                        headers: {
                            Authorization: `Basic ${Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString('base64')}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ amount: currentOrder.total_paise })
                    }
                );
                const refund = await refundResponse.json();
                if (!refundResponse.ok || typeof refund.id !== 'string'
                    || refund.payment_id !== currentOrder.razorpay_payment_id
                    || !['processed', 'pending'].includes(refund.status)) {
                    db.prepare(`
                        UPDATE orders SET payment_status = 'paid', updated_at = datetime('now')
                        WHERE id = ? AND business_id = ? AND status = 'pending' AND payment_status = 'refund_pending'
                    `).run(orderId, req.user.business_id);
                    return res.status(502).json({ error: 'Razorpay could not confirm the refund. The order remains open.' });
                }
                db.prepare(`
                    UPDATE orders SET status = 'rejected', payment_status = ?, razorpay_refund_id = ?,
                        updated_at = datetime('now')
                    WHERE id = ? AND business_id = ? AND status = 'pending' AND payment_status = 'refund_pending'
                `).run(refund.status === 'processed' ? 'refunded' : 'refund_pending', refund.id, orderId, req.user.business_id);
            } catch (error) {
                db.prepare(`
                    UPDATE orders SET payment_status = 'paid', updated_at = datetime('now')
                    WHERE id = ? AND business_id = ? AND status = 'pending' AND payment_status = 'refund_pending'
                `).run(orderId, req.user.business_id);
                return next(error);
            }
        } else {
            const result = db.prepare(`
                UPDATE orders SET status = ?, updated_at = datetime('now')
                WHERE id = ? AND business_id = ? AND status = ?
            `).run(status, orderId, req.user.business_id, currentOrder.status);
            if (!result.changes) return res.status(409).json({ error: 'This order has already been processed.' });
        }
        const order = db.prepare(`
            SELECT orders.id, orders.status, orders.payment_method, orders.payment_status, orders.fulfillment,
                orders.total_paise, orders.delivery_address, orders.delivery_distance_km,
                orders.delivery_fee_paise, orders.created_at, users.name AS customer_name,
                users.email AS customer_email, businesses.name AS business_name,
                delivery_partners.name AS delivery_partner_name
            FROM orders JOIN users ON users.id = orders.customer_id
            JOIN businesses ON businesses.id = orders.business_id
            LEFT JOIN delivery_partners ON delivery_partners.id = orders.delivery_partner_id
            WHERE orders.id = ? AND orders.business_id = ?
        `).get(orderId, req.user.business_id);
        return res.json({ order: orderView(db, order) });
    });

    app.get('/api/owner/delivery-partners', requireAuth, requireRole('owner'), (req, res) => {
        const partners = db.prepare(`
            SELECT id, name, email, active FROM delivery_partners
            WHERE business_id = ? ORDER BY name COLLATE NOCASE
        `).all(req.user.business_id).map(partner => ({ ...partner, active: Boolean(partner.active) }));
        return res.json({ partners });
    });

    app.post('/api/owner/delivery-partners/invites', requireAuth, requireRole('owner'), (req, res) => {
        const email = req.body?.email;
        if (typeof email !== 'string' || email.trim().length > 254
            || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            return res.status(400).json({ error: 'Enter a valid delivery partner email address.' });
        }
        const token = randomBytes(32).toString('base64url');
        const tokenHash = createHmac('sha256', secret).update(token).digest('hex');
        db.prepare(`
            INSERT INTO delivery_partner_invites (business_id, email, token_hash, expires_at)
            VALUES (?, ?, ?, datetime('now', '+7 days'))
        `).run(req.user.business_id, email.trim(), tokenHash);
        const inviteUrl = `${req.protocol}://${req.get('host')}/?partnerInvite=${encodeURIComponent(token)}`;
        return res.status(201).json({ inviteUrl, email: email.trim(), expiresInDays: 7 });
    });

    app.patch('/api/owner/delivery-partners/:id', requireAuth, requireRole('owner'), (req, res) => {
        const partnerId = Number(req.params.id);
        const { active } = req.body ?? {};
        if (!Number.isSafeInteger(partnerId) || partnerId <= 0 || typeof active !== 'boolean') {
            return res.status(400).json({ error: 'Choose a delivery partner and valid active status.' });
        }
        if (!active && db.prepare(`
            SELECT 1 FROM orders
            WHERE delivery_partner_id = ? AND business_id = ? AND status = 'out_for_delivery'
            LIMIT 1
        `).get(partnerId, req.user.business_id)) {
            return res.status(409).json({ error: 'This partner has an active delivery. Reassign or complete it before disabling the account.' });
        }
        const result = db.prepare(`
            UPDATE delivery_partners SET active = ?
            WHERE id = ? AND business_id = ?
        `).run(Number(active), partnerId, req.user.business_id);
        if (!result.changes) return res.status(404).json({ error: 'Delivery partner not found.' });
        return res.json({ success: true });
    });

    app.patch('/api/owner/orders/:id/dispatch', requireAuth, requireRole('owner'), (req, res) => {
        const orderId = Number(req.params.id);
        const partnerId = req.body?.partnerId;
        if (!Number.isSafeInteger(orderId) || orderId <= 0
            || !Number.isSafeInteger(partnerId) || partnerId <= 0) {
            return res.status(400).json({ error: 'Choose a valid order and delivery partner.' });
        }
        const result = db.prepare(`
            UPDATE orders SET delivery_partner_id = ?, status = 'out_for_delivery', updated_at = datetime('now')
            WHERE id = ? AND business_id = ? AND fulfillment = 'delivery' AND status = 'ready'
                AND EXISTS (
                    SELECT 1 FROM delivery_partners
                    WHERE id = ? AND business_id = orders.business_id AND active = 1
                )
        `).run(partnerId, orderId, req.user.business_id, partnerId);
        if (!result.changes) return res.status(409).json({ error: 'Order is not ready or partner is unavailable.' });
        return res.json({ success: true });
    });

    app.get('/api/delivery-partner/orders', requireAuth, requireRole('delivery_partner'), (req, res) => {
        const orders = db.prepare(`
            SELECT orders.id, orders.status, orders.payment_method, orders.payment_status,
                orders.fulfillment, orders.total_paise, orders.delivery_address,
                orders.delivery_distance_km, orders.delivery_fee_paise, orders.created_at,
                users.name AS customer_name,
                businesses.name AS business_name, delivery_partners.name AS delivery_partner_name
            FROM orders JOIN users ON users.id = orders.customer_id
            JOIN businesses ON businesses.id = orders.business_id
            JOIN delivery_partners ON delivery_partners.id = orders.delivery_partner_id
            WHERE orders.delivery_partner_id = ? AND delivery_partners.active = 1
            ORDER BY orders.id DESC LIMIT 100
        `).all(req.user.id).map(order => orderView(db, order));
        return res.json({ orders });
    });

    app.patch('/api/delivery-partner/orders/:id', requireAuth, requireRole('delivery_partner'), (req, res) => {
        const orderId = Number(req.params.id);
        if (!Number.isSafeInteger(orderId) || orderId <= 0) {
            return res.status(400).json({ error: 'Choose a valid delivery order.' });
        }
        const result = db.prepare(`
            UPDATE orders SET status = 'delivered', updated_at = datetime('now')
            WHERE id = ? AND delivery_partner_id = ? AND status = 'out_for_delivery'
                AND EXISTS (SELECT 1 FROM delivery_partners WHERE id = ? AND active = 1)
        `).run(orderId, req.user.id, req.user.id);
        if (!result.changes) return res.status(409).json({ error: 'This order cannot be marked delivered.' });
        return res.json({ success: true });
    });

    app.post('/api/owner/menu', requireAuth, requireRole('owner'), (req, res) => {
        const {
            name, description = '', category = 'Main', price,
            imageData = '', dietaryType = '', spiceLevel = '', allergens = '', variants = []
        } = req.body ?? {};
        const validImage = validMenuImage(imageData);
        const validDietaryType = ['', 'vegetarian', 'non-vegetarian', 'vegan'].includes(dietaryType);
        const validSpiceLevel = ['', 'mild', 'medium', 'hot'].includes(spiceLevel);
        const hasVariants = Array.isArray(variants) && variants.length > 0;
        const validVariants = Array.isArray(variants) && variants.length <= 10
            && variants.every(variant => variant && typeof variant.name === 'string'
                && variant.name.trim().length > 0 && variant.name.trim().length <= 30
                && typeof variant.price === 'number' && Number.isFinite(variant.price)
                && variant.price > 0 && variant.price <= 100000
                && Number.isSafeInteger(Math.round(variant.price * 100)))
            && new Set(variants.map(variant => variant.name.trim().toLowerCase())).size === variants.length;
        const priceValid = hasVariants
            ? validVariants
            : typeof price === 'number' && Number.isFinite(price) && price > 0 && price <= 100000
                && Number.isSafeInteger(Math.round(price * 100));
        if (typeof name !== 'string' || !name.trim() || name.trim().length > 100
            || typeof description !== 'string' || description.trim().length > 300
            || typeof category !== 'string' || !category.trim() || category.trim().length > 60
            || !validImage || !validDietaryType || !validSpiceLevel
            || typeof allergens !== 'string' || allergens.trim().length > 300
            || !validVariants || !priceValid) {
            return res.status(400).json({ error: 'Enter valid dish details, image, dietary and spice options, allergens, and prices.' });
        }
        const normalizedVariants = (Array.isArray(variants) ? variants : []).map(variant => ({
            name: variant.name.trim(),
            pricePaise: Math.round(variant.price * 100)
        }));
        const pricePaise = normalizedVariants.length
            ? normalizedVariants[0].pricePaise
            : Math.round(price * 100);
        const result = db.prepare(`
            INSERT INTO menu_items (
                business_id, name, description, category, price_paise, image_data,
                dietary_type, spice_level, allergens, variants_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            req.user.business_id, name.trim(), description.trim(), category.trim(), pricePaise,
            imageData, dietaryType, spiceLevel, allergens.trim(), JSON.stringify(normalizedVariants)
        );
        const item = db.prepare(`
            SELECT id, name, description, category, price_paise AS pricePaise, available,
                image_data AS imageData, dietary_type AS dietaryType, spice_level AS spiceLevel,
                allergens, variants_json AS variantsJson
            FROM menu_items WHERE id = ? AND business_id = ?
        `).get(result.lastInsertRowid, req.user.business_id);
        return res.status(201).json({ menuItem: menuItemView(item) });
    });

    app.patch('/api/owner/menu/:id', requireAuth, requireRole('owner'), (req, res) => {
        const itemId = Number(req.params.id);
        const { available } = req.body ?? {};
        if (!Number.isSafeInteger(itemId) || itemId <= 0 || typeof available !== 'boolean') {
            return res.status(400).json({ error: 'Choose a valid menu item and availability setting.' });
        }
        const result = db.prepare(`
            UPDATE menu_items SET available = ?
            WHERE id = ? AND business_id = ?
        `).run(available ? 1 : 0, itemId, req.user.business_id);
        if (!result.changes) return res.status(404).json({ error: 'Menu item not found.' });
        return res.json({ menuItem: menuItemView(db.prepare(`
            SELECT id, name, description, category, price_paise AS pricePaise, available,
                image_data AS imageData, dietary_type AS dietaryType, spice_level AS spiceLevel,
                allergens, variants_json AS variantsJson
            FROM menu_items WHERE id = ? AND business_id = ?
        `).get(itemId, req.user.business_id)) });
    });

    app.delete('/api/owner/menu/:id', requireAuth, requireRole('owner'), (req, res) => {
        const itemId = Number(req.params.id);
        if (!Number.isSafeInteger(itemId) || itemId <= 0) {
            return res.status(400).json({ error: 'Choose a valid menu item.' });
        }
        const result = db.prepare('DELETE FROM menu_items WHERE id = ? AND business_id = ?')
            .run(itemId, req.user.business_id);
        if (!result.changes) return res.status(404).json({ error: 'Menu item not found.' });
        return res.status(204).end();
    });

    app.get('/api/owner/rewards', requireAuth, requireRole('owner'), (req, res) => {
        const rewards = db.prepare(`
            SELECT rewards.*, COUNT(point_transactions.id) AS claimed
            FROM rewards LEFT JOIN point_transactions
                ON point_transactions.reward_id = rewards.id AND point_transactions.type = 'redeem'
            WHERE rewards.business_id = ? GROUP BY rewards.id ORDER BY rewards.id
        `).all(req.user.business_id).map(rewardView);
        return res.json({ rewards });
    });

    app.post('/api/owner/rewards', requireAuth, requireRole('owner'), (req, res, next) => {
        const { name, pts, icon = '🎁' } = req.body ?? {};
        if (typeof name !== 'string' || !name.trim() || name.trim().length > 100
            || !Number.isSafeInteger(pts) || pts <= 0 || pts > 100000
            || typeof icon !== 'string' || icon.length > 8) {
            return res.status(400).json({ error: 'Enter a reward name and a points value between 1 and 100000.' });
        }
        try {
            const result = db.prepare(`
                INSERT INTO rewards (business_id, name, points_required, icon, active)
                VALUES (?, ?, ?, ?, 1)
            `).run(req.user.business_id, name.trim(), pts, icon);
            const reward = db.prepare('SELECT * FROM rewards WHERE id = ?').get(result.lastInsertRowid);
            return res.status(201).json({ reward: rewardView(reward) });
        } catch (error) {
            return next(error);
        }
    });

    app.patch('/api/owner/rewards/:id', requireAuth, requireRole('owner'), (req, res) => {
        const rewardId = Number(req.params.id);
        const { on } = req.body ?? {};
        if (!Number.isSafeInteger(rewardId) || rewardId <= 0 || typeof on !== 'boolean') {
            return res.status(400).json({ error: 'Invalid reward update.' });
        }
        const result = db.prepare(`
            UPDATE rewards SET active = ?
            WHERE id = ? AND business_id = ?
        `).run(on ? 1 : 0, rewardId, req.user.business_id);
        if (!result.changes) return res.status(404).json({ error: 'Reward not found.' });
        const reward = db.prepare('SELECT * FROM rewards WHERE id = ?').get(rewardId);
        return res.json({ reward: rewardView(reward) });
    });

    app.use((error, _req, res, _next) => {
        console.error('API request failed:', error);
        if (res.headersSent) return;
        return res.status(error.status || 500).json({
            error: error.status ? error.message : 'Something went wrong. Please try again.'
        });
    });

    return app;
}
