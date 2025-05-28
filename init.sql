-- Create metabase database
CREATE DATABASE metabase;

-- Create tables for blockchain sync state
CREATE TABLE IF NOT EXISTS sync_state (
    id SERIAL PRIMARY KEY,
    contract_address VARCHAR(42) NOT NULL UNIQUE,
    last_block_number BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create tables for XBurnMinter events
CREATE TABLE IF NOT EXISTS xen_burns (
    id SERIAL PRIMARY KEY,
    transaction_hash VARCHAR(66) NOT NULL,
    block_number BIGINT NOT NULL,
    block_timestamp TIMESTAMP NOT NULL,
    log_index INTEGER NOT NULL,
    user_address VARCHAR(42) NOT NULL,
    amount NUMERIC(78, 0) NOT NULL,
    UNIQUE(transaction_hash, log_index)
);

CREATE TABLE IF NOT EXISTS burn_nft_minted (
    id SERIAL PRIMARY KEY,
    transaction_hash VARCHAR(66) NOT NULL,
    block_number BIGINT NOT NULL,
    block_timestamp TIMESTAMP NOT NULL,
    log_index INTEGER NOT NULL,
    user_address VARCHAR(42) NOT NULL,
    token_id NUMERIC(78, 0) NOT NULL,
    xen_amount NUMERIC(78, 0) NOT NULL,
    term_days INTEGER NOT NULL,
    UNIQUE(transaction_hash, log_index)
);

CREATE TABLE IF NOT EXISTS xburn_claimed (
    id SERIAL PRIMARY KEY,
    transaction_hash VARCHAR(66) NOT NULL,
    block_number BIGINT NOT NULL,
    block_timestamp TIMESTAMP NOT NULL,
    log_index INTEGER NOT NULL,
    user_address VARCHAR(42) NOT NULL,
    base_amount NUMERIC(78, 0) NOT NULL,
    bonus_amount NUMERIC(78, 0) NOT NULL,
    UNIQUE(transaction_hash, log_index)
);

CREATE TABLE IF NOT EXISTS emergency_ends (
    id SERIAL PRIMARY KEY,
    transaction_hash VARCHAR(66) NOT NULL,
    block_number BIGINT NOT NULL,
    block_timestamp TIMESTAMP NOT NULL,
    log_index INTEGER NOT NULL,
    user_address VARCHAR(42) NOT NULL,
    base_amount NUMERIC(78, 0) NOT NULL,
    UNIQUE(transaction_hash, log_index)
);

CREATE TABLE IF NOT EXISTS xburn_burned (
    id SERIAL PRIMARY KEY,
    transaction_hash VARCHAR(66) NOT NULL,
    block_number BIGINT NOT NULL,
    block_timestamp TIMESTAMP NOT NULL,
    log_index INTEGER NOT NULL,
    user_address VARCHAR(42) NOT NULL,
    amount NUMERIC(78, 0) NOT NULL,
    UNIQUE(transaction_hash, log_index)
);

CREATE TABLE IF NOT EXISTS liquidity_initialized (
    id SERIAL PRIMARY KEY,
    transaction_hash VARCHAR(66) NOT NULL,
    block_number BIGINT NOT NULL,
    block_timestamp TIMESTAMP NOT NULL,
    log_index INTEGER NOT NULL,
    amount_xburn NUMERIC(78, 0) NOT NULL,
    amount_xen NUMERIC(78, 0) NOT NULL,
    liquidity NUMERIC(78, 0) NOT NULL,
    UNIQUE(transaction_hash, log_index)
);

-- Create tables for XBurnNFT events
CREATE TABLE IF NOT EXISTS burn_lock_created (
    id SERIAL PRIMARY KEY,
    transaction_hash VARCHAR(66) NOT NULL,
    block_number BIGINT NOT NULL,
    block_timestamp TIMESTAMP NOT NULL,
    log_index INTEGER NOT NULL,
    token_id NUMERIC(78, 0) NOT NULL,
    user_address VARCHAR(42) NOT NULL,
    amount NUMERIC(78, 0) NOT NULL,
    term_days INTEGER NOT NULL,
    maturity_timestamp TIMESTAMP NOT NULL,
    UNIQUE(transaction_hash, log_index)
);

CREATE TABLE IF NOT EXISTS lock_claimed (
    id SERIAL PRIMARY KEY,
    transaction_hash VARCHAR(66) NOT NULL,
    block_number BIGINT NOT NULL,
    block_timestamp TIMESTAMP NOT NULL,
    log_index INTEGER NOT NULL,
    token_id NUMERIC(78, 0) NOT NULL,
    UNIQUE(transaction_hash, log_index)
);

CREATE TABLE IF NOT EXISTS lock_burned (
    id SERIAL PRIMARY KEY,
    transaction_hash VARCHAR(66) NOT NULL,
    block_number BIGINT NOT NULL,
    block_timestamp TIMESTAMP NOT NULL,
    log_index INTEGER NOT NULL,
    token_id NUMERIC(78, 0) NOT NULL,
    UNIQUE(transaction_hash, log_index)
);

-- Create indexes for better query performance
CREATE INDEX idx_xen_burns_user ON xen_burns(user_address);
CREATE INDEX idx_xen_burns_block ON xen_burns(block_number);
CREATE INDEX idx_burn_nft_user ON burn_nft_minted(user_address);
CREATE INDEX idx_xburn_claimed_user ON xburn_claimed(user_address);
CREATE INDEX idx_emergency_ends_user ON emergency_ends(user_address);
CREATE INDEX idx_xburn_burned_user ON xburn_burned(user_address);
CREATE INDEX idx_burn_lock_user ON burn_lock_created(user_address);
CREATE INDEX idx_burn_lock_token ON burn_lock_created(token_id);

-- Create views for statistics

-- Total XEN burned view
CREATE OR REPLACE VIEW total_xen_burned AS
SELECT 
    COALESCE(SUM(amount), 0) as total_xen_burned,
    COUNT(DISTINCT user_address) as unique_burners,
    COUNT(*) as total_burns
FROM xen_burns;

-- Top 10 XEN burners view
CREATE OR REPLACE VIEW top_xen_burners AS
SELECT 
    user_address,
    SUM(amount) as total_burned,
    COUNT(*) as burn_count,
    MIN(block_timestamp) as first_burn,
    MAX(block_timestamp) as last_burn
FROM xen_burns
GROUP BY user_address
ORDER BY total_burned DESC
LIMIT 10;

-- Emergency end statistics view
CREATE OR REPLACE VIEW emergency_end_stats AS
SELECT 
    COUNT(*) as total_emergency_ends,
    COUNT(DISTINCT user_address) as unique_users,
    SUM(base_amount) as total_base_amount,
    MIN(block_timestamp) as first_emergency_end,
    MAX(block_timestamp) as last_emergency_end
FROM emergency_ends;

-- User statistics view
CREATE OR REPLACE VIEW user_stats AS
SELECT 
    u.user_address,
    COALESCE(xb.total_xen_burned, 0) as total_xen_burned,
    COALESCE(xb.burn_count, 0) as burn_count,
    COALESCE(nft.nft_count, 0) as nfts_minted,
    COALESCE(cl.claims_count, 0) as claims_count,
    COALESCE(cl.total_claimed, 0) as total_xburn_claimed,
    COALESCE(ee.emergency_count, 0) as emergency_ends,
    COALESCE(xbb.total_xburn_burned, 0) as total_xburn_burned
FROM (
    SELECT DISTINCT user_address FROM (
        SELECT user_address FROM xen_burns
        UNION SELECT user_address FROM burn_nft_minted
        UNION SELECT user_address FROM xburn_claimed
        UNION SELECT user_address FROM emergency_ends
        UNION SELECT user_address FROM xburn_burned
    ) all_users
) u
LEFT JOIN (
    SELECT user_address, SUM(amount) as total_xen_burned, COUNT(*) as burn_count
    FROM xen_burns
    GROUP BY user_address
) xb ON u.user_address = xb.user_address
LEFT JOIN (
    SELECT user_address, COUNT(*) as nft_count
    FROM burn_nft_minted
    GROUP BY user_address
) nft ON u.user_address = nft.user_address
LEFT JOIN (
    SELECT user_address, COUNT(*) as claims_count, SUM(base_amount + bonus_amount) as total_claimed
    FROM xburn_claimed
    GROUP BY user_address
) cl ON u.user_address = cl.user_address
LEFT JOIN (
    SELECT user_address, COUNT(*) as emergency_count
    FROM emergency_ends
    GROUP BY user_address
) ee ON u.user_address = ee.user_address
LEFT JOIN (
    SELECT user_address, SUM(amount) as total_xburn_burned
    FROM xburn_burned
    GROUP BY user_address
) xbb ON u.user_address = xbb.user_address;

-- Daily statistics view
CREATE OR REPLACE VIEW daily_stats AS
SELECT 
    DATE(block_timestamp) as date,
    COUNT(DISTINCT user_address) as unique_users,
    SUM(amount) as xen_burned,
    COUNT(*) as burn_count
FROM xen_burns
GROUP BY DATE(block_timestamp)
ORDER BY date DESC;

-- NFT lock statistics view
CREATE OR REPLACE VIEW nft_lock_stats AS
SELECT 
    COUNT(*) as total_locks,
    COUNT(DISTINCT user_address) as unique_lockers,
    SUM(amount) as total_locked_xen,
    AVG(term_days) as avg_lock_days,
    MAX(term_days) as max_lock_days,
    MIN(term_days) as min_lock_days
FROM burn_lock_created;

-- Active locks view (not yet claimed or burned)
CREATE OR REPLACE VIEW active_locks AS
SELECT 
    blc.token_id,
    blc.user_address,
    blc.amount,
    blc.term_days,
    blc.maturity_timestamp,
    blc.block_timestamp as created_at,
    CASE 
        WHEN blc.maturity_timestamp <= CURRENT_TIMESTAMP THEN 'Matured'
        ELSE 'Locked'
    END as status
FROM burn_lock_created blc
LEFT JOIN lock_claimed lc ON blc.token_id = lc.token_id
LEFT JOIN lock_burned lb ON blc.token_id = lb.token_id
WHERE lc.token_id IS NULL AND lb.token_id IS NULL;

-- Protocol overview view
CREATE OR REPLACE VIEW protocol_overview AS
SELECT 
    (SELECT COALESCE(SUM(amount), 0) FROM xen_burns) as total_xen_burned,
    (SELECT COUNT(DISTINCT user_address) FROM xen_burns) as total_burners,
    (SELECT COALESCE(SUM(base_amount + bonus_amount), 0) FROM xburn_claimed) as total_xburn_claimed,
    (SELECT COALESCE(SUM(amount), 0) FROM xburn_burned) as total_xburn_burned,
    (SELECT COUNT(*) FROM emergency_ends) as total_emergency_ends,
    (SELECT COUNT(*) FROM burn_nft_minted) as total_nfts_minted,
    (SELECT COUNT(*) FROM active_locks) as active_locks_count,
    (SELECT COALESCE(SUM(amount), 0) FROM active_locks) as total_xen_in_active_locks; 