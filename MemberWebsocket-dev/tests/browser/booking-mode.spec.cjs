const {test,expect}=require('playwright/test');
const http=require('node:http');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'../..');let server,base;
test.beforeAll(async()=>{
 server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/booking/') {
   const html=fs.readFileSync(path.join(root,'booking/index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
   res.writeHead(200,{'Content-Type':'text/html'});res.end(html.replace('</body>','<script src="./booking-accessible.js" defer></script><script src="/mode-fixture.js" defer></script></body>'));return;
  }
  if(url.pathname==='/mode-fixture.js') {
   res.writeHead(200,{'Content-Type':'text/javascript'});res.end(`
    window.BookingReceipts={refresh:async()=>{},openAccessible(){}};
    window.BookingBenefits={getItems:()=>[],syncNow(){}};
    window.addEventListener('DOMContentLoaded',()=>{
      window.dispatchEvent(new CustomEvent('booking:member-loaded',{detail:{profile:{lineUserId:new URL(location.href).searchParams.get('member')||'test:mode-a'}}}));
      document.getElementById('loadingView').classList.add('hidden');document.getElementById('bookingView').classList.remove('hidden');
    });`);return;
  }
  const file=path.resolve(root,'.'+url.pathname);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream'});fs.createReadStream(file).pipe(res);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
});
test.afterAll(async()=>{await new Promise(resolve=>server.close(resolve));});
test.beforeEach(async({page})=>{await page.route('https://**',route=>route.abort());});
for(const variant of [
 {name:'desktop light',width:1280,theme:'light'},
 {name:'desktop dark',width:1280,theme:'dark'},
 {name:'mobile light',width:320,theme:'light'},
 {name:'mobile dark',width:390,theme:'dark'},
])test('booking preference survives refresh and isolates accounts '+variant.name,async({page},info)=>{
 await page.setViewportSize({width:variant.width,height:844});
 await page.addInitScript(theme=>{window.addEventListener('DOMContentLoaded',()=>{document.documentElement.dataset.theme=theme;});},variant.theme);
 await page.goto(base+'/booking/?member=test:mode-a');
 const toggle=page.locator('#bookingAccessibleToggle');
 await expect(toggle).toHaveAttribute('aria-pressed','false');
 await expect(page.locator('#bookingModeTitle')).toHaveText('一般預約模式');
 const switcher=page.locator('.booking-accessible-switch');
 async function checkModeLayout() {
  const bounds=await switcher.evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,viewport:innerWidth,overflow:el.scrollWidth-el.clientWidth}));
  expect(bounds.left).toBeGreaterThanOrEqual(0);expect(bounds.right).toBeLessThanOrEqual(bounds.viewport+1);expect(bounds.overflow).toBeLessThanOrEqual(1);
  expect((await toggle.boundingBox()).height).toBeGreaterThanOrEqual(48);
 }
 await checkModeLayout();await info.attach('booking-general-mode',{body:await switcher.screenshot(),contentType:'image/png'});
 await page.locator('#memberNote').evaluate(el=>el.value='unsent draft');
 await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#bookingModeTitle')).toHaveText('大字・拍收據模式');
 await checkModeLayout();
 expect(await page.evaluate(()=>localStorage.getItem('booking-mode:v2:test:mode-a'))).toBe('accessible');
 await toggle.click();expect(await page.locator('#memberNote').inputValue()).toBe('unsent draft');
 await toggle.click();await page.reload();await expect(toggle).toHaveAttribute('aria-pressed','true');
 await info.attach('booking-mode-restored',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
 await page.goto(base+'/booking/?member=test:mode-b');await expect(toggle).toHaveAttribute('aria-pressed','false');
 await page.goto(base+'/booking/?member=test:mode-a');await expect(toggle).toHaveAttribute('aria-pressed','true');
 await toggle.click();await page.reload();await expect(toggle).toHaveAttribute('aria-pressed','false');
 expect(await page.evaluate(()=>localStorage.getItem('booking-mode:v2:test:mode-b'))).toBe(null);
});
test('legacy or corrupt preference and unavailable storage fall back to general mode',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('booking-accessible-mode','1');localStorage.setItem('booking-mode:v2:test:mode-a','invalid');});
 await page.goto(base+'/booking/');await expect(page.locator('#bookingAccessibleToggle')).toHaveAttribute('aria-pressed','false');
 await page.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new Error('storage unavailable');}});});
 await page.reload();const toggle=page.locator('#bookingAccessibleToggle');await expect(toggle).toHaveAttribute('aria-pressed','false');
 await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','true');await page.reload();await expect(toggle).toHaveAttribute('aria-pressed','false');
});
