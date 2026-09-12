import {textChunkBatch,tokenCount} from '../functions/_shared/embeddingText.ts'
Deno.test('embedding chunks preserve long multilingual source exactly within token limits',()=>{
 const source=('A paragraph about projects.\n日本語で書かれた文章。👩🏽‍💻العربية中文\n').repeat(400)
 const chunks:string[]=[]
 let offset=0
 while(offset<source.length){const batch=textChunkBatch(source,offset,8);chunks.push(...batch.chunks);offset=batch.nextOffset}
 if(chunks.length<2 || chunks.join('')!==source) throw new Error('Chunking changed or truncated the source')
 if(chunks.some(chunk=>tokenCount(chunk)>1500)) throw new Error('Chunk exceeded token budget')
})
Deno.test('empty source produces no provider requests',()=>{
 if(textChunkBatch('',0,8).chunks.length!==0) throw new Error('Empty source produced chunks')
})
