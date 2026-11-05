async (page) => {
  const user = {id:'11111111-1111-1111-1111-111111111111',name:'Demo Nominator',email:'demo@example.com',role:'participant',skills:[],avatarUrl:null};
  const award = {id:'22222222-2222-2222-2222-222222222222',title:'2026 Digital Pioneer Award',status:'running',tags:[],prizes:[]};
  const paged = content => ({content,totalPages:1,totalElements:content.length,number:0,size:100});
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body = [];
    if (path.endsWith('/auth/refresh')) body = {accessToken:'local-browser-fixture'};
    else if(path.endsWith('/profiles/me')) body = user;
    else if(path.endsWith('/nomination-eligibility')) body = {canSubmit:true,canReview:false,nominatingHead:'Demo',message:null};
    else if(path.endsWith('/profiles/search')) body = [{id:'33333333-3333-3333-3333-333333333333',name:'Alice Demo',email:'alice@example.com'}];
    else if(path.endsWith('/hackathons') || path.endsWith('/public/awards')) body = paged([award]);
    else if(path.endsWith('/ideas') || path.endsWith('/nominations')) body = paged([]);
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.setViewportSize({width:1440,height:1100});
  await page.goto('http://127.0.0.1:4174/nominate');
}