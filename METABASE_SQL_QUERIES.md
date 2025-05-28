-- =============================================================================
-- BURN DASHBOARD METABASE SQL QUERIES
-- =============================================================================
-- 
-- IMPORTANT: All token amounts in the database are stored in wei format (18 decimals)
-- This means amounts need to be divided by 1e18 to get human-readable numbers
-- 
-- Examples:
-- - 1000000000000000000 (wei) = 1 XEN (human readable)
-- - 1000000000000000000000000 (wei) = 1,000,000 XEN (human readable)
-- 
-- For better display in Metabase dashboards, consider:
-- - Using ROUND(amount / 1e18, 2) for decimal precision
-- - Setting up number formatting in Metabase to show thousands separators
-- - Using scientific notation for very large numbers if needed
-- 
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TOTAL AND HISTORICAL BURN VOLUME METRICS
-- -----------------------------------------------------------------------------

-- Total XEN Burned (Single Number)
SELECT 
    COALESCE(SUM(amount), 0) / 1e18 as total_xen_burned
FROM xen_burns;

-- Total XBURN Minted (Single Number)
SELECT 
    COALESCE(SUM(base_amount + bonus_amount), 0) / 1e18 as total_xburn_minted
FROM xburn_claimed;

-- Total Burn Transactions (Single Number)
SELECT COUNT(*) as total_burn_transactions
FROM xen_burns;

-- Cumulative Burn Volume Over Time (Line Chart)
SELECT 
    DATE(block_timestamp) as burn_date,
    SUM(amount / 1e18) OVER (ORDER BY DATE(block_timestamp)) as cumulative_xen_burned
FROM xen_burns
ORDER BY burn_date;

-- Daily Burn Volume (Line Chart)
SELECT 
    DATE(block_timestamp) as burn_date,
    SUM(amount) / 1e18 as daily_xen_burned,
    COUNT(*) as daily_burn_count
FROM xen_burns
GROUP BY DATE(block_timestamp)
ORDER BY burn_date DESC;

-- Weekly Burn Volume (Bar Chart)
SELECT 
    DATE_TRUNC('week', block_timestamp) as week_start,
    SUM(amount) / 1e18 as weekly_xen_burned,
    COUNT(*) as weekly_burn_count
FROM xen_burns
GROUP BY DATE_TRUNC('week', block_timestamp)
ORDER BY week_start DESC;

-- -----------------------------------------------------------------------------
-- 2. BURN EVENT STATS AND DISTRIBUTIONS
-- -----------------------------------------------------------------------------

-- Average Burn Amount (Single Number)
SELECT 
    COALESCE(AVG(amount), 0) / 1e18 as average_burn_amount
FROM xen_burns;

-- Median Burn Amount (Single Number)
SELECT 
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount) / 1e18 as median_burn_amount
FROM xen_burns;

-- Largest Burn Event (Single Number)
SELECT 
    MAX(amount) / 1e18 as largest_burn_amount,
    user_address as largest_burner,
    block_timestamp as burn_timestamp
FROM xen_burns
WHERE amount = (SELECT MAX(amount) FROM xen_burns);

-- Burn Size Distribution (Histogram)
SELECT 
    CASE 
        WHEN amount < 1000000 * 1e18 THEN 'Small (< 1M XEN)'
        WHEN amount < 10000000 * 1e18 THEN 'Medium (1M - 10M XEN)'
        WHEN amount < 100000000 * 1e18 THEN 'Large (10M - 100M XEN)'
        ELSE 'Whale (> 100M XEN)'
    END as burn_size_category,
    COUNT(*) as burn_count,
    SUM(amount) / 1e18 as total_amount_in_category
FROM xen_burns
GROUP BY 
    CASE 
        WHEN amount < 1000000 * 1e18 THEN 'Small (< 1M XEN)'
        WHEN amount < 10000000 * 1e18 THEN 'Medium (1M - 10M XEN)'
        WHEN amount < 100000000 * 1e18 THEN 'Large (10M - 100M XEN)'
        ELSE 'Whale (> 100M XEN)'
    END
ORDER BY 
    CASE 
        WHEN burn_size_category = 'Small (< 1M XEN)' THEN 1
        WHEN burn_size_category = 'Medium (1M - 10M XEN)' THEN 2
        WHEN burn_size_category = 'Large (10M - 100M XEN)' THEN 3
        ELSE 4
    END;

-- -----------------------------------------------------------------------------
-- 3. LOCK AND BURN POSITION METRICS
-- -----------------------------------------------------------------------------

-- Active Burn Positions (Single Number)
SELECT COUNT(*) as active_positions
FROM active_locks;

-- Completed Burn Positions (Single Number)
SELECT COUNT(*) as completed_positions
FROM lock_claimed;

-- Burn Position Status Distribution (Pie Chart)
SELECT 
    'Active Locks' as status,
    COUNT(*) as position_count
FROM burn_lock_created blc
LEFT JOIN lock_claimed lc ON blc.token_id = lc.token_id
LEFT JOIN lock_burned lb ON blc.token_id = lb.token_id
WHERE lc.token_id IS NULL AND lb.token_id IS NULL

UNION ALL

SELECT 
    'Claimed' as status,
    COUNT(*) as position_count
FROM lock_claimed

UNION ALL

SELECT 
    'Emergency Ended' as status,
    COUNT(*) as position_count
FROM emergency_ends;

-- Lock Duration Distribution (Bar Chart)
SELECT 
    CASE 
        WHEN term_days <= 30 THEN '1-30 days'
        WHEN term_days <= 180 THEN '31-180 days'
        WHEN term_days <= 365 THEN '181-365 days'
        WHEN term_days <= 1095 THEN '1-3 years'
        ELSE '3+ years'
    END as duration_category,
    COUNT(*) as lock_count,
    AVG(term_days) as avg_days_in_category
FROM burn_lock_created
GROUP BY 
    CASE 
        WHEN term_days <= 30 THEN '1-30 days'
        WHEN term_days <= 180 THEN '31-180 days'
        WHEN term_days <= 365 THEN '181-365 days'
        WHEN term_days <= 1095 THEN '1-3 years'
        ELSE '3+ years'
    END
ORDER BY 
    CASE 
        WHEN duration_category = '1-30 days' THEN 1
        WHEN duration_category = '31-180 days' THEN 2
        WHEN duration_category = '181-365 days' THEN 3
        WHEN duration_category = '1-3 years' THEN 4
        ELSE 5
    END;

-- Average Lock Duration (Single Number)
SELECT 
    COALESCE(AVG(term_days), 0) as average_lock_duration_days
FROM burn_lock_created;

-- Long-Term Lock Rate (Percentage)
SELECT 
    ROUND(
        (COUNT(*) FILTER (WHERE term_days >= 365) * 100.0 / COUNT(*)), 2
    ) as long_term_lock_percentage
FROM burn_lock_created;

-- -----------------------------------------------------------------------------
-- 4. EMERGENCY END METRICS
-- -----------------------------------------------------------------------------

-- Early Ended Positions (Single Number)
SELECT COUNT(*) as emergency_end_count
FROM emergency_ends;

-- Emergency End Rate (Percentage)
SELECT 
    ROUND(
        (SELECT COUNT(*) FROM emergency_ends) * 100.0 / 
        (SELECT COUNT(*) FROM burn_lock_created), 2
    ) as emergency_end_rate_percentage;

-- Average Term Completed at Early End (Single Number)
-- Note: This requires joining emergency_ends with burn_lock_created to get original term
SELECT 
    AVG(
        EXTRACT(DAY FROM (ee.block_timestamp - blc.block_timestamp)) * 100.0 / blc.term_days
    ) as avg_term_completed_percentage
FROM emergency_ends ee
JOIN burn_lock_created blc ON ee.user_address = blc.user_address 
    AND ee.block_timestamp >= blc.block_timestamp;

-- Total XBURN Bonus Forfeited (Single Number)
-- This estimates the bonus that would have been earned vs what was actually given
SELECT 
    COALESCE(SUM(
        (blc.amount / 1e18 / 1000000) * 
        (blc.term_days * 100 / 3650) * 
        (2397 * 100 / 2397) / 10000 -- Simplified bonus calculation
    ), 0) - COALESCE(SUM(ee.base_amount / 1e18), 0) as total_bonus_forfeited
FROM emergency_ends ee
JOIN burn_lock_created blc ON ee.user_address = blc.user_address;

-- -----------------------------------------------------------------------------
-- 5. WALLET-LEVEL METRICS
-- -----------------------------------------------------------------------------

-- Unique Burn Participants (Single Number)
SELECT COUNT(DISTINCT user_address) as unique_burners
FROM xen_burns;

-- New Burners Over Time (Line Chart)
WITH first_burns AS (
    SELECT 
        user_address,
        MIN(DATE(block_timestamp)) as first_burn_date
    FROM xen_burns
    GROUP BY user_address
)
SELECT 
    first_burn_date,
    COUNT(*) as new_burners_count,
    SUM(COUNT(*)) OVER (ORDER BY first_burn_date) as cumulative_burners
FROM first_burns
GROUP BY first_burn_date
ORDER BY first_burn_date;

-- Average Burns per User (Single Number)
SELECT 
    ROUND(
        (SELECT COUNT(*) FROM xen_burns) * 1.0 / 
        (SELECT COUNT(DISTINCT user_address) FROM xen_burns), 2
    ) as avg_burns_per_user;

-- Burns per User Distribution (Bar Chart)
WITH user_burn_counts AS (
    SELECT 
        user_address,
        COUNT(*) as burn_count
    FROM xen_burns
    GROUP BY user_address
)
SELECT 
    CASE 
        WHEN burn_count = 1 THEN '1 burn'
        WHEN burn_count <= 5 THEN '2-5 burns'
        WHEN burn_count <= 10 THEN '6-10 burns'
        WHEN burn_count <= 25 THEN '11-25 burns'
        ELSE '25+ burns'
    END as burn_count_category,
    COUNT(*) as user_count
FROM user_burn_counts
GROUP BY 
    CASE 
        WHEN burn_count = 1 THEN '1 burn'
        WHEN burn_count <= 5 THEN '2-5 burns'
        WHEN burn_count <= 10 THEN '6-10 burns'
        WHEN burn_count <= 25 THEN '11-25 burns'
        ELSE '25+ burns'
    END
ORDER BY 
    CASE 
        WHEN burn_count_category = '1 burn' THEN 1
        WHEN burn_count_category = '2-5 burns' THEN 2
        WHEN burn_count_category = '6-10 burns' THEN 3
        WHEN burn_count_category = '11-25 burns' THEN 4
        ELSE 5
    END;

-- Top Burners by Volume (Table)
SELECT 
    user_address,
    SUM(amount) / 1e18 as total_xen_burned,
    COUNT(*) as burn_count,
    MIN(block_timestamp) as first_burn,
    MAX(block_timestamp) as last_burn
FROM xen_burns
GROUP BY user_address
ORDER BY total_xen_burned DESC
LIMIT 20;

-- Top Burners by Burn Count (Table)
SELECT 
    user_address,
    COUNT(*) as burn_count,
    SUM(amount) / 1e18 as total_xen_burned,
    AVG(amount) / 1e18 as avg_burn_amount
FROM xen_burns
GROUP BY user_address
ORDER BY burn_count DESC
LIMIT 20;

-- Top Burners by XBURN Rewards (Table)
SELECT 
    user_address,
    SUM(base_amount + bonus_amount) / 1e18 as total_xburn_earned,
    COUNT(*) as claims_count,
    AVG(base_amount + bonus_amount) / 1e18 as avg_reward
FROM xburn_claimed
GROUP BY user_address
ORDER BY total_xburn_earned DESC
LIMIT 20;

-- Burn Concentration (Pie Chart)
WITH ranked_burners AS (
    SELECT 
        user_address,
        SUM(amount) / 1e18 as total_burned,
        ROW_NUMBER() OVER (ORDER BY SUM(amount) DESC) as rank
    FROM xen_burns
    GROUP BY user_address
),
total_burned AS (
    SELECT SUM(amount) / 1e18 as total FROM xen_burns
)
SELECT 
    'Top 10 Burners' as category,
    SUM(rb.total_burned) as amount_burned,
    ROUND(SUM(rb.total_burned) * 100.0 / tb.total, 2) as percentage
FROM ranked_burners rb, total_burned tb
WHERE rb.rank <= 10
GROUP BY tb.total

UNION ALL

SELECT 
    'All Other Burners' as category,
    SUM(rb.total_burned) as amount_burned,
    ROUND(SUM(rb.total_burned) * 100.0 / tb.total, 2) as percentage
FROM ranked_burners rb, total_burned tb
WHERE rb.rank > 10
GROUP BY tb.total;

-- -----------------------------------------------------------------------------
-- 6. TIME-BASED TRENDS
-- -----------------------------------------------------------------------------

-- Daily Burn Transactions (Line Chart)
SELECT 
    DATE(block_timestamp) as transaction_date,
    COUNT(*) as daily_transaction_count,
    COUNT(DISTINCT user_address) as unique_daily_burners
FROM xen_burns
GROUP BY DATE(block_timestamp)
ORDER BY transaction_date DESC;

-- Weekly Burn Transactions (Bar Chart)
SELECT 
    DATE_TRUNC('week', block_timestamp) as week_start,
    COUNT(*) as weekly_transaction_count,
    COUNT(DISTINCT user_address) as unique_weekly_burners
FROM xen_burns
GROUP BY DATE_TRUNC('week', block_timestamp)
ORDER BY week_start DESC;

-- Monthly Trends (Line Chart)
SELECT 
    DATE_TRUNC('month', block_timestamp) as month_start,
    COUNT(*) as monthly_transactions,
    SUM(amount) / 1e18 as monthly_volume,
    COUNT(DISTINCT user_address) as unique_monthly_burners,
    AVG(amount) / 1e18 as avg_monthly_burn_size
FROM xen_burns
GROUP BY DATE_TRUNC('month', block_timestamp)
ORDER BY month_start DESC;

-- -----------------------------------------------------------------------------
-- 7. ECONOMIC & DEFLATION METRICS
-- -----------------------------------------------------------------------------

-- Total XBURN Burned via User Burns (Single Number)
SELECT 
    COALESCE(SUM(amount), 0) / 1e18 as total_xburn_burned_by_users
FROM xburn_burned;

-- Swap Cycles and Protocol Burns
-- Note: These would require additional tracking in your schema
-- For now, showing what the queries would look like:

-- XEN Pending Swap (Single Number/Gauge)
-- This would require a table tracking the contract's pending XEN balance
-- SELECT pending_xen_amount, swap_threshold, 
--        (pending_xen_amount * 100.0 / swap_threshold) as progress_percentage
-- FROM protocol_state;

-- Liquidity Events (Table)
SELECT 
    block_timestamp as event_time,
    amount_xburn / 1e18 as amount_xburn,
    amount_xen / 1e18 as amount_xen,
    liquidity / 1e18 as liquidity
FROM liquidity_initialized
ORDER BY block_timestamp DESC;

-- -----------------------------------------------------------------------------
-- 8. ADVANCED ANALYTICS QUERIES
-- -----------------------------------------------------------------------------

-- User Retention Analysis
WITH user_first_burn AS (
    SELECT 
        user_address,
        MIN(DATE(block_timestamp)) as first_burn_date
    FROM xen_burns
    GROUP BY user_address
),
user_activity AS (
    SELECT 
        xb.user_address,
        ufb.first_burn_date,
        DATE(xb.block_timestamp) as burn_date,
        DATE(xb.block_timestamp) - ufb.first_burn_date as days_since_first
    FROM xen_burns xb
    JOIN user_first_burn ufb ON xb.user_address = ufb.user_address
)
SELECT 
    CASE 
        WHEN days_since_first = 0 THEN 'Day 0'
        WHEN days_since_first <= 7 THEN 'Week 1'
        WHEN days_since_first <= 30 THEN 'Month 1'
        WHEN days_since_first <= 90 THEN 'Quarter 1'
        ELSE 'Long Term'
    END as retention_period,
    COUNT(DISTINCT user_address) as active_users
FROM user_activity
GROUP BY 
    CASE 
        WHEN days_since_first = 0 THEN 'Day 0'
        WHEN days_since_first <= 7 THEN 'Week 1'
        WHEN days_since_first <= 30 THEN 'Month 1'
        WHEN days_since_first <= 90 THEN 'Quarter 1'
        ELSE 'Long Term'
    END;

-- Lock Performance Analysis
SELECT 
    blc.term_days,
    COUNT(*) as total_locks,
    COUNT(lc.token_id) as claimed_locks,
    COUNT(ee.user_address) as emergency_ended,
    ROUND(COUNT(lc.token_id) * 100.0 / COUNT(*), 2) as completion_rate,
    ROUND(COUNT(ee.user_address) * 100.0 / COUNT(*), 2) as emergency_rate
FROM burn_lock_created blc
LEFT JOIN lock_claimed lc ON blc.token_id = lc.token_id
LEFT JOIN emergency_ends ee ON blc.user_address = ee.user_address 
    AND ee.block_timestamp >= blc.block_timestamp
GROUP BY blc.term_days
HAVING COUNT(*) >= 5  -- Only show term lengths with meaningful sample size
ORDER BY blc.term_days;

-- Hourly Activity Pattern
SELECT 
    EXTRACT(HOUR FROM block_timestamp) as hour_of_day,
    COUNT(*) as burn_count,
    AVG(amount) / 1e18 as avg_burn_amount
FROM xen_burns
GROUP BY EXTRACT(HOUR FROM block_timestamp)
ORDER BY hour_of_day;

-- Day of Week Pattern
SELECT 
    EXTRACT(DOW FROM block_timestamp) as day_of_week,
    CASE EXTRACT(DOW FROM block_timestamp)
        WHEN 0 THEN 'Sunday'
        WHEN 1 THEN 'Monday'
        WHEN 2 THEN 'Tuesday'
        WHEN 3 THEN 'Wednesday'
        WHEN 4 THEN 'Thursday'
        WHEN 5 THEN 'Friday'
        WHEN 6 THEN 'Saturday'
    END as day_name,
    COUNT(*) as burn_count,
    SUM(amount) / 1e18 as total_volume
FROM xen_burns
GROUP BY EXTRACT(DOW FROM block_timestamp)
ORDER BY day_of_week;

-- -----------------------------------------------------------------------------
-- 10. USING THE PROVIDED VIEWS (ALTERNATIVE QUERIES)
-- -----------------------------------------------------------------------------

-- If you want to use the views from the schema (with proper decimal conversion):

-- Protocol Overview using the view (convert amounts)
SELECT 
    total_xen_burned / 1e18 as total_xen_burned_readable,
    total_burners,
    total_xburn_claimed / 1e18 as total_xburn_claimed_readable,
    total_xburn_burned / 1e18 as total_xburn_burned_readable,
    total_emergency_ends,
    total_nfts_minted,
    active_locks_count,
    total_xen_in_active_locks / 1e18 as total_xen_in_active_locks_readable
FROM protocol_overview;

-- Daily Stats using the view (convert amounts)
SELECT 
    date,
    unique_users,
    xen_burned / 1e18 as xen_burned_readable,
    burn_count
FROM daily_stats
ORDER BY date DESC;

-- Top XEN Burners using the view (convert amounts)
SELECT 
    user_address,
    total_burned / 1e18 as total_burned_readable,
    burn_count,
    first_burn,
    last_burn
FROM top_xen_burners;

-- User Stats using the comprehensive view (convert amounts)
SELECT 
    user_address,
    total_xen_burned / 1e18 as total_xen_burned_readable,
    burn_count,
    nfts_minted,
    claims_count,
    total_xburn_claimed / 1e18 as total_xburn_claimed_readable,
    emergency_ends,
    total_xburn_burned / 1e18 as total_xburn_burned_readable
FROM user_stats
WHERE total_xen_burned > 0
ORDER BY total_xen_burned DESC
LIMIT 100;

-- -----------------------------------------------------------------------------
-- 11. PARAMETERIZED QUERIES FOR FILTERS
-- -----------------------------------------------------------------------------
SELECT 
    DATE(block_timestamp) as burn_date,
    COUNT(*) as burn_count,
    SUM(amount) / 1e18 as total_burned,
    COUNT(DISTINCT user_address) as unique_burners
FROM xen_burns
WHERE DATE(block_timestamp) BETWEEN '{{start_date}}' AND '{{end_date}}'
GROUP BY DATE(block_timestamp)
ORDER BY burn_date;

-- User Address Filter Template (replace {{user_address}} in Metabase)
SELECT 
    block_timestamp,
    amount / 1e18 as amount,
    transaction_hash
FROM xen_burns
WHERE user_address = '{{user_address}}'
ORDER BY block_timestamp DESC;