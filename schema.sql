DROP TABLE IF EXISTS queue;
CREATE TABLE queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT,
  discord TEXT,
  handle TEXT,
  region TEXT,
  role_class TEXT,
  status TEXT DEFAULT 'WAITING',
  pod_name TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
