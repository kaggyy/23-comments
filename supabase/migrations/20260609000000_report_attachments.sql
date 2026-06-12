ALTER TABLE reports
  ADD COLUMN attachment_paths text[] NOT NULL DEFAULT '{}';
