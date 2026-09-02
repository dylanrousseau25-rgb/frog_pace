create or replace function public.normalize_coros_activity_from_raw()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  txt text;
  safe_id text;
  m text[];
  body text;
  tm text[];
  dm text[];
  dur text[];
  pace text[];
  speed text[];
  hr text[];
  st integer;
begin
  if new.provider <> 'coros' or new.raw_provider_data is null then
    return new;
  end if;

  txt := new.raw_provider_data ->> 'text';
  if txt is null or txt = '' then
    return new;
  end if;

  safe_id := regexp_replace(coalesce(new.provider_activity_id, ''), '[^A-Za-z0-9_-]', '', 'g');
  if safe_id = '' then
    return new;
  end if;

  m := regexp_match(
    txt,
    '(?:^|\n)\s*[0-9]+\.\s+([^\n]+?)\s+—\s+(20[0-9]{2}-[0-9]{2}-[0-9]{2})\n(.*?)(?:LabelId|labelId)\s*[:=]\s*' || safe_id || '\s*\|\s*SportType\s*[:=]\s*([0-9]+)',
    's'
  );

  if m is null then
    return new;
  end if;

  body := m[3];
  st := nullif(m[4], '')::integer;
  new.sport_type := st;
  new.sport := case st
    when 100 then 'Course'
    when 101 then 'Course tapis'
    when 102 then 'Trail'
    when 103 then 'Piste'
    when 104 then 'Randonnée'
    when 105 then 'Alpinisme'
    when 200 then 'Vélo'
    when 201 then 'Vélo indoor'
    when 202 then 'Vélo électrique'
    when 203 then 'Gravel'
    when 204 then 'VTT'
    when 205 then 'VTTAE'
    when 300 then 'Natation piscine'
    when 301 then 'Eau libre'
    when 400 then 'Cardio'
    when 401 then 'Cardio GPS'
    when 402 then 'Renforcement'
    when 900 then 'Marche'
    when 901 then 'Corde à sauter'
    when 904 then 'Yoga'
    when 905 then 'Pilates'
    when 10000 then 'Triathlon'
    else coalesce(nullif(trim(m[1]), ''), new.sport, 'Activité COROS')
  end;

  tm := regexp_match(body, 'startTimestamp=([0-9]{9,13})\s*\|\s*endTimestamp=([0-9]{9,13})');
  if tm is not null then
    new.started_at := to_timestamp((tm[1])::double precision / case when length(tm[1]) > 10 then 1000.0 else 1.0 end);
    new.ended_at := to_timestamp((tm[2])::double precision / case when length(tm[2]) > 10 then 1000.0 else 1.0 end);
  end if;

  dm := regexp_match(body, 'Distance:\s*([0-9]+(?:[.,][0-9]+)?)\s*(km|mi|m)(?:\s|\||$)', 'i');
  if dm is not null then
    new.distance_m := round(replace(dm[1], ',', '.')::numeric * case lower(dm[2]) when 'km' then 1000 when 'mi' then 1609.344 else 1 end);
  else
    new.distance_m := null;
  end if;

  dur := regexp_match(body, 'Duration:\s*([0-9]+):([0-9]{2})(?::([0-9]{2}))?');
  if dur is not null then
    if dur[3] is null then
      new.duration_s := dur[1]::integer * 60 + dur[2]::integer;
    else
      new.duration_s := dur[1]::integer * 3600 + dur[2]::integer * 60 + dur[3]::integer;
    end if;
  else
    new.duration_s := null;
  end if;

  pace := regexp_match(body, 'Average Pace:\s*([0-9]+):([0-9]{2})', 'i');
  if pace is not null then
    new.pace_seconds_per_km := pace[1]::integer * 60 + pace[2]::integer;
  else
    new.pace_seconds_per_km := null;
  end if;

  speed := regexp_match(body, 'Average Speed:\s*([0-9]+(?:[.,][0-9]+)?)\s*km/h', 'i');
  if speed is not null then
    new.avg_speed_kmh := replace(speed[1], ',', '.')::numeric;
  else
    new.avg_speed_kmh := null;
  end if;

  hr := regexp_match(body, 'Avg HR:\s*([0-9]+)\s*bpm', 'i');
  if hr is not null then
    new.avg_hr := hr[1]::integer;
  end if;

  return new;
end;
$$;

drop trigger if exists coros_activity_raw_normalizer on public.activities;
create trigger coros_activity_raw_normalizer
before insert or update on public.activities
for each row execute function public.normalize_coros_activity_from_raw();

update public.activities
set raw_provider_data = raw_provider_data
where provider = 'coros' and raw_provider_data ? 'text';