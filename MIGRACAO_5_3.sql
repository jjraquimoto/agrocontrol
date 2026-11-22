-- AgroControl 5.3 - ETAPA 1: espelho relacional de registros.
-- Execute apenas DEPOIS de exportar backup JSON de todas as fazendas.
-- Compatível com schema.sql 5.0/5.2. Não remove farm_data nem altera sua API.
-- Use o SQL Editor com o projeto correto. Toda migração é transacional.
begin;
lock table public.farm_data in share row exclusive mode;

create table if not exists public.agro_lots (
  farm_id uuid not null references public.farms(id) on delete cascade,
  record_id text not null,
  name text not null,
  details jsonb not null,
  primary key (farm_id,record_id)
);
create table if not exists public.agro_animals (
  farm_id uuid not null references public.farms(id) on delete cascade,
  record_id text not null,
  tag text not null,
  breed text,
  status text,
  lot_id text,
  details jsonb not null,
  primary key (farm_id,record_id)
);
create table if not exists public.agro_health (
  farm_id uuid not null references public.farms(id) on delete cascade,
  record_id text not null,
  animal_id text not null,
  procedure_name text,
  procedure_date date,
  next_date date,
  details jsonb not null,
  primary key (farm_id,record_id)
);
create table if not exists public.agro_production (
  farm_id uuid not null references public.farms(id) on delete cascade,
  record_id text not null,
  animal_id text not null,
  entry_type text,
  entry_date date,
  details jsonb not null,
  primary key (farm_id,record_id)
);
create table if not exists public.agro_movements (
  farm_id uuid not null references public.farms(id) on delete cascade,
  record_id text not null,
  animal_id text not null,
  movement_type text,
  movement_date date,
  details jsonb not null,
  primary key (farm_id,record_id)
);

create index if not exists agro_animals_farm_tag_idx on public.agro_animals(farm_id,tag);
create index if not exists agro_animals_farm_lot_idx on public.agro_animals(farm_id,lot_id);
create index if not exists agro_health_animal_date_idx on public.agro_health(farm_id,animal_id,procedure_date desc);
create index if not exists agro_health_next_date_idx on public.agro_health(farm_id,next_date);
create index if not exists agro_production_animal_date_idx on public.agro_production(farm_id,animal_id,entry_date desc);
create index if not exists agro_movements_animal_date_idx on public.agro_movements(farm_id,animal_id,movement_date desc);

-- Clientes autenticados têm somente leitura, isolada por propriedade.
-- Escrita nas tabelas espelho é EXCLUSIVA do trigger executado no banco.
alter table public.agro_lots enable row level security;
alter table public.agro_animals enable row level security;
alter table public.agro_health enable row level security;
alter table public.agro_production enable row level security;
alter table public.agro_movements enable row level security;
revoke all on public.agro_lots,public.agro_animals,public.agro_health,public.agro_production,public.agro_movements from anon,authenticated;
grant select on public.agro_lots,public.agro_animals,public.agro_health,public.agro_production,public.agro_movements to authenticated;

drop policy if exists agro_lots_member_read on public.agro_lots;
create policy agro_lots_member_read on public.agro_lots for select to authenticated using (public.is_farm_member(farm_id));
drop policy if exists agro_animals_member_read on public.agro_animals;
create policy agro_animals_member_read on public.agro_animals for select to authenticated using (public.is_farm_member(farm_id));
drop policy if exists agro_health_member_read on public.agro_health;
create policy agro_health_member_read on public.agro_health for select to authenticated using (public.is_farm_member(farm_id));
drop policy if exists agro_production_member_read on public.agro_production;
create policy agro_production_member_read on public.agro_production for select to authenticated using (public.is_farm_member(farm_id));
drop policy if exists agro_movements_member_read on public.agro_movements;
create policy agro_movements_member_read on public.agro_movements for select to authenticated using (public.is_farm_member(farm_id));

-- Espelhamento transitório: preserva IDs e conteúdo integral de cada registro.
-- NÃO é o mecanismo final de sincronização incremental: a cada salvamento reconstrói o espelho desta fazenda.
create or replace function public.agro_sync_normalized(p_farm uuid, p_payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if pg_catalog.jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Payload invalido para espelhamento';
  end if;
  -- Retira registros desta fazenda, preservando os de todas as outras.
  delete from public.agro_health where farm_id=p_farm;
  delete from public.agro_production where farm_id=p_farm;
  delete from public.agro_movements where farm_id=p_farm;
  delete from public.agro_animals where farm_id=p_farm;
  delete from public.agro_lots where farm_id=p_farm;

  insert into public.agro_lots(farm_id,record_id,name,details)
  select p_farm, v->>'id', coalesce(v->>'name',''),v
    from pg_catalog.jsonb_array_elements(coalesce(p_payload->'lots','[]'::jsonb)) v;
  insert into public.agro_animals(farm_id,record_id,tag,breed,status,lot_id,details)
  select p_farm,v->>'id',coalesce(v->>'brinco',''),v->>'raca',v->>'status',nullif(v->>'lotId',''),v
    from pg_catalog.jsonb_array_elements(coalesce(p_payload->'animals','[]'::jsonb)) v;
  insert into public.agro_health(farm_id,record_id,animal_id,procedure_name,procedure_date,next_date,details)
  select p_farm,v->>'id',coalesce(v->>'animalId',''),v->>'procedure',nullif(v->>'date','')::date,nullif(v->>'next','')::date,v
    from pg_catalog.jsonb_array_elements(coalesce(p_payload->'health','[]'::jsonb)) v;
  insert into public.agro_production(farm_id,record_id,animal_id,entry_type,entry_date,details)
  select p_farm,v->>'id',coalesce(v->>'animalId',''),v->>'type',nullif(v->>'date','')::date,v
    from pg_catalog.jsonb_array_elements(coalesce(p_payload->'production','[]'::jsonb)) v;
  insert into public.agro_movements(farm_id,record_id,animal_id,movement_type,movement_date,details)
  select p_farm,v->>'id',coalesce(v->>'animalId',''),v->>'type',nullif(v->>'date','')::date,v
    from pg_catalog.jsonb_array_elements(coalesce(p_payload->'movements','[]'::jsonb)) v;
end;
$$;
revoke all on function public.agro_sync_normalized(uuid,jsonb) from public,anon,authenticated;

create or replace function public.agro_farm_data_mirror_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.agro_sync_normalized(new.farm_id,new.payload);
  return new;
end;
$$;
revoke all on function public.agro_farm_data_mirror_trigger() from public,anon,authenticated;
drop trigger if exists agro_farm_data_mirror on public.farm_data;
create trigger agro_farm_data_mirror
  after insert or update of payload on public.farm_data
  for each row execute function public.agro_farm_data_mirror_trigger();

-- Popula os espelhos com os dados que JÁ estão na nuvem.
do $$ declare r record; begin
  for r in select farm_id,payload from public.farm_data loop
    perform public.agro_sync_normalized(r.farm_id,r.payload);
  end loop;
end $$;
commit;
