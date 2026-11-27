create table "account_ticket" (
    "accountId" text not null,
    "ticket" text not null,
    "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
    "updatedAt" timestamptz default CURRENT_TIMESTAMP not null,
    primary key ("accountId", "ticket")
);

CREATE TYPE sync_status AS ENUM ('success', 'timeout', 'refused');

create table "ticket_sync_history" (
    "id" uuid not null primary key default uuid_generate_v4(),
    "provider" text not null,
    "status" sync_status not null,
    "createdAt" timestamptz default CURRENT_TIMESTAMP not null
)
