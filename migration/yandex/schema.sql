-- Initial staging schema for the isolated YDB migration PoC.
-- Preserve Firebase records before normalizing domain tables.
-- Do not run against production until a separate Yandex test database exists.
CREATE TABLE app_records (
    collection Utf8 NOT NULL,
    record_id Utf8 NOT NULL,
    payload Utf8 NOT NULL,
    source_updated_at Uint64,
    imported_at Uint64 NOT NULL,
    PRIMARY KEY (collection, record_id)
);

CREATE TABLE migration_batches (
    batch_id Utf8 NOT NULL,
    source_name Utf8 NOT NULL,
    record_count Uint64 NOT NULL,
    redacted_record_count Uint64 NOT NULL,
    started_at Uint64 NOT NULL,
    completed_at Uint64,
    status Utf8 NOT NULL,
    PRIMARY KEY (batch_id)
);
