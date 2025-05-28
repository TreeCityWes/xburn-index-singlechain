# Metabase Setup Guide

## Accessing Metabase

1. Open your browser and go to: http://localhost:3001
2. First time setup:
   - Click "Let's get started"
   - Create your admin account
   - When asked about database, select "I'll add my data later"

## Connecting to the XBURN Database

1. Go to Settings (gear icon) → Admin Settings
2. Click on "Databases" → "Add database"
3. Fill in the connection details:
   - Database type: PostgreSQL
   - Display name: XBURN Index
   - Host: postgres
   - Port: 5432
   - Database name: xburn_index
   - Username: postgres
   - Password: postgres
4. Click "Save"

## Pre-built Queries

Here are some useful queries you can create in Metabase:

### 1. Total XEN Burned Dashboard
```sql
SELECT * FROM total_xen_burned;
```

### 2. Top 10 XEN Burners
```sql
SELECT * FROM top_xen_burners LIMIT 10;
```

### 3. Daily Burn Activity
```sql
SELECT * FROM daily_burn_activity ORDER BY burn_date DESC;
```

### 4. Emergency End Stakes Count
```sql
SELECT COUNT(*) as emergency_ends_count FROM emergency_ends;
```

### 5. Active Burn Locks
```sql
SELECT * FROM active_burn_locks;
```

### 6. Matured Burn Locks
```sql
SELECT * FROM matured_burn_locks;
```

### 7. Claimed vs Unclaimed Locks
```sql
SELECT * FROM claimed_vs_unclaimed_locks;
```

### 8. Average Lock Duration
```sql
SELECT * FROM average_lock_duration;
```

## Creating Dashboards

1. Click "New" → "Dashboard"
2. Add questions (queries) to your dashboard
3. Arrange and resize widgets as needed
4. Save your dashboard

## Recommended Dashboard Layout

1. **Overview Section**
   - Total XEN Burned (Big Number)
   - Total Unique Burners (Big Number)
   - Total Burns Count (Big Number)
   - Emergency Ends Count (Big Number)

2. **Top Burners Section**
   - Top 10 Burners (Table)
   - Burn Distribution (Pie Chart)

3. **Activity Section**
   - Daily Burn Activity (Line Chart)
   - Recent Burns (Table)

4. **Lock Status Section**
   - Active vs Matured Locks (Pie Chart)
   - Claimed vs Unclaimed (Bar Chart)
   - Average Lock Duration (Gauge)

## Auto-refresh

To keep your dashboard updated:
1. Click the refresh icon in the top right
2. Select auto-refresh interval (e.g., 1 minute)

## Tips

- Use filters to allow date range selection
- Pin important dashboards to the home page
- Set up alerts for significant events
- Export dashboards as PDFs for reports 