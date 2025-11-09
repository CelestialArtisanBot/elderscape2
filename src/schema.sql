-- players table
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  race TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  last_login INTEGER DEFAULT (strftime('%s', 'now')),
  subscription_expires INTEGER DEFAULT 0
);

-- player_stats table
CREATE TABLE IF NOT EXISTS player_stats (
  player_id TEXT PRIMARY KEY,
  level INTEGER DEFAULT 1,
  total_xp INTEGER DEFAULT 0,
  fatigue INTEGER DEFAULT 0,
  health INTEGER DEFAULT 100,
  location_x REAL DEFAULT 0.0,
  location_y REAL DEFAULT 0.0,
  location_z REAL DEFAULT 0.0,
  coins INTEGER DEFAULT 0, -- Added coins as per frontend
  skills_json TEXT, -- JSON blob of all skill levels/XP
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

-- world_zones table
CREATE TABLE IF NOT EXISTS world_zones (
  id TEXT PRIMARY KEY,
  first_discoverer TEXT,
  discovered_at INTEGER DEFAULT (strftime('%s', 'now')),
  geographic_coords TEXT, -- Real-world lat/long (e.g., "lat,long")
  biome_type TEXT,
  folklore_region TEXT,
  generated_content TEXT, -- JSON blob of NPCs, resources, quests
  FOREIGN KEY (first_discoverer) REFERENCES players(id) ON DELETE SET NULL
);
