-- Recency precision, wide company sets, saved views, and absent-field preservation.
begin;
select set_config('request.jwt.claims','{"sub":"81458dac-c7fa-47a5-bdf7-496da394d5dd","role":"authenticated"}',true);
do $$
declare fields jsonb; receipt jsonb; detail jsonb; query_result jsonb; rejected boolean:=false;
begin
 fields:=jsonb_build_object('id','source-metadata-e2e','expected_revision',0,'name','Source metadata integration fixture','difficulty','Easy','kind','other','topics',jsonb_build_array('Testing'),'companies',(select jsonb_agg('Company '||n) from generate_series(1,128)n),'tags','[]'::jsonb,'collections','[]'::jsonb,'source_type','custom','source_url',null,'external_key','source-metadata-e2e','content',null,'source_metadata',jsonb_build_object('lastAsked',jsonb_build_object('value','2026-09','precision','month'),'reportedFrom',jsonb_build_object('value','2025','precision','year'),'reportedTo',jsonb_build_object('value','2026-10-01','precision','day'),'reportCount',9,'frequency','high','isNew',false));
 receipt:=public.manor_command('ca4a8b92-80a6-4d80-bc3e-55308adc3001','save_problem',fields);
 detail:=public.manor_problem_query('read_problem','{"id":"source-metadata-e2e"}');
 if detail#>>'{problem,source_metadata,lastAsked,value}'<>'2026-09' or jsonb_array_length(detail#>'{problem,companies}')<>128 then raise exception 'Source metadata or company labels lost precision'; end if;
 query_result:=public.manor_problem_query('query_problems','{"search":"Source metadata integration fixture","last_asked_since":"2026-09-25","last_asked_until":"2026-09-27"}');
 if (query_result->>'total')::integer<>1 then raise exception 'Coarse date interval did not overlap the filter'; end if;
 query_result:=public.manor_problem_query('query_problems','{"search":"Source metadata integration fixture","last_asked_since":"2026-10-01"}');
 if (query_result->>'total')::integer<>0 then raise exception 'Out-of-range source date matched'; end if;
 fields:=(fields-'source_metadata')||jsonb_build_object('expected_revision',1,'name','Updated source metadata fixture');
 receipt:=public.manor_command('ca4a8b92-80a6-4d80-bc3e-55308adc3002','save_problem',fields);
 if receipt#>>'{record,source_metadata,lastAsked,precision}'<>'month' then raise exception 'Absent source metadata overwrote existing values'; end if;
 begin perform manor_private.validate_problem_source_metadata('{"lastAsked":{"value":"2026-02-30","precision":"day"}}'); exception when datetime_field_overflow then rejected:=true; end;
 if not rejected then raise exception 'Invalid calendar date was accepted'; end if;
 rejected:=false;
 begin perform manor_private.validate_problem_source_metadata('{"reportedFrom":{"value":"2027","precision":"year"},"reportedTo":{"value":"2026","precision":"year"}}'); exception when raise_exception then rejected:=true; end;
 if not rejected then raise exception 'Reversed report range was accepted'; end if;
 receipt:=public.manor_command('ca4a8b92-80a6-4d80-bc3e-55308adc3003','save_problem_view','{"id":"source-date-view-e2e","expected_revision":0,"name":"Source date fixture","filters":{"search":"","kinds":[],"difficulties":[],"topics":[],"companies":[],"tags":[],"collections":[],"sourceTypes":[],"hasContent":null,"statuses":[],"lastAskedSince":"2026-01-01","lastAskedUntil":"2026-12-31"},"sort":[{"field":"lastAsked","direction":"desc"}],"group_by":null,"visible_columns":["difficulty","kind","topics","companies","tags","collections","status","lastAsked"]}');
 if receipt#>>'{record,sort,0,field}'<>'lastAsked' then raise exception 'Recency saved view was not persisted'; end if;
end $$;
rollback;
