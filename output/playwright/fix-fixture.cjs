async (page) => {
  await page.route('**/api/v1/me/nominations', route => route.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await page.route('**/ws/**', route => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({websocket:false,cookie_needed:false,origins:['*:*'],entropy:1234})}));
  await page.getByRole('button',{name:'Retry',exact:true}).click();
}