-- Invoked only by the server using its service role, after validating the payload.
create or replace function public.import_vocabulary_to_set(p_user_id uuid, p_folder_name text, p_set_name text, p_cards jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare folder_uuid uuid; set_uuid uuid; matches integer;
begin
 if p_user_id is null or p_folder_name is null or p_set_name is null or char_length(trim(p_folder_name)) not between 1 and 100 or char_length(trim(p_set_name)) not between 1 and 100 or jsonb_typeof(p_cards) is distinct from 'array' or jsonb_array_length(p_cards) not between 1 and 100 then
  raise exception 'Invalid import';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));
 select count(*) into matches from public.folders where user_id=p_user_id and name=p_folder_name;
 if matches > 1 then raise exception 'Ambiguous folder name' using errcode='P0001'; end if;
 select id into folder_uuid from public.folders where user_id=p_user_id and name=p_folder_name;
 if folder_uuid is null then insert into public.folders(user_id,name) values(p_user_id,p_folder_name) returning id into folder_uuid; end if;
 select count(*) into matches from public.study_sets where user_id=p_user_id and folder_id=folder_uuid and name=p_set_name;
 if matches > 1 then raise exception 'Ambiguous set name' using errcode='P0001'; end if;
 select id into set_uuid from public.study_sets where user_id=p_user_id and folder_id=folder_uuid and name=p_set_name;
 if set_uuid is null then insert into public.study_sets(user_id,folder_id,name) values(p_user_id,folder_uuid,p_set_name) returning id into set_uuid; end if;
 insert into public.cards(user_id,set_id,external_id,word,japanese_meaning,explanation,example,part_of_speech,source_url,updated_at)
 select p_user_id,set_uuid,c.external_id,c.word,c.japanese_meaning,c.explanation,c.example,c.part_of_speech,c.source_url,now()
 from jsonb_to_recordset(p_cards) as c(external_id text,word text,japanese_meaning text,explanation text,example text,part_of_speech text,source_url text)
 on conflict(user_id,external_id) do update set
 set_id=excluded.set_id, word=excluded.word, japanese_meaning=excluded.japanese_meaning,
 explanation=excluded.explanation, example=excluded.example, part_of_speech=excluded.part_of_speech,
 source_url=excluded.source_url, updated_at=excluded.updated_at;
end $$;
revoke all on function public.import_vocabulary_to_set(uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.import_vocabulary_to_set(uuid,text,text,jsonb) to service_role;
grant select,insert on public.folders,public.study_sets to service_role;
