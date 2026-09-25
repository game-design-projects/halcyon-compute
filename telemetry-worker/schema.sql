CREATE TABLE IF NOT EXISTS batches (
  session TEXT NOT NULL,
  seq INTEGER NOT NULL,
  player TEXT,
  seed INTEGER,
  build TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  items TEXT NOT NULL,              -- JSON array of telemetry items
  PRIMARY KEY (session, seq)
);
CREATE INDEX IF NOT EXISTS batches_received ON batches (received_at);
CREATE INDEX IF NOT EXISTS batches_player ON batches (player);
