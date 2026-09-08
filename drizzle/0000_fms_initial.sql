CREATE TABLE IF NOT EXISTS `fms_units` (
  `id` text PRIMARY KEY NOT NULL,
  `unit` text NOT NULL,
  `tipe_unit` text,
  `no_unit_scm` text,
  `factory` text,
  `traccar_device_id` integer,
  `active` integer DEFAULT 1 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS `fms_units_unit_unique` ON `fms_units` (`unit`);
CREATE UNIQUE INDEX IF NOT EXISTS `fms_units_traccar_device_id_unique` ON `fms_units` (`traccar_device_id`);

CREATE TABLE IF NOT EXISTS `fms_shift_assignments` (
  `id` text PRIMARY KEY NOT NULL,
  `tanggal` text NOT NULL,
  `shift` text NOT NULL,
  `site_project` text,
  `loader` text,
  `operator_loader` text,
  `hauler` text NOT NULL,
  `operator_hauler` text,
  `loading_point` text,
  `dumping_point` text,
  `material` text,
  `status_assignment` text DEFAULT 'ASSIGNED' NOT NULL,
  `source_name` text DEFAULT 'Digital Shift Board' NOT NULL,
  `created_by` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE INDEX IF NOT EXISTS `idx_fms_shift_assignments_tanggal_shift` ON `fms_shift_assignments` (`tanggal`,`shift`);
CREATE INDEX IF NOT EXISTS `idx_fms_shift_assignments_hauler` ON `fms_shift_assignments` (`hauler`);

CREATE TABLE IF NOT EXISTS `fms_p2h_checks` (
  `id` text PRIMARY KEY NOT NULL,
  `shift_assignment_id` text,
  `tanggal` text NOT NULL,
  `shift` text NOT NULL,
  `nama_operator` text,
  `nrp` text,
  `unit` text NOT NULL,
  `hm_awal` real,
  `km_awal` real,
  `checklist_json` text NOT NULL,
  `remarks` text,
  `keputusan_p2h` text NOT NULL,
  `keputusan_oleh` text,
  `source_name` text DEFAULT 'Digital P2H' NOT NULL,
  `created_at` text NOT NULL
);
CREATE INDEX IF NOT EXISTS `idx_fms_p2h_tanggal_shift_unit` ON `fms_p2h_checks` (`tanggal`,`shift`,`unit`);

CREATE TABLE IF NOT EXISTS `fms_canonical_events` (
  `event_id` text PRIMARY KEY NOT NULL,
  `event_type` text NOT NULL,
  `waktu` text NOT NULL,
  `tanggal_operasional` text NOT NULL,
  `shift` text,
  `unit` text,
  `operator` text,
  `source_type` text NOT NULL,
  `source_name` text NOT NULL,
  `authority_status` text NOT NULL,
  `payload_json` text NOT NULL,
  `source_record_id` text,
  `received_at` text NOT NULL,
  `record_status` text NOT NULL
);
CREATE INDEX IF NOT EXISTS `idx_fms_events_unit_waktu` ON `fms_canonical_events` (`unit`,`waktu`);
CREATE INDEX IF NOT EXISTS `idx_fms_events_tanggal_shift` ON `fms_canonical_events` (`tanggal_operasional`,`shift`);
CREATE INDEX IF NOT EXISTS `idx_fms_events_type` ON `fms_canonical_events` (`event_type`);

CREATE TABLE IF NOT EXISTS `fms_hourly_control` (
  `id` text PRIMARY KEY NOT NULL,
  `tanggal` text NOT NULL,
  `shift` text NOT NULL,
  `hour_bucket` text NOT NULL,
  `loader` text,
  `unit` text,
  `plan` real,
  `actual` real,
  `ritasi` real,
  `status_unit` text,
  `working_hours` real,
  `standby_hours` real,
  `delay_hours` real,
  `breakdown_hours` real,
  `rain_hours` real,
  `slippery_hours` real,
  `waiting_fuel_hours` real,
  `data_status` text DEFAULT 'PROVISIONAL' NOT NULL,
  `updated_at` text NOT NULL
);
CREATE INDEX IF NOT EXISTS `idx_fms_hourly_tanggal_shift_hour` ON `fms_hourly_control` (`tanggal`,`shift`,`hour_bucket`);
CREATE INDEX IF NOT EXISTS `idx_fms_hourly_unit` ON `fms_hourly_control` (`unit`);
