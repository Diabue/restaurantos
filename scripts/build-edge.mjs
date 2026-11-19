import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const schema=await readFile('prisma/schema.prisma','utf8');
await writeFile('prisma/edge.prisma',schema.replace('provider = "prisma-client-js"','provider = "prisma-client"\n output = "../.local/edge-generated"\n runtime = "deno"\n engineType = "client"'));
execFileSync(process.execPath,['node_modules/prisma/build/index.js','generate','--schema','prisma/edge.prisma'],{stdio:'inherit'});
const pkg=JSON.parse(await readFile('package.json','utf8'));
await mkdir('supabase/functions/restaurantos-api',{recursive:true});
await build({entryPoints:['server/edge.ts'],outfile:'supabase/functions/restaurantos-api/app.mjs',bundle:true,format:'esm',platform:'node',target:'es2022',minify:true,define:{'process.env.DEMO_MODE':'"1"'},plugins:[{name:'edge-runtime',setup(b){
 b.onResolve({filter:/^@prisma\/client$/},()=>({path:resolve('.local/edge-generated/client.ts')}));
 b.onResolve({filter:/^\.\/live$/},()=>({path:'live',namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export class Live { publish() {} }',loader:'ts'}));
 b.onLoad({filter:/server[\\/]store\.ts$/},async args=>({contents:(await readFile(args.path,'utf8')).replace("export const db = new PrismaClient();",`import { PrismaPg } from '@prisma/adapter-pg';\nexport const db = new PrismaClient({adapter:new PrismaPg({connectionString:process.env.SUPABASE_DB_URL,max:2,idleTimeoutMillis:10000},{schema:'restaurantos'})});`),loader:'ts'}));
 b.onResolve({filter:/^[^./]/},args=>{
   if(args.path==='@prisma/client/runtime/client') return {path:'npm:@prisma/client@6.19.3/runtime/wasm-compiler-edge.mjs',external:true};
   if(args.path.startsWith('node:'))return {path:args.path,external:true};
   const name=args.path.startsWith('@')?args.path.split('/').slice(0,2).join('/'):args.path.split('/')[0];
   const version=(pkg.dependencies[name]||pkg.devDependencies[name]||'').replace(/^[~^]/,'');
   return {path:`npm:${name}${version?'@'+version:''}${args.path.slice(name.length)}`,external:true};
 });
}}]});
await writeFile('supabase/functions/restaurantos-api/index.ts',`import process from 'node:process';\nimport { Buffer } from 'node:buffer';\nglobalThis.Buffer=Buffer;\nconst {handleEdge}=await import('./app.mjs');\nDeno.serve(handleEdge);\n`);
console.log('Edge API built.');
