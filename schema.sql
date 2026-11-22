-- AgroControl 5.0: MVP com dados versionados por propriedade.
-- Execute no SQL Editor de um projeto Supabase de TESTE.
-- Rode uma vez; versões futuras devem usar migrações separadas.

create extension if not exists pgcrypto;

create table if not exists public.farms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table if not exists public.farm_members (
  farm_id uuid not null references public.farms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','manager','worker','viewer')),
  created_at timestamptz not null default now(),
  primary key (farm_id,user_id)
);
create index if not exists farm_members_user_idx on public.farm_members(user_id);
create table if not exists public.farm_data (
  farm_id uuid primary key references public.farms(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  payload jsonb not null default '{"version":4,"animals":[],"lots":[],"health":[],"production":[],"movements":[]}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  constraint payload_object check (jsonb_typeof(payload)='object')
);

alter table public.farms enable row level security;
alter table public.farm_members enable row level security;
alter table public.farm_data enable row level security;

-- Sem acesso direto de escrita: todas as alterações ocorrem pelas funções com verificações.
revoke all on public.farms, public.farm_members, public.farm_data from anon, authenticated;
grant select on public.farms, public.farm_members, public.farm_data to authenticated;

-- Baseamos as consultas em owner_id e não fazemos subconsulta recursiva em farm_members.
create or replace function public.is_farm_member(p_farm uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.farm_members m where m.farm_id=p_farm and m.user_id=(select auth.uid()));
$$;
revoke all on function public.is_farm_member(uuid) from public, anon;
grant execute on function public.is_farm_member(uuid) to authenticated;

create policy "farm_read" on public.farms for select to authenticated
 using (public.is_farm_member(id));
create policy "member_read" on public.farm_members for select to authenticated
 using (public.is_farm_member(farm_id));
create policy "farm_data_read" on public.farm_data for select to authenticated
 using (public.is_farm_member(farm_id));

create or replace function public.create_agro_farm(p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Autenticação obrigatória'; end if;
  if p_name is null or char_length(trim(p_name)) not between 2 and 120 then
    raise exception 'Nome da fazenda deve ter entre 2 e 120 caracteres';
  end if;
  insert into public.farms(name,owner_id) values(trim(p_name),v_user) returning id into v_id;
  insert into public.farm_members(farm_id,user_id,role) values(v_id,v_user,'owner');
  insert into public.farm_data(farm_id,updated_by) values(v_id,v_user);
  return v_id;
end; $$;
revoke all on function public.create_agro_farm(text) from public, anon;
grant execute on function public.create_agro_farm(text) to authenticated;

-- Atualização atômica com controle de revisão. Conflitos NÃO sobrescrevem registros de outros dispositivos.
create or replace function public.save_agro_data(p_farm uuid, p_expected_revision bigint, p_payload jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_role text; v_revision bigint;
begin
  if auth.uid() is null then raise exception 'Autenticação obrigatória'; end if;
  select role into v_role from public.farm_members
   where farm_id=p_farm and user_id=auth.uid();
  if coalesce(v_role,'') not in ('owner','manager','worker') then
    raise exception 'Usuário sem permissão de edição';
  end if;
  if jsonb_typeof(p_payload) <> 'object'
     or jsonb_typeof(p_payload->'animals') <> 'array'
     or jsonb_typeof(p_payload->'lots') <> 'array'
     or jsonb_typeof(p_payload->'health') <> 'array'
     or jsonb_typeof(p_payload->'production') <> 'array'
     or jsonb_typeof(p_payload->'movements') <> 'array' then
    raise exception 'Estrutura de dados inválida';
  end if;
  -- Limite por operação: evita payload excessivo. Não é arquitetura final para alto volume.
  if octet_length(p_payload::text) > 5000000 then
    raise exception 'Base de dados excedeu 5 MB; migre para tabelas por registro';
  end if;
  update public.farm_data set payload=p_payload, revision=revision+1,
    updated_at=now(), updated_by=auth.uid()
   where farm_id=p_farm and revision=p_expected_revision
   returning revision into v_revision;
  if v_revision is null then raise exception 'CONFLITO_VERSAO: dados foram alterados em outro dispositivo'; end if;
  return v_revision;
end; $$;
revoke all on function public.save_agro_data(uuid,bigint,jsonb) from public, anon;
grant execute on function public.save_agro_data(uuid,bigint,jsonb) to authenticated;

-- Adiciona colaborador já cadastrado no Auth; só o proprietário pode conceder acesso.
create or replace function public.add_agro_member(p_farm uuid,p_email text,p_role text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.farms where id=p_farm and owner_id=auth.uid()
  ) then raise exception 'Somente o proprietário pode convidar'; end if;
  if p_role not in ('manager','worker','viewer') then raise exception 'Permissão inválida'; end if;
  select id into v_user from auth.users where lower(email)=lower(trim(p_email)) limit 1;
  if v_user is null then raise exception 'Usuário não encontrado: ele deve criar e confirmar a conta primeiro'; end if;
  insert into public.farm_members(farm_id,user_id,role)
  values(p_farm,v_user,p_role)
  on conflict(farm_id,user_id) do update set role=excluded.role
  where public.farm_members.role <> 'owner';
  return 'Acesso concedido';
end; $$;
revoke all on function public.add_agro_member(uuid,text,text) from public, anon;
grant execute on function public.add_agro_member(uuid,text,text) to authenticated;

-- OBS: Para operação comercial de grande escala, use tabelas normalizadas por animal,
-- procedimento e movimentação, com RLS, auditoria e sincronização por registro.
