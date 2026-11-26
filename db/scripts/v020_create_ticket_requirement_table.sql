create table "ticket_requirement" (
    "eventId" uuid not null references "event" ("id") on delete cascade,
    "ticket" text not null,
    "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
    "updatedAt" timestamptz default CURRENT_TIMESTAMP not null,
    primary key ("eventId", "ticket")
);
