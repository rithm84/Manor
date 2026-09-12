import { getEncoding } from 'npm:js-tiktoken@1.0.21'
const tokenizer=getEncoding('cl100k_base')
export function tokenCount(text:string):number {return tokenizer.encode(text).length}
/** Bounded work with lossless Unicode boundaries and a durable UTF-16 source offset. */
export function textChunkBatch(text:string,offset:number,limit:number):{chunks:string[];nextOffset:number} {
 if(!Number.isInteger(offset) || offset<0 || offset>text.length || !Number.isInteger(limit) || limit<1 || limit>8) throw new Error('Invalid embedding chunk cursor or batch size')
 const chunks:string[]=[]
 let cursor=offset
 while(cursor<text.length && chunks.length<limit) {
  const characters=Array.from(text.slice(cursor,cursor+12000)).slice(0,6000)
  let low=1,high=characters.length,accepted=0
  while(low<=high) {
   const middle=Math.floor((low+high)/2)
   if(tokenCount(characters.slice(0,middle).join(''))<=1500){accepted=middle;low=middle+1}else high=middle-1
  }
  if(accepted===0) throw new Error('A source character exceeded the embedding chunk budget')
  const content=characters.slice(0,accepted).join('')
  chunks.push(content);cursor+=content.length
 }
 return {chunks,nextOffset:cursor}
}
