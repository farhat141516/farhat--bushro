CREATE TABLE IF NOT EXISTS site_content (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  content JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS site_media (
  filename VARCHAR(80) PRIMARY KEY,
  content_type VARCHAR(30) NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);