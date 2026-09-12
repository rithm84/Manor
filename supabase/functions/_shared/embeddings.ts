import {providerJson,required,z} from './integrationRuntime.ts'
const responseSchema=z.object({usage:z.object({total_tokens:z.number().int().nonnegative()}),data:z.array(z.object({index:z.number().int(),embedding:z.array(z.number()).length(1536)}))})
export async function embed(text:readonly string[]):Promise<{vectors:number[][];totalTokens:number}> {
 if(text.length===0 || text.length>8) throw new Error('Embedding requests require one to eight chunks')
 const response=await providerJson('https://api.openai.com/v1/embeddings',{method:'POST',headers:{Authorization:'Bearer '+required('OPENAI_API_KEY'),'Content-Type':'application/json'},body:JSON.stringify({model:'text-embedding-3-small',dimensions:1536,input:text,encoding_format:'float'})},responseSchema)
 const rows=[...response.data].sort((a,b)=>a.index-b.index)
 if(rows.length!==text.length || rows.some((row,index)=>row.index!==index)) throw new Error('Embedding provider returned incomplete chunk indices')
 return {vectors:rows.map(row=>row.embedding),totalTokens:response.usage.total_tokens}
}
