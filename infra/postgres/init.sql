-- TTR POC — starter schema. Mirrors tasks/prd/03-data-model.md (incl. the reviewed fixes).
-- Applied automatically by the postgres container on first boot. SYNTHETIC DATA ONLY.

create extension if not exists "pgcrypto";

-- The autónomo / micro-carrier business (ICP-screen fields, dossier §8).
create table carrier (
  id                  uuid primary key default gen_random_uuid(),
  legal_name          text not null,
  nif_cif             text,
  vat_regime          text,                       -- e.g. 'estimacion_directa'
  province            text,
  fleet_size          int,
  intl_runner         boolean default false,
  gasoleo_censo_status text,                       -- trust-hook enrolment (PRD 05)
  status              text default 'active',
  created_at          timestamptz default now()
);

-- The forwarding identity; often == carrier owner.
create table driver (
  id                  uuid primary key default gen_random_uuid(),
  carrier_id          uuid references carrier(id) on delete cascade,
  name                text,
  registered_email    text,
  forwarding_address  text unique not null,
  onboarding_stage    text default 'signed',
  created_at          timestamptz default now()
);

-- The G2 make-or-break record (apoderamiento / colaborador social).
create table authorization_grant (
  id          uuid primary key default gen_random_uuid(),
  driver_id   uuid references driver(id) on delete cascade,
  type        text check (type in ('apoderamiento','colaborador_social')),
  cert_type   text check (cert_type in ('FNMT','Clave')),
  status      text check (status in ('requested','granted','verified')) default 'requested',
  evidence_ref text,
  granted_at  timestamptz,
  unique (driver_id, type)          -- one live grant per (driver, type); enables ON CONFLICT upsert
);

-- One attachment = one Document (emails carry several); asesor_upload = the historical backlog.
create table document (
  id                uuid primary key default gen_random_uuid(),
  driver_id         uuid references driver(id) on delete cascade,
  r2_key            text not null,
  from_addr         text,
  to_addr           text,
  message_id        text not null,
  attachment_index  int not null default 0,
  subject           text,
  mime              text,
  size_bytes        bigint,
  source            text check (source in ('forwarded','asesor_upload')) default 'forwarded',
  status            text check (status in
                      ('received','processing','ready_for_review','reviewed','claimed','extraction_failed'))
                      default 'received',
  received_at       timestamptz default now(),
  unique (message_id, attachment_index)
);

-- LLM output + asesor corrections (= accuracy ground truth). fields jsonb holds line_items[] too.
create table extraction (
  id                uuid primary key default gen_random_uuid(),
  document_id       uuid references document(id) on delete cascade,
  fields            jsonb,
  confidence        jsonb,
  model             text,
  corrected_fields  jsonb,
  status            text default 'ready_for_review',
  created_at        timestamptz default now()
);

-- Human-assembled. POC files foreign_vat (disposition='file'); gasóleo='assure'; excise/dietas='identify_only'.
create table claim (
  id              uuid primary key default gen_random_uuid(),
  carrier_id      uuid references carrier(id) on delete cascade,
  type            text check (type in ('foreign_vat','excise','dietas')),
  disposition     text check (disposition in ('file','assure','identify_only')),
  country         text,
  period          text,
  document_ids    uuid[] default '{}',
  recoverable_eur numeric(12,2),
  asesor_minutes  int,                              -- cost-to-serve input (PRD 06)
  status          text check (status in ('draft','ready','blocked','filed')) default 'draft',
  blocked_reason  text,
  created_at      timestamptz default now()
);

-- Records the human filing — POC = modelo 360 only, for disposition='file' claims. Drives "€ filed".
create table filing (
  id            uuid primary key default gen_random_uuid(),
  claim_id      uuid references claim(id) on delete cascade,
  form          text default 'modelo_360',
  method        text default 'colaboracion_social',
  aeat_reference text,
  submitted_by  text,
  submitted_at  timestamptz,
  status        text default 'submitted'
);

-- Append-only event stream for the four-gate dashboard (PRD 06). Measure filed, not paid.
create table metric_event (
  id          uuid primary key default gen_random_uuid(),
  type        text not null,                        -- carrier_signed, authorization_granted, first_doc_received, ...
  carrier_id  uuid,
  driver_id   uuid,
  document_id uuid,
  claim_id    uuid,
  payload     jsonb,
  created_at  timestamptz default now()
);

create index on document (driver_id);
create index on document (status);
create unique index on extraction (document_id);
create index on claim (carrier_id);
create index on metric_event (type, created_at);
