create or replace function public.normalize_coros_activity_detail_fields()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  raw_text text;
  aerobic_text text;
  anaerobic_text text;
  elevation_text text;
begin
  if new.provider <> 'coros' or new.detail_provider_data is null or new.detail_provider_data = '{}'::jsonb then
    return new;
  end if;

  raw_text := new.detail_provider_data::text;

  aerobic_text := substring(raw_text from 'Aerobic TE: ([0-9.]+)');
  anaerobic_text := substring(raw_text from 'Anaerobic TE: ([0-9.]+)');
  elevation_text := substring(raw_text from 'Elevation Gain / Loss: ([0-9.]+) m');

  if aerobic_text is not null or anaerobic_text is not null then
    new.training_effect := jsonb_strip_nulls(jsonb_build_object(
      'aerobic_te', case when aerobic_text is not null then aerobic_text::numeric else null end,
      'anaerobic_te', case when anaerobic_text is not null then anaerobic_text::numeric else null end
    ));
  end if;

  if new.elevation_gain_m is null and elevation_text is not null then
    new.elevation_gain_m := elevation_text::numeric;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_normalize_coros_activity_detail_fields on public.activities;
create trigger trg_normalize_coros_activity_detail_fields
before insert or update of detail_provider_data on public.activities
for each row execute function public.normalize_coros_activity_detail_fields();
