-- 0005_fms_device_registry.sql
-- FMS P2B — Device Registry (vendor-agnostic).
--
-- ARCHITECTURE RULE: FMC650 adalah DEVICE #1, bukan arsitektur FMS.
-- Vendor/model/protokol disimpan sebagai DATA, bukan kode.
-- Interpretasi spesifik perangkat BERHENTI di adapter/source boundary.
-- Downstream (Fleet UI, Geofence Engine, Cycle Engine, CCR, kontrak MEI)
-- tidak boleh mengetahui vendor perangkat.
--
-- Pemetaan vendor -> canonical source_type dilakukan lewat kolom source_type
-- yang nilainya HARUS salah satu anggota union FmsSourceType
-- (lib/fms/canonical-event.ts) — union itu tidak diperluas di sini.
--
-- Tidak mengubah tabel/semantik Phase 2/3A/3B/3C. Murni aditif.

CREATE TABLE IF NOT EXISTS fms_devices (
  id                  text PRIMARY KEY,
  unit_id             text,
  unit                varchar(64),
  vendor              varchar(32)  NOT NULL,
  model               varchar(32),
  unique_id           varchar(64)  NOT NULL,
  protocol            varchar(32)  NOT NULL,
  transport           varchar(8)   NOT NULL DEFAULT 'tcp',
  traccar_device_id   integer,
  traccar_unique_id   varchar(64),
  source_type         varchar(32)  NOT NULL DEFAULT 'FMC650/Traccar',
  source_name         varchar(64),
  is_simulator        boolean      NOT NULL DEFAULT false,
  activation_state    varchar(16)  NOT NULL DEFAULT 'registered',
  first_packet_at     timestamp with time zone,
  last_packet_at      timestamp with time zone,
  notes               text,
  created_at          timestamp with time zone NOT NULL DEFAULT now(),
  updated_at          timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT fms_devices_unique_id_unique UNIQUE (unique_id),
  CONSTRAINT fms_devices_traccar_device_id_unique UNIQUE (traccar_device_id),
  CONSTRAINT fms_devices_activation_state_chk
    CHECK (activation_state IN ('registered','active','suspended','retired')),
  CONSTRAINT fms_devices_transport_chk
    CHECK (transport IN ('tcp','udp','http'))
);

CREATE INDEX IF NOT EXISTS idx_fms_devices_unit  ON fms_devices (unit);
CREATE INDEX IF NOT EXISTS idx_fms_devices_state ON fms_devices (activation_state);
CREATE INDEX IF NOT EXISTS idx_fms_devices_vendor ON fms_devices (vendor, model);

COMMENT ON TABLE fms_devices IS
  'Registry perangkat FMS (vendor-agnostic). Device-specific interpretation berhenti di adapter/source boundary.';
COMMENT ON COLUMN fms_devices.unique_id IS
  'Identitas perangkat seperti dilaporkan protokol (mis. IMEI Teltonika). Kunci idempoten saat onboarding.';
COMMENT ON COLUMN fms_devices.protocol IS
  'Nama protocol handler Traccar (mis. teltonika, osmand) — nilai DATA, bukan cabang kode.';
COMMENT ON COLUMN fms_devices.source_type IS
  'HARUS salah satu anggota union FmsSourceType di lib/fms/canonical-event.ts.';
COMMENT ON COLUMN fms_devices.is_simulator IS
  'true = perangkat simulator. Simulator wajib tetap bekerja setelah registry aktif.';
COMMENT ON COLUMN fms_devices.first_packet_at IS
  'Bukti kapan paket pertama diterima dari perangkat ini. NULL = belum pernah ada paket.';
