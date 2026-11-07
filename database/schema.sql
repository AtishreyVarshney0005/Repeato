PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS businesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    points_per_visit INTEGER NOT NULL DEFAULT 10 CHECK (points_per_visit > 0),
    menu_url TEXT NOT NULL DEFAULT '',
    latitude REAL,
    longitude REAL,
    delivery_base_fee_paise INTEGER NOT NULL DEFAULT 2000 CHECK (delivery_base_fee_paise >= 0),
    delivery_per_km_paise INTEGER NOT NULL DEFAULT 1000 CHECK (delivery_per_km_paise >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('customer', 'owner')),
    points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
    birthday TEXT,
    notifications_enabled INTEGER NOT NULL DEFAULT 1 CHECK (notifications_enabled IN (0, 1)),
    referral_code TEXT,
    referred_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (business_id, email)
);

CREATE TABLE IF NOT EXISTS rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    points_required INTEGER NOT NULL CHECK (points_required > 0),
    icon TEXT NOT NULL DEFAULT '🎁',
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'Main',
    price_paise INTEGER NOT NULL CHECK (price_paise > 0),
    image_data TEXT NOT NULL DEFAULT '',
    dietary_type TEXT NOT NULL DEFAULT '',
    spice_level TEXT NOT NULL DEFAULT '',
    allergens TEXT NOT NULL DEFAULT '',
    variants_json TEXT NOT NULL DEFAULT '[]',
    available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS delivery_partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS delivery_partner_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    email TEXT NOT NULL COLLATE NOCASE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
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

CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
    item_name TEXT NOT NULL,
    variant_name TEXT NOT NULL DEFAULT '',
    quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20),
    unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise > 0)
);

CREATE TABLE IF NOT EXISTS point_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reward_id INTEGER REFERENCES rewards(id) ON DELETE SET NULL,
    type TEXT NOT NULL CHECK (type IN ('bonus', 'earn', 'redeem')),
    points_delta INTEGER NOT NULL CHECK (points_delta != 0),
    description TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS visit_checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved')),
    points_awarded INTEGER,
    requested_at TEXT NOT NULL DEFAULT (datetime('now')),
    approved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_business_role ON users(business_id, role);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_email ON users(email COLLATE NOCASE) WHERE role = 'customer';
CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_email ON users(email COLLATE NOCASE) WHERE role = 'owner';
CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON point_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rewards_business_active ON rewards(business_id, active);
CREATE INDEX IF NOT EXISTS idx_menu_items_business_available ON menu_items(business_id, available, category);
CREATE INDEX IF NOT EXISTS idx_checkins_business_status ON visit_checkins(business_id, status, requested_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_pending_user ON visit_checkins(user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_delivery_partners_business ON delivery_partners(business_id, active);
CREATE INDEX IF NOT EXISTS idx_delivery_invites_business ON delivery_partner_invites(business_id, expires_at);
