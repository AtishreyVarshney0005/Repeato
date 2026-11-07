import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDirectory = dirname(fileURLToPath(import.meta.url));

export function createDatabase(filename = resolve(serverDirectory, '..', 'database', 'data', 'repeato.sqlite')) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });

    const db = new Database(filename);
    db.pragma('journal_mode = WAL');
    db.exec(readFileSync(new URL('../database/schema.sql', import.meta.url), 'utf8'));

    const ensureColumn = (table, column, definition) => {
        const columns = db.prepare(`PRAGMA table_info(${table})`).all();
        if (!columns.some(item => item.name === column)) {
            db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        }
    };
    ensureColumn('businesses', 'points_per_visit', 'INTEGER NOT NULL DEFAULT 10 CHECK (points_per_visit > 0)');
    ensureColumn('businesses', 'menu_url', "TEXT NOT NULL DEFAULT ''");
    ensureColumn('businesses', 'latitude', 'REAL');
    ensureColumn('businesses', 'longitude', 'REAL');
    ensureColumn('businesses', 'delivery_base_fee_paise', 'INTEGER NOT NULL DEFAULT 2000');
    ensureColumn('businesses', 'delivery_per_km_paise', 'INTEGER NOT NULL DEFAULT 1000');
    ensureColumn('users', 'birthday', 'TEXT');
    ensureColumn('users', 'notifications_enabled', 'INTEGER NOT NULL DEFAULT 1 CHECK (notifications_enabled IN (0, 1))');
    ensureColumn('users', 'referral_code', 'TEXT');
    ensureColumn('users', 'referred_by_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
    ensureColumn('menu_items', 'image_data', "TEXT NOT NULL DEFAULT ''");
    ensureColumn('menu_items', 'dietary_type', "TEXT NOT NULL DEFAULT ''");
    ensureColumn('menu_items', 'spice_level', "TEXT NOT NULL DEFAULT ''");
    ensureColumn('menu_items', 'allergens', "TEXT NOT NULL DEFAULT ''");
    ensureColumn('menu_items', 'variants_json', "TEXT NOT NULL DEFAULT '[]'");
    ensureColumn('orders', 'payment_status', "TEXT NOT NULL DEFAULT 'cash_due'");
    ensureColumn('orders', 'razorpay_order_id', 'TEXT');
    ensureColumn('orders', 'razorpay_payment_id', 'TEXT');
    ensureColumn('orders', 'razorpay_refund_id', 'TEXT');
    ensureColumn('orders', 'delivery_address', "TEXT NOT NULL DEFAULT ''");
    ensureColumn('orders', 'delivery_latitude', 'REAL');
    ensureColumn('orders', 'delivery_longitude', 'REAL');
    ensureColumn('orders', 'delivery_distance_km', 'REAL NOT NULL DEFAULT 0');
    ensureColumn('orders', 'delivery_fee_paise', 'INTEGER NOT NULL DEFAULT 0');
    ensureColumn('orders', 'delivery_partner_id', 'INTEGER REFERENCES delivery_partners(id) ON DELETE SET NULL');
    const ordersDefinition = db.prepare(`
        SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'
    `).get()?.sql ?? '';
    if (ordersDefinition.includes("CHECK (payment_method = 'cash_on_pickup')")
        || !ordersDefinition.includes("'delivered'") || !ordersDefinition.includes("fulfillment IN")
        || !ordersDefinition.includes("'cash_on_delivery'")) {
        db.pragma('foreign_keys = OFF');
        try {
            db.transaction(() => {
                db.exec(`
                    CREATE TABLE orders_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
                        customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'rejected')),
                        payment_method TEXT NOT NULL DEFAULT 'cash_on_pickup' CHECK (payment_method IN ('cash_on_pickup', 'cash_on_delivery', 'razorpay')),
                        payment_status TEXT NOT NULL DEFAULT 'cash_due' CHECK (payment_status IN ('cash_due', 'pending', 'paid', 'failed', 'refund_pending', 'refunded')),
                        razorpay_order_id TEXT,
                        razorpay_payment_id TEXT,
                        razorpay_refund_id TEXT,
                        fulfillment TEXT NOT NULL DEFAULT 'pickup' CHECK (fulfillment IN ('pickup', 'delivery')),
                        total_paise INTEGER NOT NULL CHECK (total_paise > 0),
                        delivery_address TEXT NOT NULL DEFAULT '',
                        delivery_latitude REAL,
                        delivery_longitude REAL,
                        delivery_distance_km REAL NOT NULL DEFAULT 0 CHECK (delivery_distance_km >= 0),
                        delivery_fee_paise INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee_paise >= 0),
                        delivery_partner_id INTEGER REFERENCES delivery_partners(id) ON DELETE SET NULL,
                        created_at TEXT NOT NULL DEFAULT (datetime('now')),
                        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    INSERT INTO orders_new (
                        id, business_id, customer_id, status, payment_method, payment_status,
                        razorpay_order_id, razorpay_payment_id, razorpay_refund_id, fulfillment,
                        total_paise, delivery_address, delivery_latitude, delivery_longitude,
                        delivery_distance_km, delivery_fee_paise, delivery_partner_id, created_at, updated_at
                    )
                    SELECT id, business_id, customer_id, status, payment_method, payment_status,
                        razorpay_order_id, razorpay_payment_id, razorpay_refund_id, fulfillment,
                        total_paise, delivery_address, delivery_latitude, delivery_longitude,
                        delivery_distance_km, delivery_fee_paise, delivery_partner_id, created_at, updated_at
                    FROM orders;
                    CREATE TABLE order_items_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        order_id INTEGER NOT NULL REFERENCES orders_new(id) ON DELETE CASCADE,
                        menu_item_id INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
                        item_name TEXT NOT NULL,
                        variant_name TEXT NOT NULL DEFAULT '',
                        quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20),
                        unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise > 0)
                    );
                    INSERT INTO order_items_new SELECT * FROM order_items;
                    DROP TABLE order_items;
                    DROP TABLE orders;
                    ALTER TABLE orders_new RENAME TO orders;
                    ALTER TABLE order_items_new RENAME TO order_items;
                `);
            })();
        } finally {
            db.pragma('foreign_keys = ON');
        }
    }
    db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_razorpay_order
        ON orders(razorpay_order_id) WHERE razorpay_order_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_orders_business_created ON orders(business_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON orders(customer_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
        CREATE INDEX IF NOT EXISTS idx_orders_partner_status ON orders(delivery_partner_id, status, created_at DESC);
    `);
    const customersWithoutReferralCodes = db.prepare(`
        SELECT id FROM users WHERE role = 'customer' AND referral_code IS NULL
    `).all();
    const setReferralCode = db.prepare('UPDATE users SET referral_code = ? WHERE id = ?');
    const assignReferralCodes = db.transaction(() => {
        for (const customer of customersWithoutReferralCodes) {
            setReferralCode.run(randomBytes(8).toString('hex'), customer.id);
        }
    });
    assignReferralCodes();
    db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code
        ON users(referral_code COLLATE NOCASE) WHERE referral_code IS NOT NULL
    `);

    const business = db.prepare('SELECT id FROM businesses ORDER BY id LIMIT 1').get();
    if (!business) {
        const seed = db.transaction(() => {
            db.prepare('INSERT INTO businesses (name) VALUES (?)').run('ElaraEatery');
        });
        seed();
    }

    return db;
}
