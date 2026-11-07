import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import { createApp } from './app.js';
import { createDatabase } from './database.js';

const db = createDatabase(':memory:');
const defaultBusinessId = db.prepare('SELECT id FROM businesses ORDER BY id LIMIT 1').get().id;
const server = createApp(db, { jwtSecret: 'test-secret' }).listen(0);
let baseUrl;

before(async () => {
    await new Promise(resolve => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close();
});

function client() {
    let cookie = '';
    return async (path, options = {}) => {
        const response = await fetch(`${baseUrl}${path}`, {
            ...options,
            headers: {
                ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                ...(cookie ? { Cookie: cookie } : {}),
                ...options.headers
            }
        });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';', 1)[0];
        return response;
    };
}

test('customers can create an email account for a selected restaurant without a QR link, then sign in', async () => {
    const customer = client();
    const businesses = await customer('/api/businesses');
    assert.ok((await businesses.json()).businesses.some(business => business.id === defaultBusinessId));
    const missingBusiness = await customer('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name: 'No Business', email: 'no-business@example.com', password: 'secure-pass-123' })
    });
    assert.equal(missingBusiness.status, 400);
    const registration = await customer('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Test Customer',
            email: 'customer@example.com',
            password: 'secure-pass-123',
            businessId: defaultBusinessId
        })
    });
    assert.equal(registration.status, 201);
    const storedHash = db.prepare("SELECT password_hash FROM users WHERE email = 'customer@example.com'").get().password_hash;
    assert.equal(bcrypt.getRounds(storedHash), 10);

    const dashboard = await customer('/api/customer/dashboard');
    assert.equal(dashboard.status, 200);
    const data = await dashboard.json();
    assert.equal(data.points, 10);
    assert.equal(data.transactions[0].title, 'Welcome bonus');
    assert.equal(data.rewards.length, 2);

    const signedOut = await customer('/api/auth/logout', { method: 'POST' });
    assert.equal(signedOut.status, 204);
    const signedOutSession = await customer('/api/auth/me');
    assert.equal(signedOutSession.status, 401);
    const login = await customer('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'customer@example.com', password: 'secure-pass-123', role: 'customer' })
    });
    assert.equal(login.status, 200);
});

test('referral links award 20 points to both customers after a referred signup', async () => {
    const businessId = db.prepare('SELECT id FROM businesses ORDER BY id LIMIT 1').get().id;
    const referrer = client();
    const referrerRegistration = await referrer('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Referring Customer',
            email: 'referrer@example.com',
            password: 'secure-pass-123',
            businessId
        })
    });
    assert.equal(referrerRegistration.status, 201);
    const referrerData = await referrerRegistration.json();
    assert.match(referrerData.user.referralCode, /^[a-f0-9]{16}$/);

    const invalidCode = await client()('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Invalid Invite',
            email: 'invalid-invite@example.com',
            password: 'secure-pass-123',
            businessId,
            referralCode: 'not-a-real-code'
        })
    });
    assert.equal(invalidCode.status, 400);
    const otherBusinessId = Number(db.prepare('INSERT INTO businesses (name) VALUES (?)').run('Other Referral Cafe').lastInsertRowid);
    const crossBusinessCode = await client()('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Cross-business Invite',
            email: 'cross-business-invite@example.com',
            password: 'secure-pass-123',
            businessId: otherBusinessId,
            referralCode: referrerData.user.referralCode
        })
    });
    assert.equal(crossBusinessCode.status, 400);
    db.prepare('DELETE FROM businesses WHERE id = ?').run(otherBusinessId);

    const referred = client();
    const referredRegistration = await referred('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Referred Customer',
            email: 'referred@example.com',
            password: 'secure-pass-123',
            businessId,
            referralCode: referrerData.user.referralCode
        })
    });
    assert.equal(referredRegistration.status, 201);
    assert.equal((await referredRegistration.json()).user.points, 30);

    const referrerDashboard = await referrer('/api/customer/dashboard');
    const referrerDataDashboard = await referrerDashboard.json();
    assert.equal(referrerDataDashboard.points, 30);
    assert.equal(referrerDataDashboard.referrals, 1);
    assert.equal(referrerDataDashboard.transactions[0].title, 'Friend referral bonus');
    const referredDashboard = await referred('/api/customer/dashboard');
    const referredData = await referredDashboard.json();
    assert.equal(referredData.points, 30);
    assert.equal(referredData.user.referredById, referrerData.user.id);
    assert.equal(referredData.transactions[0].title, 'Friend referral bonus');
    assert.equal(referredData.transactions[1].title, 'Welcome bonus');
});

test('successful sign-in upgrades existing password hashes to the current work factor', async () => {
    const email = 'legacy@example.com';
    const password = 'legacy-pass-123';
    const businessId = db.prepare('SELECT id FROM businesses ORDER BY id LIMIT 1').get().id;
    const passwordHash = await bcrypt.hash(password, 12);
    db.prepare(`
        INSERT INTO users (business_id, name, email, password_hash, role)
        VALUES (?, 'Legacy User', ?, ?, 'customer')
    `).run(businessId, email, passwordHash);

    const response = await client()('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, role: 'customer' })
    });

    assert.equal(response.status, 200);
    const upgradedHash = db.prepare('SELECT password_hash FROM users WHERE email = ?').get(email).password_hash;
    assert.equal(bcrypt.getRounds(upgradedHash), 10);
});

test('owner can manage rewards and dashboard data while customers cannot', async () => {
    const owner = client();
    const registration = await owner('/api/auth/register-owner', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Test Owner',
            businessName: 'Test Cafe',
            email: 'owner@example.com',
            password: 'secure-pass-123'
        })
    });
    assert.equal(registration.status, 201);
    const ownerData = await registration.json();
    const businessDirectory = await owner('/api/businesses');
    assert.ok((await businessDirectory.json()).businesses.some(business => business.id === ownerData.user.businessId));

    const createReward = await owner('/api/owner/rewards', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test reward', pts: 50 })
    });
    assert.equal(createReward.status, 201);
    const created = (await createReward.json()).reward;

    const updateReward = await owner(`/api/owner/rewards/${created.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ on: false })
    });
    assert.equal((await updateReward.json()).reward.on, false);

    const customer = client();
    const customerRegistration = await customer('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Another Customer',
            email: 'another@example.com',
            password: 'secure-pass-123',
            businessId: ownerData.user.businessId
        })
    });
    assert.equal(customerRegistration.status, 201);
    const registeredCustomer = await customerRegistration.json();
    assert.equal(registeredCustomer.user.businessId, ownerData.user.businessId);
    const checkIn = await customer('/api/customer/check-ins', {
        method: 'POST',
        body: JSON.stringify({ businessId: ownerData.user.businessId })
    });
    assert.equal(checkIn.status, 201);
    const { checkInId } = await checkIn.json();
    const approval = await owner(`/api/owner/check-ins/${checkInId}/approve`, { method: 'POST' });
    assert.equal(approval.status, 200);
    const dashboard = await owner('/api/owner/dashboard');
    assert.equal(dashboard.status, 200);
    const dashboardData = await dashboard.json();
    assert.equal(dashboardData.stats.customers, 1);
    assert.equal(dashboardData.stats.newCustomers, 1);
    assert.equal(dashboardData.stats.returningCustomers, 0);
    assert.equal(dashboardData.weeklyVisits.length, 7);
    assert.equal(dashboardData.weeklyVisits.reduce((total, visit) => total + visit.total, 0), 1);
    assert.equal(dashboardData.topCustomers[0].visits, 1);
    const ownerCustomers = await owner('/api/owner/customers');
    assert.equal((await ownerCustomers.json()).customers[0].email, 'another@example.com');
    const forbidden = await customer('/api/owner/dashboard');
    assert.equal(forbidden.status, 403);
});

test('restaurant search only returns businesses with a registered owner', async () => {
    const owner = client();
    const registration = await owner('/api/auth/register-owner', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Search Owner',
            businessName: 'Searchable Bistro',
            email: 'search-owner@example.com',
            password: 'secure-pass-123'
        })
    });
    assert.equal(registration.status, 201);
    const ownerBusiness = (await registration.json()).user.businessId;
    db.prepare('INSERT INTO businesses (name) VALUES (?)').run('Unclaimed Bistro');

    const search = await client()('/api/businesses?search=bistro');
    assert.equal(search.status, 200);
    assert.deepEqual((await search.json()).businesses, [{ id: ownerBusiness, name: 'Searchable Bistro' }]);

    const wildcardSearch = await client()('/api/businesses?search=%25');
    assert.deepEqual((await wildcardSearch.json()).businesses, []);
    const tooLongSearch = await client()(`/api/businesses?search=${'a'.repeat(101)}`);
    assert.equal(tooLongSearch.status, 400);
});

test('restaurant owners manage menu items and customers only see available dishes', async () => {
    const owner = client();
    const ownerRegistration = await owner('/api/auth/register-owner', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Menu Owner',
            businessName: 'Menu Cafe',
            email: 'menu-owner@example.com',
            password: 'secure-pass-123'
        })
    });
    const { user } = await ownerRegistration.json();
    const customer = client();
    const customerRegistration = await customer('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Menu Customer',
            email: 'menu-customer@example.com',
            password: 'secure-pass-123',
            businessId: user.businessId
        })
    });
    assert.equal(customerRegistration.status, 201);

    const invalidItem = await owner('/api/owner/menu', {
        method: 'POST',
        body: JSON.stringify({ name: 'Invalid price dish', category: 'Main', price: 0 })
    });
    assert.equal(invalidItem.status, 400);

    const created = await owner('/api/owner/menu', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Paneer Tikka',
            category: 'Starters',
            description: 'Smoky grilled paneer',
            price: 249.5,
            imageData: 'data:image/png;base64,iVBORw0KGgo=',
            dietaryType: 'vegetarian',
            spiceLevel: 'medium',
            allergens: 'dairy',
            variants: [
                { name: 'Regular', price: 249.5 },
                { name: 'Large', price: 349 }
            ]
        })
    });
    assert.equal(created.status, 201);
    const menuItem = (await created.json()).menuItem;
    assert.equal(menuItem.pricePaise, 24950);
    assert.equal(menuItem.available, true);
    assert.equal(menuItem.dietaryType, 'vegetarian');
    assert.equal(menuItem.spiceLevel, 'medium');
    assert.equal(menuItem.allergens, 'dairy');
    assert.equal(menuItem.imageData, 'data:image/png;base64,iVBORw0KGgo=');
    assert.deepEqual(menuItem.variants, [
        { name: 'Regular', pricePaise: 24950 },
        { name: 'Large', pricePaise: 34900 }
    ]);

    let customerMenu = await customer('/api/customer/dashboard');
    const customerMenuItems = (await customerMenu.json()).menuItems;
    assert.equal(customerMenuItems[0].name, 'Paneer Tikka');
    assert.equal(customerMenuItems[0].allergens, 'dairy');
    assert.equal(customerMenuItems[0].variants[1].pricePaise, 34900);

    const hidden = await owner(`/api/owner/menu/${menuItem.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ available: false })
    });
    const hiddenItem = (await hidden.json()).menuItem;
    assert.equal(hiddenItem.available, false);
    assert.equal(hiddenItem.variants.length, 2);
    customerMenu = await customer('/api/customer/dashboard');
    assert.equal((await customerMenu.json()).menuItems.length, 0);

    const menu = await owner('/api/owner/menu');
    assert.equal((await menu.json()).menuItems[0].available, false);
    const otherOwner = client();
    await otherOwner('/api/auth/register-owner', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Other Menu Owner',
            businessName: 'Other Menu Cafe',
            email: 'other-menu-owner@example.com',
            password: 'secure-pass-123'
        })
    });
    const forbiddenUpdate = await otherOwner(`/api/owner/menu/${menuItem.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ available: true })
    });
    assert.equal(forbiddenUpdate.status, 404);

    const deleted = await owner(`/api/owner/menu/${menuItem.id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 204);
    assert.equal((await owner('/api/owner/menu').then(response => response.json())).menuItems.length, 0);
});

test('customers place COD pickup orders and only their restaurant owner can accept them', async () => {
    const owner = client();
    const registration = await owner('/api/auth/register-owner', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Order Owner',
            businessName: 'Order Cafe',
            email: 'order-owner@example.com',
            password: 'secure-pass-123'
        })
    });
    const { user } = await registration.json();
    const customer = client();
    await customer('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Order Customer',
            email: 'order-customer@example.com',
            password: 'secure-pass-123',
            businessId: user.businessId
        })
    });
    assert.deepEqual(await customer('/api/customer/payment-config').then(response => response.json()), {
        enabled: false,
        keyId: ''
    });
    const disabledOnlinePayment = await customer('/api/customer/orders', {
        method: 'POST',
        body: JSON.stringify({ paymentMethod: 'razorpay', items: [{ menuItemId: 1, quantity: 1 }] })
    });
    assert.equal(disabledOnlinePayment.status, 503);
    const menuResponse = await owner('/api/owner/menu', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Masala Dosa',
            category: 'Main',
            price: 150,
            variants: [{ name: 'Regular', price: 150 }, { name: 'Large', price: 180 }]
        })
    });
    const menuItem = (await menuResponse.json()).menuItem;
    const invalidOrder = await customer('/api/customer/orders', {
        method: 'POST',
        body: JSON.stringify({ items: [{ menuItemId: menuItem.id, variantName: 'Large', quantity: 21 }] })
    });
    assert.equal(invalidOrder.status, 400);

    const placed = await customer('/api/customer/orders', {
        method: 'POST',
        body: JSON.stringify({
            items: [{ menuItemId: menuItem.id, variantName: 'Large', quantity: 2, unitPricePaise: 1 }]
        })
    });
    assert.equal(placed.status, 201);
    const order = (await placed.json()).order;
    assert.equal(order.status, 'pending');
    assert.equal(order.paymentMethod, 'cash_on_pickup');
    assert.equal(order.fulfillment, 'pickup');
    assert.equal(order.totalPaise, 36000);
    assert.deepEqual(order.items, [
        { name: 'Masala Dosa', variantName: 'Large', quantity: 2, unitPricePaise: 18000 }
    ]);

    const ownerOrders = await owner('/api/owner/orders');
    assert.equal((await ownerOrders.json()).orders[0].customerEmail, 'order-customer@example.com');
    assert.equal((await customer('/api/owner/orders')).status, 403);
    const accepted = await owner(`/api/owner/orders/${order.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'accepted' })
    });
    assert.equal((await accepted.json()).order.status, 'accepted');
    assert.equal((await customer('/api/customer/orders').then(response => response.json())).orders[0].status, 'accepted');
    const acceptedAgain = await owner(`/api/owner/orders/${order.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'rejected' })
    });
    assert.equal(acceptedAgain.status, 409);

    const secondOrderResponse = await customer('/api/customer/orders', {
        method: 'POST',
        body: JSON.stringify({ items: [{ menuItemId: menuItem.id, variantName: 'Regular', quantity: 1 }] })
    });
    const secondOrder = (await secondOrderResponse.json()).order;
    const rejected = await owner(`/api/owner/orders/${secondOrder.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'rejected' })
    });
    assert.equal((await rejected.json()).order.status, 'rejected');

    const otherOwner = client();
    await otherOwner('/api/auth/register-owner', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Different Order Owner',
            businessName: 'Different Cafe',
            email: 'different-order-owner@example.com',
            password: 'secure-pass-123'
        })
    });
    assert.equal((await otherOwner('/api/owner/orders').then(response => response.json())).orders.length, 0);
    const crossBusinessUpdate = await otherOwner(`/api/owner/orders/${order.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'rejected' })
    });
    assert.equal(crossBusinessUpdate.status, 404);

    const unavailable = await owner(`/api/owner/menu/${menuItem.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ available: false })
    });
    assert.equal(unavailable.status, 200);
    const unavailableOrder = await customer('/api/customer/orders', {
        method: 'POST',
        body: JSON.stringify({ items: [{ menuItemId: menuItem.id, variantName: 'Large', quantity: 1 }] })
    });
    assert.equal(unavailableOrder.status, 409);
});

test('customers order from another restaurant with distance fees and owner-invited delivery partners', async () => {
    const owner = client();
    const ownerRegistration = await owner('/api/auth/register-owner', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Marketplace Owner',
            businessName: 'Marketplace Kitchen',
            email: 'marketplace-owner@example.com',
            password: 'secure-pass-123'
        })
    });
    const { user: restaurantOwner } = await ownerRegistration.json();
    const settings = await owner('/api/owner/settings');
    const currentSettings = (await settings.json()).business;
    const savedSettings = await owner('/api/owner/settings', {
        method: 'PATCH',
        body: JSON.stringify({
            name: currentSettings.name,
            pointsPerVisit: currentSettings.pointsPerVisit,
            menuUrl: currentSettings.menuUrl,
            latitude: 12,
            longitude: 77
        })
    });
    assert.equal(savedSettings.status, 200);

    const createdMenuItem = await owner('/api/owner/menu', {
        method: 'POST',
        body: JSON.stringify({ name: 'Delivery Bowl', category: 'Meals', price: 150 })
    });
    assert.equal(createdMenuItem.status, 201);
    const menuItem = (await createdMenuItem.json()).menuItem;
    const publicMenu = await client()(`/api/businesses/${restaurantOwner.businessId}/menu`);
    assert.equal(publicMenu.status, 200);
    assert.equal((await publicMenu.json()).menuItems[0].name, 'Delivery Bowl');

    const customer = client();
    await customer('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Marketplace Customer',
            email: 'marketplace-customer@example.com',
            password: 'secure-pass-123',
            businessId: defaultBusinessId
        })
    });
    const nearbyOrder = await customer('/api/customer/orders', {
        method: 'POST',
        body: JSON.stringify({
            businessId: restaurantOwner.businessId,
            fulfillment: 'delivery',
            paymentMethod: 'cash_on_delivery',
            deliveryAddress: '11 Nearby Road, Bengaluru',
            deliveryLatitude: 12.02,
            deliveryLongitude: 77,
            items: [{ menuItemId: menuItem.id, quantity: 1 }]
        })
    });
    assert.equal((await nearbyOrder.json()).order.deliveryFeePaise, 0);
    const orderResponse = await customer('/api/customer/orders', {
        method: 'POST',
        body: JSON.stringify({
            businessId: restaurantOwner.businessId,
            fulfillment: 'delivery',
            paymentMethod: 'cash_on_delivery',
            deliveryAddress: '10 Example Street, Bengaluru',
            deliveryLatitude: 12.06,
            deliveryLongitude: 77,
            items: [{ menuItemId: menuItem.id, quantity: 1 }]
        })
    });
    assert.equal(orderResponse.status, 201);
    const order = (await orderResponse.json()).order;
    assert.ok(order.deliveryFeePaise > 2000);
    assert.equal(order.totalPaise, 15000 + order.deliveryFeePaise);
    assert.equal(order.fulfillment, 'delivery');

    const inviteResponse = await owner('/api/owner/delivery-partners/invites', {
        method: 'POST',
        body: JSON.stringify({ email: 'rider@example.com' })
    });
    assert.equal(inviteResponse.status, 201);
    const inviteUrl = (await inviteResponse.json()).inviteUrl;
    const inviteToken = new URL(inviteUrl).searchParams.get('partnerInvite');
    const partner = client();
    const partnerRegistration = await partner('/api/delivery-partner/register', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Local Rider',
            email: 'rider@example.com',
            password: 'secure-pass-123',
            inviteToken
        })
    });
    assert.equal(partnerRegistration.status, 201);
    assert.equal((await customer('/api/delivery-partner/orders')).status, 403);

    for (const status of ['accepted', 'preparing', 'ready']) {
        const transition = await owner(`/api/owner/orders/${order.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status })
        });
        assert.equal(transition.status, 200);
    }
    const partners = await owner('/api/owner/delivery-partners');
    const partnerId = (await partners.json()).partners[0].id;
    const dispatch = await owner(`/api/owner/orders/${order.id}/dispatch`, {
        method: 'PATCH',
        body: JSON.stringify({ partnerId })
    });
    assert.equal(dispatch.status, 200);
    const assignedOrders = await partner('/api/delivery-partner/orders');
    assert.equal((await assignedOrders.json()).orders[0].id, order.id);
    const delivered = await partner(`/api/delivery-partner/orders/${order.id}`, { method: 'PATCH' });
    assert.equal(delivered.status, 200);
    const customerOrders = await customer('/api/customer/orders');
    assert.equal((await customerOrders.json()).orders[0].status, 'delivered');
});

test('Razorpay orders are server-priced, signature-verified, captured, and exposed to owners only after payment', async () => {
    const paymentDb = createDatabase(':memory:');
    let paymentStatus = 'authorized';
    const gatewayCalls = [];
    const paymentApp = createApp(paymentDb, {
        jwtSecret: 'razorpay-test-secret',
        razorpayKeyId: 'rzp_test_public',
        razorpayKeySecret: 'razorpay-test-private',
        razorpayFetch: async (url, options = {}) => {
            gatewayCalls.push({ url, options });
            let result;
            if (url.endsWith('/v1/orders')) {
                result = { id: 'order_test_123', amount: 12500, currency: 'INR' };
            } else if (url.endsWith('/v1/payments/pay_test123/capture')) {
                paymentStatus = 'captured';
                result = { id: 'pay_test123', order_id: 'order_test_123', amount: 12500, currency: 'INR', status: paymentStatus };
            } else if (url.endsWith('/v1/payments/pay_test123')) {
                result = { id: 'pay_test123', order_id: 'order_test_123', amount: 12500, currency: 'INR', status: paymentStatus };
            } else if (url.endsWith('/v1/payments/pay_test123/refund')) {
                result = { id: 'rfnd_test123', payment_id: 'pay_test123', status: 'processed' };
            } else {
                throw new Error(`Unexpected Razorpay request: ${url}`);
            }
            return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
    }).listen(0);
    await new Promise(resolve => paymentApp.once('listening', resolve));
    const paymentBaseUrl = `http://127.0.0.1:${paymentApp.address().port}`;
    const makeClient = () => {
        let cookie = '';
        return async (path, options = {}) => {
            const response = await fetch(`${paymentBaseUrl}${path}`, {
                ...options,
                headers: {
                    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                    ...(cookie ? { Cookie: cookie } : {}),
                    ...options.headers
                }
            });
            const setCookie = response.headers.get('set-cookie');
            if (setCookie) cookie = setCookie.split(';', 1)[0];
            return response;
        };
    };

    try {
        const owner = makeClient();
        const registration = await owner('/api/auth/register-owner', {
            method: 'POST',
            body: JSON.stringify({
                name: 'Razorpay Owner', businessName: 'Payments Cafe',
                email: 'razorpay-owner@example.com', password: 'secure-pass-123'
            })
        });
        const { user } = await registration.json();
        const customer = makeClient();
        await customer('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({
                name: 'Razorpay Customer', email: 'razorpay-customer@example.com',
                password: 'secure-pass-123', businessId: user.businessId
            })
        });
        const itemResponse = await owner('/api/owner/menu', {
            method: 'POST',
            body: JSON.stringify({ name: 'Thali', category: 'Meals', price: 125 })
        });
        const item = (await itemResponse.json()).menuItem;
        const orderResponse = await customer('/api/customer/orders', {
            method: 'POST',
            body: JSON.stringify({
                paymentMethod: 'razorpay',
                items: [{ menuItemId: item.id, quantity: 1, unitPricePaise: 1 }]
            })
        });
        assert.equal(orderResponse.status, 201);
        const order = (await orderResponse.json()).order;
        assert.equal(order.paymentStatus, 'pending');
        assert.equal(order.totalPaise, 12500);
        assert.equal((await owner('/api/owner/orders').then(response => response.json())).orders.length, 0);

        const intentResponse = await customer(`/api/customer/orders/${order.id}/payment-intent`, { method: 'POST' });
        assert.equal(intentResponse.status, 200);
        const intent = await intentResponse.json();
        assert.equal(intent.keyId, 'rzp_test_public');
        assert.equal(intent.amount, 12500);
        assert.equal(intent.razorpayOrderId, 'order_test_123');
        assert.match(gatewayCalls[0].options.headers.Authorization, /^Basic /);

        const signature = createHmac('sha256', 'razorpay-test-private')
            .update('order_test_123|pay_test123').digest('hex');
        const invalidSignature = await customer(`/api/customer/orders/${order.id}/verify-payment`, {
            method: 'POST',
            body: JSON.stringify({
                razorpay_order_id: 'order_test_123',
                razorpay_payment_id: 'pay_test123',
                razorpay_signature: '0'.repeat(64)
            })
        });
        assert.equal(invalidSignature.status, 400);
        const verified = await customer(`/api/customer/orders/${order.id}/verify-payment`, {
            method: 'POST',
            body: JSON.stringify({
                razorpay_order_id: 'order_test_123',
                razorpay_payment_id: 'pay_test123',
                razorpay_signature: signature
            })
        });
        assert.equal(verified.status, 200);
        assert.equal((await verified.json()).order.paymentStatus, 'paid');
        assert.equal(paymentStatus, 'captured');
        assert.equal((await owner('/api/owner/orders').then(response => response.json())).orders.length, 1);
        assert.equal(gatewayCalls.filter(call => call.url.endsWith('/capture')).length, 1);
        const rejectedOrder = await owner(`/api/owner/orders/${order.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'rejected' })
        });
        assert.equal(rejectedOrder.status, 200);
        assert.equal((await rejectedOrder.json()).order.paymentStatus, 'refunded');
        assert.equal((await customer('/api/customer/orders').then(response => response.json())).orders[0].status, 'rejected');
        assert.equal((await owner('/api/owner/orders').then(response => response.json())).orders.length, 0);
    } finally {
        await new Promise((resolve, reject) => paymentApp.close(error => error ? reject(error) : resolve()));
        paymentDb.close();
    }
});

test('database migration preserves existing pickup orders while enabling Razorpay', () => {
    const directory = mkdtempSync(join(tmpdir(), 'repeato-orders-'));
    const filename = join(directory, 'legacy-orders.sqlite');
    const legacy = new Database(filename);
    legacy.exec(`
        CREATE TABLE businesses (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
        CREATE TABLE users (
            id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL REFERENCES businesses(id),
            name TEXT NOT NULL, email TEXT NOT NULL, password_hash TEXT NOT NULL,
            role TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')),
            UNIQUE (business_id, email)
        );
        CREATE TABLE menu_items (
            id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL REFERENCES businesses(id),
            name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'Main',
            price_paise INTEGER NOT NULL, available INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE orders (
            id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
            customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
            payment_method TEXT NOT NULL DEFAULT 'cash_on_pickup' CHECK (payment_method = 'cash_on_pickup'),
            fulfillment TEXT NOT NULL DEFAULT 'pickup' CHECK (fulfillment = 'pickup'),
            total_paise INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE order_items (
            id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            menu_item_id INTEGER REFERENCES menu_items(id) ON DELETE SET NULL, item_name TEXT NOT NULL,
            variant_name TEXT NOT NULL DEFAULT '', quantity INTEGER NOT NULL, unit_price_paise INTEGER NOT NULL
        );
        INSERT INTO businesses (id, name) VALUES (1, 'Legacy Cafe');
        INSERT INTO users (id, business_id, name, email, password_hash, role) VALUES
            (1, 1, 'Legacy Owner', 'legacy-owner@example.com', 'hash', 'owner'),
            (2, 1, 'Legacy Customer', 'legacy-customer@example.com', 'hash', 'customer');
        INSERT INTO menu_items (id, business_id, name, price_paise) VALUES (1, 1, 'Legacy Dish', 10000);
        INSERT INTO orders (id, business_id, customer_id, total_paise) VALUES (1, 1, 2, 10000);
        INSERT INTO order_items (id, order_id, menu_item_id, item_name, quantity, unit_price_paise)
        VALUES (1, 1, 1, 'Legacy Dish', 1, 10000);
    `);
    legacy.close();
    try {
        const migrated = createDatabase(filename);
        const order = migrated.prepare('SELECT payment_method, payment_status, total_paise FROM orders WHERE id = 1').get();
        assert.deepEqual(order, { payment_method: 'cash_on_pickup', payment_status: 'cash_due', total_paise: 10000 });
        assert.equal(migrated.prepare('SELECT item_name FROM order_items WHERE order_id = 1').get().item_name, 'Legacy Dish');
        migrated.prepare("UPDATE orders SET payment_method = 'razorpay', payment_status = 'pending' WHERE id = 1").run();
        assert.deepEqual(migrated.pragma('foreign_key_check'), []);
        migrated.close();
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('redemption rejects insufficient points without changing the balance', async () => {
    const customer = client();
    await customer('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Low Balance',
            email: 'low@example.com',
            password: 'secure-pass-123',
            businessId: defaultBusinessId
        })
    });
    const dashboard = await customer('/api/customer/dashboard');
    const rewardId = (await dashboard.json()).rewards[0].id;
    const response = await customer(`/api/customer/rewards/${rewardId}/redeem`, { method: 'POST' });
    assert.equal(response.status, 400);
    assert.equal(db.prepare("SELECT points FROM users WHERE email = 'low@example.com'").get().points, 10);
});

test('customers request visits and only their business owner can approve points', async () => {
    const owner = client();
    const registration = await owner('/api/auth/register-owner', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Visit Owner',
            businessName: 'Visit Cafe',
            email: 'visit-owner@example.com',
            password: 'secure-pass-123'
        })
    });
    const { user } = await registration.json();
    const customer = client();
    const customerRegistration = await customer('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Visiting Customer',
            email: 'visiting@example.com',
            password: 'secure-pass-123',
            businessId: user.businessId
        })
    });
    assert.equal(customerRegistration.status, 201);

    const mismatch = await customer('/api/customer/check-ins', {
        method: 'POST',
        body: JSON.stringify({ businessId: user.businessId + 999 })
    });
    assert.equal(mismatch.status, 400);

    const checkIn = await customer('/api/customer/check-ins', {
        method: 'POST',
        body: JSON.stringify({ businessId: user.businessId })
    });
    assert.equal(checkIn.status, 201);
    const duplicate = await customer('/api/customer/check-ins', {
        method: 'POST',
        body: JSON.stringify({ businessId: user.businessId })
    });
    assert.equal(duplicate.status, 409);

    const settings = await owner('/api/owner/settings', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Visit Cafe Updated', pointsPerVisit: 25, menuUrl: 'https://example.com/menu' })
    });
    assert.equal((await settings.json()).business.pointsPerVisit, 25);
    const wrongOwner = client();
    await wrongOwner('/api/auth/register-owner', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Other Owner',
            businessName: 'Other Cafe',
            email: 'other-owner@example.com',
            password: 'secure-pass-123'
        })
    });
    const pending = await owner('/api/owner/check-ins');
    const pendingCheckIn = (await pending.json()).checkIns[0];
    const forbidden = await wrongOwner(`/api/owner/check-ins/${pendingCheckIn.id}/approve`, { method: 'POST' });
    assert.equal(forbidden.status, 404);

    const approved = await owner(`/api/owner/check-ins/${pendingCheckIn.id}/approve`, { method: 'POST' });
    assert.equal((await approved.json()).points, 25);
    const dashboard = await customer('/api/customer/dashboard');
    const data = await dashboard.json();
    assert.equal(data.points, 35);
    assert.equal(data.visits, 1);
    assert.equal(data.transactions[0].type, 'earn');
    const duplicateApproval = await owner(`/api/owner/check-ins/${pendingCheckIn.id}/approve`, { method: 'POST' });
    assert.equal(duplicateApproval.status, 404);
});

test('customer profile can be updated and account deletion requires the password', async () => {
    const customer = client();
    const registration = await customer('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Profile Customer',
            email: 'profile@example.com',
            password: 'secure-pass-123',
            businessId: defaultBusinessId
        })
    });
    assert.equal(registration.status, 201);
    const profile = await customer('/api/customer/profile', {
        method: 'PATCH',
        body: JSON.stringify({
            name: 'Updated Customer',
            birthday: '2000-05-10',
            notificationsEnabled: false
        })
    });
    assert.equal((await profile.json()).user.notificationsEnabled, false);
    const invalidBirthday = await customer('/api/customer/profile', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated Customer', birthday: '2000-99-10', notificationsEnabled: false })
    });
    assert.equal(invalidBirthday.status, 400);

    const rejectedDelete = await customer('/api/customer/account', {
        method: 'DELETE',
        body: JSON.stringify({ password: 'incorrect-password' })
    });
    assert.equal(rejectedDelete.status, 401);
    const deleted = await customer('/api/customer/account', {
        method: 'DELETE',
        body: JSON.stringify({ password: 'secure-pass-123' })
    });
    assert.equal(deleted.status, 204);
    assert.equal((await customer('/api/auth/me')).status, 401);
});

test('database startup adds new feature columns to an existing database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'repeato-schema-'));
    const filename = join(directory, 'legacy.sqlite');
    const legacy = new Database(filename);
    legacy.exec(`
        CREATE TABLE businesses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            business_id INTEGER NOT NULL REFERENCES businesses(id),
            name TEXT NOT NULL,
            email TEXT NOT NULL COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('customer', 'owner')),
            points INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE (business_id, email)
        );
        CREATE TABLE rewards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            business_id INTEGER NOT NULL REFERENCES businesses(id),
            name TEXT NOT NULL,
            points_required INTEGER NOT NULL,
            icon TEXT NOT NULL DEFAULT '🎁',
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE point_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            business_id INTEGER NOT NULL REFERENCES businesses(id),
            user_id INTEGER NOT NULL REFERENCES users(id),
            reward_id INTEGER REFERENCES rewards(id),
            type TEXT NOT NULL,
            points_delta INTEGER NOT NULL,
            description TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO businesses (name) VALUES ('Existing Cafe');
        INSERT INTO users (business_id, name, email, password_hash, role, points)
        VALUES (1, 'Existing Customer', 'existing-customer@example.test', 'old-hash', 'customer', 0);
    `);
    legacy.close();

    try {
        const migrated = createDatabase(filename);
        const business = migrated.prepare('SELECT name, points_per_visit, menu_url FROM businesses').get();
        const userColumns = migrated.prepare('PRAGMA table_info(users)').all().map(column => column.name);
        const migratedReferralCode = migrated.prepare(`
            SELECT referral_code FROM users WHERE email = 'existing-customer@example.test'
        `).get().referral_code;
        const referralIndex = migrated.prepare(`
            SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_users_referral_code'
        `).get();
        const checkInTable = migrated.prepare(`
            SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'visit_checkins'
        `).get();
        const orderTable = migrated.prepare(`
            SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'orders'
        `).get();
        migrated.close();
        assert.deepEqual(business, { name: 'Existing Cafe', points_per_visit: 10, menu_url: '' });
        assert.ok(userColumns.includes('birthday'));
        assert.ok(userColumns.includes('notifications_enabled'));
        assert.ok(userColumns.includes('referral_code'));
        assert.ok(userColumns.includes('referred_by_id'));
        assert.match(migratedReferralCode, /^[a-f0-9]{16}$/);
        assert.ok(checkInTable);
        assert.ok(orderTable);
        assert.ok(referralIndex);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
