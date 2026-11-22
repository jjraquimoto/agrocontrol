-- AgroControl 5.4: alterações incrementais transacionais por registro.
-- Requer schema.sql (5.0) e MIGRACAO_5_3.sql já aplicados.
-- Execute somente em projeto de TESTES após backup de cada fazenda.
-- Mantém farm_data e o acesso da versão 5.3; NÃO apaga dados.
begin;

-- A versão antiga continua a espelhar o JSON completo. A RPC 5.4, por sua vez,
-- atualiza somente as linhas alteradas e evita reconstruir o espelho inteiro.
create or replace function public.agro_farm_data_mirror_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if pg_catalog.current_setting('agro.incremental_write',true) = 'on' then
    return new;
  end if;
  perform public.agro_sync_normalized(new.farm_id,new.payload);
  return new;
end; $$;
revoke all on function public.agro_farm_data_mirror_trigger() from public,anon,authenticated;

create or replace function public.agro_apply_changes_v54(
  p_farm uuid, p_operations jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
  v_payload jsonb;
  v_revision bigint;
  v_op jsonb;
  v_type text;
  v_id text;
  v_expected jsonb;
  v_value jsonb;
  v_old jsonb;
  v_arr jsonb;
  v_new_arr jsonb;
  v_item jsonb;
  v_seen boolean;
  v_count integer := 0;
begin
  if auth.uid() is null then raise exception 'Login obrigatório'; end if;
  select role into v_role from public.farm_members
    where farm_id=p_farm and user_id=auth.uid();
  if coalesce(v_role,'') not in ('owner','manager','worker') then
    raise exception 'Sem permissão de edição nesta fazenda';
  end if;
  if pg_catalog.jsonb_typeof(p_operations) <> 'array'
     or pg_catalog.jsonb_array_length(p_operations)>200 then
    raise exception 'Lista de operações inválida ou muito grande (máximo 200)';
  end if;
  -- Bloqueio por fazenda: serializa todas as atualizações concorrentes, inclusive 5.3.
  select payload,revision into v_payload,v_revision from public.farm_data
    where farm_id=p_farm for update;
  if not found then raise exception 'Fazenda inexistente'; end if;
  for v_op in select value from pg_catalog.jsonb_array_elements(p_operations) loop
    v_type := v_op->>'type';
    v_id := v_op->>'id';
    v_expected := v_op->'expected';
    v_value := v_op->'value';
    if v_type not in ('lots','animals','health','production','movements')
       or v_id is null or pg_catalog.length(v_id) not between 1 and 128
       or not (v_op ? 'expected') or not (v_op ? 'value')
       or (v_value <> 'null'::jsonb and (pg_catalog.jsonb_typeof(v_value)<>'object' or v_value->>'id' is distinct from v_id))
    then raise exception 'Operação inválida'; end if;
    v_arr := v_payload->v_type;
    if pg_catalog.jsonb_typeof(v_arr) <> 'array' then raise exception 'Lista inválida: %',v_type;end if;
    select value into v_old from pg_catalog.jsonb_array_elements(v_arr)
      where value->>'id'=v_id limit 1;
    if not found then v_old := 'null'::jsonb;end if;
    if v_old is distinct from v_expected then
      raise exception 'CONFLITO_REGISTRO: % (%). Outro usuário alterou este registro.',v_type,v_id;
    end if;
    -- Impede múltiplos registros com o mesmo ID e alterações em massa implícitas.
    select coalesce(pg_catalog.jsonb_agg(value),'[]'::jsonb) into v_new_arr
      from pg_catalog.jsonb_array_elements(v_arr) where value->>'id'<>v_id;
    if v_value <> 'null'::jsonb then
      if v_type='animals' and (nullif(v_value->>'brinco','') is null or nullif(v_value->>'raca','') is null) then
        raise exception 'Animal precisa de brinco e raça';
      end if;
      if v_type='lots' and nullif(v_value->>'name','') is null then raise exception 'Lote sem nome';end if;
      if v_type in ('health','production','movements') and nullif(v_value->>'animalId','') is null then
        raise exception 'Registro sem animal';
      end if;
      v_new_arr := v_new_arr || pg_catalog.jsonb_build_array(v_value);
    end if;
    v_payload := pg_catalog.jsonb_set(v_payload,array[v_type],v_new_arr,false);
    -- Escrita pontual no espelho normalizado, preservando linhas não alteradas.
    if v_type='lots' then
      if v_value='null'::jsonb then delete from public.agro_lots where farm_id=p_farm and record_id=v_id;
      else insert into public.agro_lots(farm_id,record_id,name,details)
        values(p_farm,v_id,coalesce(v_value->>'name',''),v_value)
        on conflict(farm_id,record_id) do update set name=excluded.name,details=excluded.details; end if;
    elsif v_type='animals' then
      if v_value='null'::jsonb then delete from public.agro_animals where farm_id=p_farm and record_id=v_id;
      else insert into public.agro_animals(farm_id,record_id,tag,breed,status,lot_id,details)
        values(p_farm,v_id,coalesce(v_value->>'brinco',''),v_value->>'raca',v_value->>'status',nullif(v_value->>'lotId',''),v_value)
        on conflict(farm_id,record_id) do update set tag=excluded.tag,breed=excluded.breed,status=excluded.status,lot_id=excluded.lot_id,details=excluded.details; end if;
    elsif v_type='health' then
      if v_value='null'::jsonb then delete from public.agro_health where farm_id=p_farm and record_id=v_id;
      else insert into public.agro_health(farm_id,record_id,animal_id,procedure_name,procedure_date,next_date,details)
        values(p_farm,v_id,v_value->>'animalId',v_value->>'procedure',nullif(v_value->>'date','')::date,nullif(v_value->>'next','')::date,v_value)
        on conflict(farm_id,record_id) do update set animal_id=excluded.animal_id,procedure_name=excluded.procedure_name,procedure_date=excluded.procedure_date,next_date=excluded.next_date,details=excluded.details; end if;
    elsif v_type='production' then
      if v_value='null'::jsonb then delete from public.agro_production where farm_id=p_farm and record_id=v_id;
      else insert into public.agro_production(farm_id,record_id,animal_id,entry_type,entry_date,details)
        values(p_farm,v_id,v_value->>'animalId',v_value->>'type',nullif(v_value->>'date','')::date,v_value)
        on conflict(farm_id,record_id) do update set animal_id=excluded.animal_id,entry_type=excluded.entry_type,entry_date=excluded.entry_date,details=excluded.details; end if;
    elsif v_type='movements' then
      if v_value='null'::jsonb then delete from public.agro_movements where farm_id=p_farm and record_id=v_id;
      else insert into public.agro_movements(farm_id,record_id,animal_id,movement_type,movement_date,details)
        values(p_farm,v_id,v_value->>'animalId',v_value->>'type',nullif(v_value->>'date','')::date,v_value)
        on conflict(farm_id,record_id) do update set animal_id=excluded.animal_id,movement_type=excluded.movement_type,movement_date=excluded.movement_date,details=excluded.details; end if;
    end if;
    v_count:=v_count+1;
  end loop;
  -- Checagens de integridade após aplicar o lote completo de alterações.
  if exists(select 1 from pg_catalog.jsonb_array_elements(v_payload->'animals') a
    where a->>'lotId' is not null and a->>'lotId'<>'' and not exists(
      select 1 from pg_catalog.jsonb_array_elements(v_payload->'lots') l where l->>'id'=a->>'lotId')) then
    raise exception 'Animal vinculado a lote inexistente';
  end if;
  if exists(select 1 from (
    select lower(trim(a->>'brinco')) as tag, count(*) as n
    from pg_catalog.jsonb_array_elements(v_payload->'animals') a group by 1
  ) t where n>1) then raise exception 'Brincos duplicados na fazenda'; end if;
  if exists(select 1 from (
    select lower(trim(l->>'name')) as name, count(*) as n
    from pg_catalog.jsonb_array_elements(v_payload->'lots') l group by 1
  ) t where n>1) then raise exception 'Lotes duplicados na fazenda'; end if;
  if exists(select 1 from (
    select x->>'animalId' as animal_id from pg_catalog.jsonb_array_elements(v_payload->'health') x
    union all select x->>'animalId' from pg_catalog.jsonb_array_elements(v_payload->'production') x
    union all select x->>'animalId' from pg_catalog.jsonb_array_elements(v_payload->'movements') x
  ) r where not exists(select 1 from pg_catalog.jsonb_array_elements(v_payload->'animals') a where a->>'id'=r.animal_id)) then
    raise exception 'Histórico vinculado a animal inexistente';
  end if;
  if v_count>0 then
    if pg_catalog.octet_length(v_payload::text)>5000000 then
      raise exception 'Esta fase ainda possui limite transitório de 5 MB por fazenda';
    end if;
    perform pg_catalog.set_config('agro.incremental_write','on',true);
    update public.farm_data set payload=v_payload,revision=revision+1,
       updated_at=now(),updated_by=auth.uid() where farm_id=p_farm
       returning revision into v_revision;
    perform pg_catalog.set_config('agro.incremental_write','off',true);
  end if;
  return pg_catalog.jsonb_build_object('payload',v_payload,'revision',v_revision);
end; $$;
revoke all on function public.agro_apply_changes_v54(uuid,jsonb) from public,anon;
grant execute on function public.agro_apply_changes_v54(uuid,jsonb) to authenticated;
commit;
