create or replace function public.normalize_coros_activity_detail_fields()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  detail_text text;
  elevation_match text[];
begin
  if new.provider <> 'coros' or new.detail_provider_data is null then
    return new;
  end if;

  detail_text := new.detail_provider_data #>> '{}';
  if detail_text is null then
    return new;
  end if;

  if new.elevation_gain_m is null then
    elevation_match := regexp_match(
      detail_text,
      'Elevation Gain(?:\s*/\s*Loss)?\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*m',
      'i'
    );
    if elevation_match is not null then
      new.elevation_gain_m := elevation_match[1]::numeric;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists coros_activity_detail_normalizer on public.activities;
create trigger coros_activity_detail_normalizer
before insert or update of detail_provider_data on public.activities
for each row
execute function public.normalize_coros_activity_detail_fields();

update public.activities
set detail_provider_data = detail_provider_data
where provider = 'coros'
  and detail_fetched_at is not null
  and elevation_gain_m is null;
