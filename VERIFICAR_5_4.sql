-- Diagnóstico: deve indicar true para cada fazenda (executar como dono do projeto).
select f.id as fazenda_id, f.name as fazenda,
  d.revision,
  jsonb_array_length(d.payload->'animals') = (select count(*) from public.agro_animals a where a.farm_id=f.id) as animais_ok,
  jsonb_array_length(d.payload->'lots') = (select count(*) from public.agro_lots a where a.farm_id=f.id) as lotes_ok,
  jsonb_array_length(d.payload->'health') = (select count(*) from public.agro_health a where a.farm_id=f.id) as sanidade_ok,
  jsonb_array_length(d.payload->'production') = (select count(*) from public.agro_production a where a.farm_id=f.id) as producao_ok,
  jsonb_array_length(d.payload->'movements') = (select count(*) from public.agro_movements a where a.farm_id=f.id) as movimentacoes_ok
from public.farms f join public.farm_data d on d.farm_id=f.id
order by f.name;
