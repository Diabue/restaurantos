import process from 'node:process';
import { Buffer } from 'node:buffer';
globalThis.Buffer=Buffer;
const {handleEdge}=await import('./app.mjs');
Deno.serve(handleEdge);
