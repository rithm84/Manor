import {AnthropicMeter, anthropicCostMicroUSD, checkAnthropicBody, checkRouterBody, limitsFromEnv, refusal} from '../functions/_shared/alfredProxy.ts'
const fail=(message:string)=>{throw new Error(message)}

Deno.test('answer requests are limited to the allowed model, a bounded reply, and the app\'s own tools',()=>{
 const base={model:'claude-opus-5-5',max_tokens:18000,messages:[{role:'user',content:'hi'}]}
 if(!checkAnthropicBody(base).ok) fail('A normal answer request was refused')
 if(!checkAnthropicBody({...base,tools:[{name:'find_tasks',description:'Search',input_schema:{type:'object'}}]}).ok) fail('Alfred\'s own tools were refused')
 if(checkAnthropicBody({...base,model:'claude-fable-5-2'}).ok) fail('Another model was allowed')
 if(checkAnthropicBody({...base,max_tokens:200000}).ok) fail('An oversized reply was allowed')
 if(checkAnthropicBody({...base,tools:[{type:'web_search_20260209',name:'web_search'}]}).ok) fail('A server tool was allowed')
 if(checkAnthropicBody({...base,mcp_servers:[]}).ok) fail('An MCP connector was allowed')
})

Deno.test('the new-topic check is limited to the router model with a short reply',()=>{
 const checked=checkRouterBody({model:'gpt-6-luna',input:[],max_output_tokens:50000})
 if(!checked.ok || checked.body.max_output_tokens!==1000) fail('The router reply cap was not applied')
 if(checkRouterBody({model:'gpt-6.1-terra',input:[]}).ok) fail('Another OpenAI model was allowed')
})

Deno.test('streamed usage is read across chunks and priced at fast mode rates',()=>{
 const meter=new AnthropicMeter()
 const events=[
  'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":100,"cache_read_input_tokens":7000,"cache_creation_input_tokens":0,"output_tokens":1,"speed":"fast"}}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"x"}}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2000}}\n\n',
 ].join('')
 // Split mid-line to check that partial lines wait for the rest.
 meter.feed(events.slice(0,57)); meter.feed(events.slice(57))
 const u=meter.usage
 if(u.input!==100 || u.cacheRead!==7000 || u.output!==2000 || !u.fast) fail(`Usage was misread: ${JSON.stringify(u)}`)
 // Fast mode: 100 × 8 + 2000 × 40 + 7000 × 0.4 = 83,600 micro-dollars.
 if(anthropicCostMicroUSD(u)!==83600) fail(`Cost was ${anthropicCostMicroUSD(u)}`)
})

Deno.test('limits come from secrets with defaults, and refusals name what ran out',()=>{
 const limits=limitsFromEnv(name=>({ALFRED_DAILY_LIMIT_USD:'2',ALFRED_UNLIMITED_ACCOUNTS:' A211075B-0DB8-4488-8192-065B4026ACD4 '} as Record<string,string>)[name])
 if(limits.dailyMicroUSD!==2_000_000 || limits.monthlyMicroUSD!==100_000_000 || !limits.enabled) fail('Limits were misread')
 if(!limits.unlimited.has('a211075b-0db8-4488-8192-065b4026acd4')) fail('The unlimited account list was misread')
 if(limitsFromEnv(name=>name==='ALFRED_HOSTED'?'off':undefined).enabled) fail('The kill switch did not pause')
 const totals={day_cost_microusd:2_000_000,month_cost_microusd:2_000_000,day_listening_sessions:0,day_router_requests:0}
 if(!refusal('answer',totals,limits)?.includes('today')) fail('A spent daily allowance was not refused')
 if(refusal('listening',totals,limits)!==null) fail('Listening was refused for spent answer money')
})
