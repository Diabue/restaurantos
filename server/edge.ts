import 'reflect-metadata';
import { GuestController } from './guest';
import { StaffController } from './staff';
import { ManagerController } from './manager';
import { FiscalController } from './fiscal';
import { Attempts, db, bearer, requireStaff } from './store';
import { cloudImageStorage } from './supabase-images';

const attempts = new Attempts();
const live = { publish() {} } as any;
const guest = new GuestController(live, attempts);
const staff = new StaffController(live, attempts);
const manager = new ManagerController(live);
const fiscal = new FiscalController(live);
const origins = new Set(['https://restaurantos.maxstronytest.uk', 'https://restaurantos-2ku.pages.dev', 'http://localhost:5173', 'http://localhost:3001']);

export async function handleEdge(req: Request): Promise<Response> {
  const origin = req.headers.get('origin') || '';
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': origins.has(origin) ? origin : 'https://restaurantos.maxstronytest.uk', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-station-key, x-restaurant-token', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Vary': 'Origin' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const path = new URL(req.url).pathname.replace(/^.*\/restaurantos-api/, '').replace(/^\/api/, '');
  const auth = 'Bearer ' + (req.headers.get('x-restaurant-token') || '');
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  const station = req.headers.get('x-station-key') || '';
  try {
    if (!['GET','POST'].includes(req.method)) return Response.json({message:'Nieprawidłowa metoda.'},{status:405,headers});
    let body: any = undefined;
    if (req.method === 'POST') {
      if (Number(req.headers.get('content-length') || '0') > 6 * 1024 * 1024) throw Object.assign(new Error('Za duży plik.'), {status:413});
      if (!req.headers.get('content-type')?.startsWith('multipart/')) body = await req.json();
    }
    const post = req.method === 'POST';
    let result: unknown;
    let m: RegExpMatchArray | null;
    if (!post && path === '/health') { await db.$queryRaw`SELECT 1`; result = {ok:true}; }
    else if (!post && (m = path.match(/^\/menu\/([^/]+)$/))) result = await guest.menu(m[1]);
    else if (post && (m = path.match(/^\/menu\/([^/]+)\/(start|join)$/))) {
      await db.$executeRaw`INSERT INTO restaurantos."AccessAttempt" (key,count,expires) VALUES (${ip + ':' + m[1]},1,now()+interval '5 minutes') ON CONFLICT (key) DO UPDATE SET count = CASE WHEN "AccessAttempt".expires < now() THEN 1 ELSE "AccessAttempt".count+1 END, expires = CASE WHEN "AccessAttempt".expires < now() THEN now()+interval '5 minutes' ELSE "AccessAttempt".expires END`;
      const rows = await db.$queryRaw<any[]>`SELECT count FROM restaurantos."AccessAttempt" WHERE key=${ip + ':' + m[1]}`;
      if (rows[0].count > 35) throw Object.assign(new Error('Za dużo prób. Spróbuj za kilka minut.'),{status:429});
      result = m[2] === 'start' ? await guest.start(m[1], ip, body) : await guest.join(m[1], ip, body);
    }
    else if (!post && path === '/guest') result = await guest.state(auth);
    else if (post && path === '/guest/cart') result = await guest.cart(auth,body);
    else if (post && path === '/guest/order') result = await guest.submit(auth,body);
    else if (post && path === '/guest/call') result = await guest.call(auth,body);
    else if (post && path === '/staff/login') {
      const key='login:'+ip;
      await db.$executeRaw`INSERT INTO restaurantos."AccessAttempt" (key,count,expires) VALUES (${key},1,now()+interval '5 minutes') ON CONFLICT (key) DO UPDATE SET count=CASE WHEN "AccessAttempt".expires<now() THEN 1 ELSE "AccessAttempt".count+1 END, expires=CASE WHEN "AccessAttempt".expires<now() THEN now()+interval '5 minutes' ELSE "AccessAttempt".expires END`;
      const rows=await db.$queryRaw<any[]>`SELECT count FROM restaurantos."AccessAttempt" WHERE key=${key}`;
      if(rows[0].count>45) throw Object.assign(new Error('Za dużo prób logowania.'),{status:429});
      result=await staff.login(body,ip);
    }
    else if (!post && path === '/staff/me') result = await staff.me(auth);
    else if (post && path === '/staff/logout') result = await staff.logout(auth);
    else if (!post && path === '/staff/floor') result = await staff.floor(auth);
    else if (!post && path === '/staff/kitchen') result = await staff.kitchen(auth);
    else if (post && (m=path.match(/^\/staff\/tables\/([^/]+)\/(open|close-empty|manual|discard-cart)$/))) {
      result = m[2]==='open' ? await staff.open(auth,m[1]) : m[2]==='close-empty' ? await staff.closeEmpty(auth,m[1],body) : m[2]==='manual' ? await staff.manual(auth,m[1],body) : await staff.discardCart(auth,m[1],body);
    }
    else if(post && (m=path.match(/^\/staff\/tables\/([^/]+)\/transfer$/))) result=await staff.transfer(auth,m[1],body);
    else if(post && (m=path.match(/^\/staff\/orders\/([^/]+)$/))) result=await staff.updateOrder(auth,m[1],body);
    else if(post && (m=path.match(/^\/staff\/calls\/([^/]+)\/resolve$/))) result=await staff.resolveCall(auth,m[1]);
    else if(!post && path==='/manager') result=await manager.state(auth);
    else if(post && path==='/manager/product') {
      let photo: {buffer:Buffer} | undefined;
      if(req.headers.get('content-type')?.startsWith('multipart/')) {
        await requireStaff(db,bearer(auth),'MANAGER');
        const form=await req.formData(); body={product:form.get('product')};
        const f=form.get('photo');
        if(f instanceof File) { if(f.size>5*1024*1024) throw Object.assign(new Error('Zdjęcie może mieć maksymalnie 5 MB.'),{status:413}); photo={buffer:Buffer.from(await f.arrayBuffer())}; }
      }
      result=await manager.product(auth,body,photo);
    }
    else if(post && path==='/manager/restaurant') result=await manager.restaurant(auth,body);
    else if(post && path==='/manager/category') result=await manager.category(auth,body);
    else if(post && path==='/manager/layout') result=await manager.layout(auth,body);
    else if(post && path==='/manager/table') result=await manager.table(auth,body);
    else if(post && path==='/manager/employee') result=await manager.employee(auth,body);
    else if(post && (m=path.match(/^\/fiscal\/tables\/([^/]+)\/prepare$/))) result=await fiscal.prepare(auth,station,m[1],body);
    else if(post && (m=path.match(/^\/fiscal\/([^/]+)\/(claim|result|resolve|settle)$/))) {
      result=m[2]==='claim'?await fiscal.claim(auth,station,m[1]):m[2]==='result'?await fiscal.result(auth,station,m[1],body):m[2]==='resolve'?await fiscal.resolve(auth,m[1],body):await fiscal.settle(auth,station,m[1]);
    }
    else if(!post && (m=path.match(/^\/uploads\/products\/([a-f0-9-]{36})\/([a-f0-9-]{36}\.(?:jpg|png|webp))$/))) {
      const blob=await cloudImageStorage()!.download(m[1]+'/'+m[2]);
      return new Response(blob,{headers:{...headers,'Content-Type':blob.type,'Cache-Control':'public, max-age=31536000, immutable'}});
    }
    else return Response.json({message:'Nie znaleziono zasobu.'},{status:404,headers});
    return Response.json(result,{status:post?201:200,headers});
  } catch(error:any) {
    const status=error.getStatus?.() || error.status || 500;
    if(status===500) console.error(error);
    return Response.json({message:status===500?'Usługa jest chwilowo niedostępna.':error.message},{status,headers});
  }
}
