/* Easy App Sync — shared stock module. Separate from the sales product catalogue. */
(function () {
  'use strict';
  var PRODUCTS_PATH = 'stock_products_data';
  var BALANCES_PATH = 'stock_balances_data';
  var MOVEMENTS_PATH = 'stock_movements_data';
  var DIRECTIONS_PATH = 'store_directions_data';
  var products = {};
  var balances = {};
  var movements = {};
  var storeDirections = {};
  var loaded = { products:false, balances:false, movements:false, directions:false };
  var activeFilter = 'all';
  var adminTab = 'shops';
  var selectedStoreId = '';
  var searchText = '';
  var editingId = '';
  var selectedPhoto = null;
  var mergeSelectingId = '';
  var formSizes = [];
  var refs = {};

  function user(){ return window.currentUser || null; }
  function isAdmin(){ return !!(user() && user().role === 'admin'); }
  function isSeller(){ return !!(user() && user().role === 'seller'); }
  function org(){ var u=user(); if(u && typeof isSuperAdmin==='function' && isSuperAdmin(u)) return String(window.currentOrgFilter || 'mine'); if(u && u.role==='seller' && u.store && typeof getStoreOrg==='function') return String(getStoreOrg(u.store) || u.org || 'mine'); return String((u && u.org) || 'mine'); }
  function uid(prefix){ return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,9); }
  function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function norm(v){ return String(v || '').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/g,' ').trim().replace(/\\s+/g,' '); }
  function storeId(){ return isSeller() ? String(user().store || '') : ''; }
  function warehouseId(){ return 'warehouse__' + org(); }
  function stockLocationIds(){ return visibleStoreIds().concat([warehouseId()]); }
  function stockLocationName(id){ return String(id)===warehouseId() ? 'Склад хранения' : String(window.STORES[id]||id); }
  function storeDirection(id){ return String(storeDirections[String(id)] || ''); }
  function visibleStoreIds(){ return typeof getVisibleStoreKeys === 'function' ? getVisibleStoreKeys().map(String) : Object.keys(window.STORES || {}); }
  function canUse(){ return !!(user() && typeof canUseStoreData === 'function' && canUseStoreData() && window.db && db.ref); }
  function statusText(){ return Object.keys(loaded).every(function(k){return loaded[k];}) ? '' : 'Загружаем складские данные из Firebase…'; }
  function allProducts(){ return Object.keys(products).map(function(k){return products[k];}).filter(function(p){return p && p.org === org() && !p.mergedInto;}); }
  function sellerCanSee(p){
    if (!p || p.org !== org()) return false;
    if (p.status === 'pending') return isSeller() && String(p.createdById) === String(user().id);
    if (p.status !== 'active') return false;
    var d = storeDirection(storeId());
    return !!d && (d === 'mixed' || d === p.direction);
  }
  function qty(pId,sId){ return Number(balances[String(sId)] && balances[String(sId)][String(pId)] && balances[String(sId)][String(pId)].quantity || 0); }
  function sizeLabel(sizes){
    var counts={}; (Array.isArray(sizes)?sizes:[]).forEach(function(s){var k=String(s);counts[k]=(counts[k]||0)+1;});
    var letters=['XXS','XS','S','M','L','XL','2XL','3XL','4XL','5XL'];
    return Object.keys(counts).sort(function(a,b){
      var an=/^\d+$/.test(a), bn=/^\d+$/.test(b);
      if(an&&bn)return Number(a)-Number(b);
      if(an)return -1;if(bn)return 1;
      return letters.indexOf(a)-letters.indexOf(b);
    }).map(function(k){return k+(counts[k]>1?' × '+counts[k]:'');}).join(', ');
  }
  function canEditCard(p){ return isAdmin() && !!p; }
  function addAuditSafe(action,details){ try { if(typeof addAudit === 'function') addAudit(action,details); } catch(e) { console.warn(e); } }
  function setStatus(msg,isError){ var el=document.getElementById('stockStatus'); if(el){el.textContent=msg || '';el.style.color=isError?'#b42318':'var(--text-light)';} }
  function cardPhotoUrl(url){
    url=String(url||'');
    // Deliver only a thumbnail close to the 76px card image size; keep the original URL in Firebase.
    return url.replace('/image/upload/','/image/upload/c_fill,w_240,h_240,q_auto:low,f_auto/');
  }
  function initPage(){
    var shell=document.getElementById('workspaceShell');
    var content=shell && shell.querySelector('.workspace-content');
    if(!shell || !content) return false;
    if(!document.getElementById('workspacePage-stock')){
      var page=document.createElement('section'); page.id='workspacePage-stock'; page.className='workspace-page';
      page.innerHTML='<div class="page-heading"><div><h2>Склад</h2><p>Карточки товаров и остатки магазина</p></div></div><div id="stockRoot"></div>';
      content.appendChild(page);
    }
    ['.side-nav','.mobile-nav'].forEach(function(sel){
      var nav=document.querySelector(sel);
      if(nav && !nav.querySelector('[data-page="stock"]')){
        var b=document.createElement('button'); b.type='button'; b.className='nav-link'; b.dataset.page='stock';
        b.innerHTML='<span class="nav-icon">📦</span><span>Склад</span>';
        b.addEventListener('click',function(){window.easyAppSyncShowPage && window.easyAppSyncShowPage('stock');});
        nav.appendChild(b);
      }
    });
    return true;
  }
  function show(){
    if(!initPage()) return;
    var page=document.getElementById('workspacePage-stock');
    document.querySelectorAll('#workspaceShell .workspace-page').forEach(function(p){p.classList.toggle('active',p===page);});
    document.querySelectorAll('#workspaceShell .nav-link,.mobile-nav .nav-link').forEach(function(b){b.classList.toggle('active',b.dataset.page==='stock');});
    try { sessionStorage.setItem('easyAppSync_activePage','stock'); } catch(e){}
    render();
  }
  function load(){
    if(!window.db || !db.ref) return;
    [['products',PRODUCTS_PATH],['balances',BALANCES_PATH],['movements',MOVEMENTS_PATH],['directions',DIRECTIONS_PATH]].forEach(function(pair){
      var name=pair[0];
      if(refs[name]) return;
      refs[name]=db.ref(pair[1]);
      refs[name].on('value',function(snap){
        var v=snap.val() || {};
        if(name==='products') products=v;
        else if(name==='balances') balances=v;
        else if(name==='movements') movements=v;
        else storeDirections=v;
        loaded[name]=true;
        render();
        if(typeof window.drawChart==='function'&&document.getElementById('workspacePage-analytics')&&document.getElementById('workspacePage-analytics').classList.contains('active'))window.drawChart();
        if(typeof window.renderPurchasePlan==='function'&&document.getElementById('workspacePage-purchase')&&document.getElementById('workspacePage-purchase').classList.contains('active'))window.renderPurchasePlan();
        if(name==='directions'&&typeof window.renderStoresManagement==='function')window.renderStoresManagement();
        if(window.refreshStockSaleProducts && document.getElementById('stockSaleEnabled') && document.getElementById('stockSaleEnabled').checked) window.refreshStockSaleProducts();
      },function(err){ console.error('Stock sync '+name,err); loaded[name]=true; render(); });
    });
  }
  function getStoreDirectionSetting(storeKey){return String(storeDirections[String(storeKey)]||'');}
  function saveStoreDirectionSetting(storeKey,direction){
    var key=String(storeKey||''),value=String(direction||'');
    if(!key||['krossy','easy','mixed'].indexOf(value)===-1)return Promise.reject(new Error('Выберите корректное направление магазина.'));
    if(!isAdmin()||typeof isSuperAdmin!=='function'||!isSuperAdmin(user()))return Promise.reject(new Error('Недостаточно прав для изменения направления.'));
    return db.ref(DIRECTIONS_PATH+'/'+key).set(value).then(function(){storeDirections[key]=value;addAuditSafe('stock_store_direction','Изменено направление магазина «'+(STORES[key]||key)+'»: '+value);return value;});
  }

  function ensureStockActionStyles(){
    if(document.getElementById('stockActionResponsiveStyles'))return;
    var style=document.createElement('style');style.id='stockActionResponsiveStyles';
    style.textContent='@media(max-width:600px){.stock-card-actions{display:flex!important;flex-wrap:nowrap!important;gap:3px!important;width:100%;min-width:0;}.stock-card-actions .btn{flex:1 1 0;min-width:0;padding:6px 4px!important;font-size:10px!important;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}}';
    document.head.appendChild(style);
  }

  function render(){
    ensureStockActionStyles();
    if(!initPage()) return;
    var page=document.getElementById('workspacePage-stock');
    if(!page || !page.classList.contains('active')) return;
    var root=document.getElementById('stockRoot'); if(!root) return;
    if(!user()){root.innerHTML='<div class="card">Войдите в приложение, чтобы открыть склад.</div>';return;}
    if(!canUse()){root.innerHTML='<div class="card">Склад станет доступен после проверки подключения к Firebase.</div>';return;}
    var loading=statusText(); if(loading){root.innerHTML='<div class="card">'+esc(loading)+'</div>';return;}
    if(isSeller() && (!storeId() || !storeDirection(storeId()))){
      root.innerHTML='<div class="card"><b>Склад ещё не настроен.</b><p>Попросите администратора назначить направление вашего магазина в разделе «Управление магазинами».</p></div>';return;
    }
    var stores=visibleStoreIds();
    var locations=stockLocationIds();
    if(isAdmin() && locations.length && locations.indexOf(String(selectedStoreId))===-1) selectedStoreId=String(stores[0]||warehouseId());
    var list=allProducts().filter(function(p){return isAdmin() ? (activeFilter==='all' || (activeFilter==='pending' ? p.status==='pending' : activeFilter==='active' ? p.status==='active' : p.direction===activeFilter)) : sellerCanSee(p);});
    if(searchText) list=list.filter(function(p){return norm([p.name,p.article,p.category,p.color,p.size,p.brand,p.model].join(' ')).indexOf(norm(searchText))!==-1;});
    list.sort(function(a,b){return Number(b.updatedAt||b.createdAt||0)-Number(a.updatedAt||a.createdAt||0);});
    var html='';
    if(isAdmin()){
      if(adminTab!=='shops'&&adminTab!=='history')adminTab='shops';html+='<div class="card" style="margin-bottom:14px;"><div style="display:flex;gap:7px;flex-wrap:wrap;"><button class="btn '+(adminTab==='shops'?'btn-primary':'btn-secondary')+'" data-stock-tab="shops" type="button">Магазины</button><button class="btn '+(adminTab==='history'?'btn-primary':'btn-secondary')+'" data-stock-tab="history" type="button">История</button></div></div>';
      if(adminTab==='shops'){
        var totalUnits=0,totalProducts=allProducts().filter(function(p){return p.status==='active';}).length;
        locations.forEach(function(k){Object.keys(balances[k]||{}).forEach(function(pid){totalUnits+=Number((balances[k][pid]||{}).quantity||0);});});
        html+='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px;"><div class="card"><div style="font-size:12px;color:var(--text-light);">Магазинов</div><b style="font-size:24px;">'+stores.length+'</b></div><div class="card"><div style="font-size:12px;color:var(--text-light);">Активных товаров</div><b style="font-size:24px;">'+totalProducts+'</b></div><div class="card"><div style="font-size:12px;color:var(--text-light);">Всего единиц</div><b style="font-size:24px;">'+totalUnits+'</b></div></div>';
        html+='<div class="card" style="margin-bottom:14px;"><h3>Выберите магазин или склад хранения</h3><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;">';
        locations.forEach(function(k){var units=Object.keys(balances[k]||{}).reduce(function(sum,pid){return sum+Number((balances[k][pid]||{}).quantity||0);},0);var count=Object.keys(balances[k]||{}).filter(function(pid){return Number((balances[k][pid]||{}).quantity||0)>0;}).length;html+='<button type="button" data-stock-select-store="'+esc(k)+'" class="card" style="text-align:left;cursor:pointer;border:2px solid '+(String(k)===String(selectedStoreId)?'var(--primary)':'var(--border)')+';background:'+(String(k)===String(selectedStoreId)?'#fff0f5':'var(--card)')+';"><b>'+(String(k)===warehouseId()?'📦 ':'🏬 ')+esc(stockLocationName(k))+'</b><div style="font-size:12px;color:var(--text-light);margin-top:6px;">'+count+' товаров · '+units+' единиц</div><div style="font-size:12px;color:var(--primary);margin-top:8px;">'+(String(k)===String(selectedStoreId)?'Выбран':'Открыть магазин →')+'</div></button>';});
        if(!stores.length) html+='<div style="color:var(--text-light);">Сначала добавьте магазины в разделе «Магазины».</div>';
        html+='</div></div>';
      }
    }
    if(!isAdmin() || adminTab==='shops'){
    html+='<div class="card" style="margin-bottom:14px;"><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;"><div><h3 style="margin:0 0 4px;">'+(isAdmin()?'Товары: «'+esc(stockLocationName(selectedStoreId))+'»':'Товары')+'</h3><div style="font-size:12px;color:var(--text-light);">'+(isAdmin()?'Общий каталог организации':'Каталог вашего магазина')+'</div></div>'+'<button class="btn btn-primary" type="button" onclick="stockOpenForm()">＋ Новая карточка</button>'+'</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;"><input id="stockSearch" type="search" placeholder="Поиск по названию, артикулу, цвету…" value="'+esc(searchText)+'" oninput="stockSetSearch(this.value)" style="flex:1;min-width:180px;">';
    if(isAdmin()) html+='<select id="stockFilter" onchange="stockSetFilter(this.value)" style="min-width:150px;"><option value="all" '+(activeFilter==='all'?'selected':'')+'>Все карточки</option><option value="pending" '+(activeFilter==='pending'?'selected':'')+'>Ожидают проверки</option><option value="active" '+(activeFilter==='active'?'selected':'')+'>Опубликованные</option><option value="krossy" '+(activeFilter==='krossy'?'selected':'')+'>Кроссы</option><option value="easy" '+(activeFilter==='easy'?'selected':'')+'>Изи</option></select>';
    html+='</div><div id="stockStatus" style="font-size:12px;margin-top:8px;color:var(--text-light);"></div></div>';
    if(isAdmin()&&mergeSelectingId){
      var selectedMain=products[mergeSelectingId];
      html+='<div class="card" style="margin-bottom:12px;border:1px solid var(--warning);"><b>Выбрана главная карточка:</b> '+esc(selectedMain&&selectedMain.name||'Товар')+'<div style="font-size:12px;color:var(--text-light);margin-top:4px;">Теперь выберите вторую карточку. Объединение доступно, только если фактические остатки находятся в разных магазинах.</div></div>';
    }
    if(!list.length) html+='<div class="card" style="text-align:center;color:var(--text-light);">Карточек пока нет. Создайте первую карточку товара.</div>';
    list.forEach(function(p){
      var balanceStoreId=isAdmin()?String(selectedStoreId):String(storeId());
      var currentBalance=balances[balanceStoreId]&&balances[balanceStoreId][String(p.id)]||{};
      var q=isAdmin()?qty(p.id,selectedStoreId):qty(p.id,storeId());
      var shownSizes=Array.isArray(currentBalance.sizes)?currentBalance.sizes:[];
      var sizesHtml=shownSizes.length?'<div style="font-size:13px;margin-top:6px;"><span style="color:var(--text-light);">Размеры:</span> <b>'+esc(sizeLabel(shownSizes))+'</b></div>':'<div style="font-size:12px;color:var(--text-light);margin-top:6px;">Размеры пока не добавлены</div>';
      var state=p.status==='pending'?'Ожидает проверки':p.status==='active'?'Опубликован':'Архив';
      var costHtml=isAdmin()&&p.purchaseCost!=null?'<div style="font-size:13px;margin-top:5px;">Закупка: <b>'+esc(p.purchaseCost)+'</b></div>':'';
      html+='<div class="card" style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;"><div '+(isSeller()&&p.status==='active'?'data-stock-photo="'+esc(p.id)+'" title="Нажмите, чтобы заменить фото"':'')+' style="width:76px;height:76px;border-radius:10px;background:#f7f2f4;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;'+(isSeller()&&p.status==='active'?'cursor:pointer;outline:1px dashed var(--primary);':'')+'">'+(p.photoUrl?'<img src="'+esc(cardPhotoUrl(p.photoUrl))+'" alt="" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover;">':'<span style="font-size:25px;">📦</span>')+'</div><div style="flex:1;min-width:160px;"><b '+(isSeller()&&p.status==='active'?'data-stock-rename="'+esc(p.id)+'" title="Нажмите, чтобы изменить название" style="cursor:pointer;border-bottom:1px dashed var(--primary);"':'')+'>'+esc(p.name||'Без названия')+'</b><div style="font-size:12px;color:var(--text-light);margin-top:3px;">'+esc([p.article,p.category,p.color].filter(Boolean).join(' · '))+'</div>'+sizesHtml+'<div style="font-size:12px;margin-top:5px;">'+(isAdmin()?esc(p.direction==='krossy'?'Кроссы':p.direction==='easy'?'Изи':'Не назначено')+' · ':'')+esc(state)+'</div>'+costHtml+'<div style="font-size:13px;margin-top:5px;"><b>Остаток: '+q+'</b>'+(isAdmin()?' шт. в этом магазине':' шт.')+'</div></div><div class="stock-card-actions" style="display:flex;gap:5px;flex-wrap:wrap;">';
      if(canEditCard(p)) html+='<button class="btn btn-secondary" type="button" onclick="stockOpenForm(\''+esc(p.id)+'\')">Изменить</button>';
      if(isAdmin() && p.status==='active') html+='<button class="btn btn-primary" type="button" onclick="stockMove(\''+esc(p.id)+'\',\''+esc(balanceStoreId)+'\')">Переместить</button>';
      if(isAdmin() && p.status==='active'){
        if(!mergeSelectingId) html+='<button class="btn btn-warning" type="button" data-stock-merge-start="'+esc(p.id)+'">Объединить</button>';
        else if(String(mergeSelectingId)!==String(p.id)){
          var eligibility=mergeEligibility(mergeSelectingId,p.id);
          html+='<button class="btn '+(eligibility.ok?'btn-warning':'btn-secondary')+'" type="button" data-stock-merge-finish="'+esc(p.id)+'" '+(eligibility.ok?'':'disabled title="'+esc(eligibility.reason)+'"')+'>Объединить</button>';
        } else html+='<button class="btn btn-secondary" type="button" data-stock-merge-cancel="1">Отменить выбор</button>';
      }
      if(isAdmin() && p.status==='pending') html+='<button class="btn btn-success" type="button" onclick="stockReview(\''+esc(p.id)+'\')">Проверить</button>';
      if(isSeller() && p.status==='active') html+='<button class="btn btn-secondary" type="button" onclick="stockAddSizes(\''+esc(p.id)+'\')">＋ Добавить размер</button>';
      if(isAdmin()) html+='<button class="btn btn-warning" type="button" onclick="stockDelete(\''+esc(p.id)+'\')">Удалить</button>';
      html+='</div></div>';
    });
    }
    if(isAdmin() && adminTab==='all'){
      html+='<div class="card"><h3>Все остатки по магазинам</h3><p style="font-size:12px;color:var(--text-light);">Остатки каждого товара отдельно по каждому магазину.</p><div style="overflow-x:auto;"><table style="width:100%;min-width:480px;"><thead><tr><th>Товар</th><th>Магазин</th><th>Остаток</th><th></th></tr></thead><tbody>';
      allProducts().filter(function(p){return p.status==='active';}).forEach(function(p){visibleStoreIds().forEach(function(s){html+='<tr><td>'+esc(p.name)+'</td><td>'+esc(window.STORES[s]||s)+'</td><td>'+qty(p.id,s)+'</td><td><button class="btn btn-secondary" type="button" onclick="stockAdjust(\''+esc(p.id)+'\',\''+esc(s)+'\')">Изменить</button></td></tr>';});});
      html+='</tbody></table></div></div>';
    }
    if(isAdmin() && adminTab==='history'){
      var recent=Object.keys(movements).map(function(k){return movements[k];}).filter(function(m){return m && m.org===org() && stockLocationIds().indexOf(String(m.storeId))!==-1;}).sort(function(a,b){return Number(b.createdAt||0)-Number(a.createdAt||0);}).slice(0,100);
      html+='<div class="card"><h3>История складских операций</h3><div style="overflow-x:auto;"><table style="width:100%;min-width:620px;"><thead><tr><th>Дата</th><th>Товар</th><th>Магазин</th><th>Операция</th><th>Изменение</th><th>Остаток после</th></tr></thead><tbody>';
      recent.forEach(function(m){var prod=products[m.productId]||{};var label=m.type==='receipt'?'Поступление':m.type==='sale'?'Продажа':m.type==='return'?'Возврат':m.type==='sale_return_cancel'?'Отмена возврата':m.type==='writeoff'?'Списание':m.type==='merge'?'Объединение':m.type==='transfer'?'Перемещение':'Корректировка';html+='<tr><td>'+esc(new Date(Number(m.createdAt||0)).toLocaleString('ru-RU'))+'</td><td>'+esc(prod.name||m.productName||m.productId||'—')+'</td><td>'+esc(stockLocationName(m.storeId)||'—')+'</td><td>'+label+'</td><td>'+(Number(m.quantityDelta)>0?'+':'')+Number(m.quantityDelta||0)+'</td><td>'+(m.after==null?'—':Number(m.after))+'</td></tr>';});
      if(!recent.length) html+='<tr><td colspan="6" style="color:var(--text-light);">Операций пока нет.</td></tr>';
      html+='</tbody></table></div></div>';
    }
    if(isAdmin() && adminTab==='sales'){
      var stockSales=(window.sales||[]).filter(function(s){
        if(!s||!s.stockProductId||!s.stockStoreId||visibleStoreIds().indexOf(String(s.stockStoreId))===-1)return false;
        if(s.stockOrg&&s.stockOrg!==org())return false;
        if(typeof isSaleRecordDeleted==='function'&&isSaleRecordDeleted(s.id))return false;
        if(typeof isRecordBeforeStoreReset==='function'&&isRecordBeforeStoreReset(s))return false;
        return true;
      });
      var activeStockSales=stockSales.filter(function(s){return !s.returned;});
      var returnedStockSales=stockSales.filter(function(s){return !!s.returned;});
      var netRevenue=activeStockSales.reduce(function(sum,s){return sum+(Number(s.price)||0);},0);
      var returnedRevenue=returnedStockSales.reduce(function(sum,s){return sum+(Number(s.price)||0);},0);
      var netUnits=activeStockSales.reduce(function(sum,s){return sum+(Number(s.stockQuantity)||1);},0);
      var groups={},sizesSummary={};
      stockSales.forEach(function(s){
        var pid=String(s.stockProductId),name=String(s.stockProductName||s.name||'Без названия');
        if(!groups[pid])groups[pid]={name:name,sales:0,returned:0,units:0,revenue:0,returnedRevenue:0};
        var g=groups[pid],q=Number(s.stockQuantity)||1;g.sales++;
        if(s.returned){g.returned++;g.returnedRevenue+=Number(s.price)||0;}else{g.units+=q;g.revenue+=Number(s.price)||0;}
        var sk=pid+'|'+String(s.stockSize||'—');
        if(!sizesSummary[sk])sizesSummary[sk]={name:name,size:String(s.stockSize||'—'),units:0,returned:0};
        if(s.returned)sizesSummary[sk].returned+=q;else sizesSummary[sk].units+=q;
      });
      html+='<div class="card" style="margin-bottom:14px;"><h3>Складские продажи</h3><p style="font-size:12px;color:var(--text-light);">Здесь учитываются только продажи с привязкой к карточке склада. Старые продажи без складской привязки остаются в общей аналитике.</p><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;"><div class="card"><div style="font-size:12px;color:var(--text-light);">Продаж без возврата</div><b style="font-size:22px;">'+activeStockSales.length+'</b></div><div class="card"><div style="font-size:12px;color:var(--text-light);">Продано единиц</div><b style="font-size:22px;">'+netUnits+'</b></div><div class="card"><div style="font-size:12px;color:var(--text-light);">Выручка без возвратов</div><b style="font-size:22px;">'+netRevenue.toLocaleString('ru-RU')+' ₽</b></div><div class="card"><div style="font-size:12px;color:var(--text-light);">Возвраты</div><b style="font-size:22px;">'+returnedStockSales.length+' · '+returnedRevenue.toLocaleString('ru-RU')+' ₽</b></div></div></div>';
      html+='<div class="card" style="margin-bottom:14px;"><h3>Товары</h3><div style="overflow-x:auto;"><table style="width:100%;min-width:540px;"><thead><tr><th>Карточка склада</th><th>Продаж</th><th>Единиц без возврата</th><th>Возвратов</th><th>Выручка</th></tr></thead><tbody>';
      Object.keys(groups).sort(function(a,b){return groups[b].units-groups[a].units;}).forEach(function(pid){var g=groups[pid];html+='<tr><td>'+esc(g.name)+'</td><td>'+g.sales+'</td><td>'+g.units+'</td><td>'+g.returned+'</td><td>'+g.revenue.toLocaleString('ru-RU')+' ₽</td></tr>';});
      if(!Object.keys(groups).length)html+='<tr><td colspan="5" style="color:var(--text-light);">Складских продаж пока нет.</td></tr>';
      html+='</tbody></table></div></div>';
      html+='<div class="card"><h3>Продажи по размерам</h3><div style="overflow-x:auto;"><table style="width:100%;min-width:420px;"><thead><tr><th>Товар</th><th>Размер</th><th>Продано</th><th>Возвращено</th></tr></thead><tbody>';
      Object.keys(sizesSummary).sort(function(a,b){return sizesSummary[b].units-sizesSummary[a].units;}).forEach(function(k){var z=sizesSummary[k];html+='<tr><td>'+esc(z.name)+'</td><td>'+esc(z.size)+'</td><td>'+z.units+'</td><td>'+z.returned+'</td></tr>';});
      if(!Object.keys(sizesSummary).length)html+='<tr><td colspan="4" style="color:var(--text-light);">Данных по размерам пока нет.</td></tr>';
      html+='</tbody></table></div></div>';
    }
    root.innerHTML=html;
    root.querySelectorAll('[data-stock-tab]').forEach(function(b){b.addEventListener('click',function(){adminTab=b.getAttribute('data-stock-tab');render();});});
    root.querySelectorAll('[data-stock-select-store]').forEach(function(b){b.addEventListener('click',function(){selectedStoreId=b.getAttribute('data-stock-select-store');render();});});
    root.querySelectorAll('[data-stock-rename]').forEach(function(el){el.addEventListener('click',function(){renameProduct(el.getAttribute('data-stock-rename'));});});
    root.querySelectorAll('[data-stock-photo]').forEach(function(el){el.addEventListener('click',function(){chooseProductPhoto(el.getAttribute('data-stock-photo'));});});
    root.querySelectorAll('[data-stock-merge-start]').forEach(function(b){b.addEventListener('click',function(){mergeSelectingId=String(b.getAttribute('data-stock-merge-start')||'');render();});});
    root.querySelectorAll('[data-stock-merge-cancel]').forEach(function(b){b.addEventListener('click',function(){mergeSelectingId='';render();});});
    root.querySelectorAll('[data-stock-merge-finish]').forEach(function(b){b.addEventListener('click',function(){merge(mergeSelectingId,b.getAttribute('data-stock-merge-finish'));});});
  }
  function openForm(id){
    if(!isAdmin()&&!isSeller()){alert('Нет доступа к созданию карточек.');return;}
    if(id&&!isAdmin()){alert('Продавцы не могут редактировать существующие карточки.');return;}
    if(!canUse()){alert('Нет подтверждённого подключения к Firebase.');return;}
    var p=id?products[id]:null;
    if(p && !canEditCard(p)){alert('Эту карточку нельзя редактировать.');return;}
    editingId=id||'';
    var ownStoreBalance=p&&isSeller()&&balances[String(storeId())]?balances[String(storeId())][String(p.id)]||{}:{};
    var editStoreIds=p&&isAdmin()?stockLocationIds():[];
    var editStoreId=p&&isAdmin()?(editStoreIds.indexOf(String(selectedStoreId))>=0?String(selectedStoreId):(editStoreIds[0]||'')):'';
    var editStoreBalance=p&&isAdmin()&&editStoreId&&balances[editStoreId]?balances[editStoreId][String(p.id)]||{}:{};
    formSizes=p?(isSeller()?(Array.isArray(ownStoreBalance.sizes)?ownStoreBalance.sizes.map(String):[]):(isAdmin()?(Array.isArray(editStoreBalance.sizes)?editStoreBalance.sizes.map(String):[]):(Array.isArray(p.sizes)?p.sizes.map(String):(p.size?[String(p.size)]:[])))):[];
    var combinedName=p?[p.name,p.model].filter(Boolean).join(' '):'';
    var html='<div id="stockModal" style="position:fixed;inset:0;background:rgba(20,10,16,.55);z-index:1000;display:flex;align-items:center;justify-content:center;padding:14px;"><div class="card" style="width:min(620px,100%);max-height:90vh;overflow:auto;"><div style="display:flex;justify-content:space-between;gap:10px;"><h3>'+(p?'Редактирование карточки':'Новая карточка товара')+'</h3><button class="btn btn-secondary" onclick="stockCloseForm()">✕</button></div><div class="form-group"><label>Название товара / бренд / модель *</label><input id="stockName" value="'+esc(combinedName)+'" maxlength="180" placeholder="Например: Nike Air Max 90"></div><div class="form-group"><label>Категория товара</label><select id="stockCategory"><option value="">Выберите товар из списка…</option></select><div style="font-size:12px;color:var(--text-light);margin-top:5px;">Категория выбирается из общего списка товаров.</div></div><div class="form-group"><label>Артикул</label><input id="stockArticle" value="'+esc(p&&p.article)+'" placeholder="Будет создан автоматически" '+(isSeller()?'readonly':'')+'></div><div class="form-group"><label>Цвет</label><input id="stockColor" value="'+esc(p&&p.color)+'"></div><div class="form-group">'+(p&&isAdmin()?'<label>Остатки какого магазина показать</label><select id="stockEditStore" style="width:100%;margin-bottom:10px;">'+editStoreIds.map(function(k){return '<option value="'+esc(k)+'" '+(String(k)===editStoreId?'selected':'')+'>'+esc(stockLocationName(k))+'</option>';}).join('')+'</select>':'')+'<label>Размеры</label><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;"><button class="btn btn-secondary" type="button" data-size-mode="numeric" aria-pressed="true">Цифры 25–54</button><button class="btn btn-secondary" type="button" data-size-mode="letters" aria-pressed="false">Буквы</button></div><div id="stockSizeGrid" style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px;"></div><div style="font-size:12px;color:var(--text-light);margin-top:8px;">Нажмите на размер — каждое нажатие добавляет ещё одну штуку. Повторные размеры учитываются отдельно.</div><div id="stockSelectedSizes" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;"></div><div id="stockLiveCount" style="font-weight:700;margin-top:10px;">Остаток: 0 шт.</div></div><div class="form-group"><label>Фотография товара (необязательно)</label><div style="display:flex;gap:8px;flex-wrap:wrap;"><label class="btn btn-secondary" for="stockPhotoCamera">📷 Сделать фото</label><label class="btn btn-secondary" for="stockPhotoGallery">Выбрать из галереи</label></div><input id="stockPhotoCamera" type="file" accept="image/*" capture="environment" style="display:none;"><input id="stockPhotoGallery" type="file" accept="image/*" style="display:none;"><div id="stockPhotoName" style="font-size:12px;color:var(--text-light);margin-top:7px;">'+(p&&p.photoUrl?'Фото уже прикреплено. Можно сделать новое или выбрать другое.':'Фото можно добавить с камеры или из галереи.')+'</div>'+(p&&p.photoUrl?'<label style="display:block;margin-top:6px;"><input id="stockRemovePhoto" type="checkbox"> Удалить текущее фото</label>':'')+'</div>';
    if(isAdmin()&&!p){var stockStores=stockLocationIds();html+='<div class="form-group"><label>Место хранения для начального остатка</label><select id="stockInitialStore"><option value="">Выбрать место…</option>'+stockStores.map(function(k){return '<option value="'+esc(k)+'" '+(String(k)===String(selectedStoreId)?'selected':'')+'>'+esc(stockLocationName(k))+'</option>';}).join('')+'</select><div style="font-size:12px;color:var(--text-light);margin-top:5px;">Размеры при создании будут записаны как остаток выбранного магазина.</div></div>';}
    if(isAdmin()) html+='<div class="form-group"><label>Закупочная стоимость</label><input id="stockPurchaseCost" type="number" min="0" step="0.01" value="'+esc(p&&p.purchaseCost!=null?p.purchaseCost:'')+'" placeholder="Например, 2500"></div><div class="form-group"><label>Направление</label><select id="stockDirection"><option value="">Выбрать…</option><option value="krossy" '+(p&&p.direction==='krossy'?'selected':'')+'>Кроссы</option><option value="easy" '+(p&&p.direction==='easy'?'selected':'')+'>Изи</option></select></div>';
    html+='<div id="stockSaveError" style="color:#b42318;font-size:13px;margin:8px 0;"></div><div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;"><button class="btn btn-secondary" onclick="stockCloseForm()">Отмена</button><button class="btn btn-primary" onclick="stockSave()">Сохранить</button></div></div></div>';
    document.body.insertAdjacentHTML('beforeend',html);
    var categorySelect=document.getElementById('stockCategory');
    var catalogItems=[];
    try {
      catalogItems=typeof getVisibleProductCatalog==='function' ? getVisibleProductCatalog(false) : (Array.isArray(window.productCatalog)?window.productCatalog:[]);
    } catch(e) { catalogItems=Array.isArray(window.productCatalog)?window.productCatalog:[]; }
    catalogItems=catalogItems.filter(function(item){return item && item.active!==false && String(item.name||'').trim();}).sort(function(a,b){return String(a.name).localeCompare(String(b.name),'ru');});
    var categoryNames=[];
    catalogItems.forEach(function(item){var name=String(item.name||'').trim();if(name && categoryNames.indexOf(name)===-1)categoryNames.push(name);});
    if(p&&p.category&&categoryNames.indexOf(String(p.category))===-1)categoryNames.unshift(String(p.category));
    categoryNames.forEach(function(name){var option=document.createElement('option');option.value=name;option.textContent=name;categorySelect.appendChild(option);});
    categorySelect.value=p&&p.category?String(p.category):'';
    if(!categoryNames.length){categorySelect.options[0].textContent='Список товаров пока пуст';categorySelect.disabled=true;}
    var grid=document.getElementById('stockSizeGrid'), selected=document.getElementById('stockSelectedSizes');
    var editStoreSelect=document.getElementById('stockEditStore');
    if(editStoreSelect)editStoreSelect.addEventListener('change',function(){selectedStoreId=String(this.value||'');var balance=balances[selectedStoreId]&&balances[selectedStoreId][String(p.id)]||{};formSizes=Array.isArray(balance.sizes)?balance.sizes.map(String):[];drawSizes();});
    var sizeMode='numeric', letters=['XXS','XS','S','M','L','XL','2XL','3XL','4XL','5XL'];
    function currentSizes(){return sizeMode==='numeric'?Array.from({length:30},function(_,i){return String(i+25);}):letters.slice();}
    function countSizes(){var counts={};formSizes.forEach(function(v){counts[v]=(counts[v]||0)+1;});return counts;}
    function drawSizes(){
      var counts=countSizes();grid.innerHTML='';
      currentSizes().forEach(function(v){
        var button=document.createElement('button');button.type='button';button.textContent=v+(counts[v]?'  × '+counts[v]:'');
        button.style.cssText='min-height:42px;border:1px solid '+(counts[v]?'var(--accent,#7c3aed)':'var(--border)')+';border-radius:9px;background:'+(counts[v]?'rgba(124,58,237,.10)':'var(--card-bg,#fff)')+';font-weight:600;cursor:pointer;';
        button.addEventListener('click',function(){formSizes.push(v);drawSizes();});
        grid.appendChild(button);
      });
      document.querySelectorAll('[data-size-mode]').forEach(function(button){
        var active=button.getAttribute('data-size-mode')===sizeMode;
        button.style.opacity=active?'1':'.65';button.setAttribute('aria-pressed',active?'true':'false');
      });
      selected.innerHTML='';
      var ordered=Object.keys(counts).sort(function(a,b){
        var an=/^\d+$/.test(a),bn=/^\d+$/.test(b);
        if(an&&bn)return Number(a)-Number(b);if(an)return -1;if(bn)return 1;
        return letters.indexOf(a)-letters.indexOf(b);
      });
      ordered.forEach(function(v){
        var chip=document.createElement('span');chip.style.cssText='display:inline-flex;align-items:center;gap:5px;padding:5px 7px;border:1px solid var(--border);border-radius:8px;background:var(--card-bg,#fff);';
        var label=document.createElement('b');label.textContent=v+' × '+counts[v];chip.appendChild(label);
        if(isAdmin()){var minus=document.createElement('button');minus.type='button';minus.textContent='−';minus.title='Уменьшить количество';minus.style.cssText='border:0;background:transparent;font-size:18px;cursor:pointer;padding:0 3px;';
        minus.addEventListener('click',function(){var i=formSizes.indexOf(v);if(i>=0)formSizes.splice(i,1);drawSizes();});chip.appendChild(minus);}
        var plus=document.createElement('button');plus.type='button';plus.textContent='+';plus.title='Увеличить количество';plus.style.cssText='border:0;background:transparent;font-size:17px;cursor:pointer;padding:0 3px;';
        plus.addEventListener('click',function(){formSizes.push(v);drawSizes();});
        chip.appendChild(plus);selected.appendChild(chip);
      });
      if(!formSizes.length)selected.textContent='Размеры пока не добавлены';
      var liveCount=document.getElementById('stockLiveCount');if(liveCount)liveCount.textContent='Остаток: '+formSizes.length+' шт.';
    }
    document.querySelectorAll('[data-size-mode]').forEach(function(button){button.addEventListener('click',function(){sizeMode=button.getAttribute('data-size-mode');drawSizes();});});
    drawSizes();
    var cameraInput=document.getElementById('stockPhotoCamera'),galleryInput=document.getElementById('stockPhotoGallery'),photoName=document.getElementById('stockPhotoName');
    function showChosenPhoto(input,other){
      if(input.files&&input.files[0]){if(other)other.value='';photoName.textContent='Выбрано: '+input.files[0].name;}
      else if(!(galleryInput.files&&galleryInput.files[0])&&!(cameraInput.files&&cameraInput.files[0]))photoName.textContent="Фото можно добавить с камеры или из галереи.";
    }
    cameraInput.addEventListener('change',function(){showChosenPhoto(cameraInput,galleryInput);});
    galleryInput.addEventListener('change',function(){showChosenPhoto(galleryInput,cameraInput);});
  }
  function closeForm(){var el=document.getElementById('stockModal');if(el)el.remove();}
  // Подготавливает фото товара перед отправкой: уменьшает размер и сжимает JPEG на устройстве.
  function prepareStockPhoto(file){
    return new Promise(function(resolve){
      if(!file || !/^image\//i.test(file.type||'')){resolve(file);return;}
      function compress(source,width,height){
        var maxSide=1600,scale=Math.min(1,maxSide/Math.max(width,height));
        var w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
        var canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
        if(!ctx){resolve(file);return;}
        canvas.width=w;canvas.height=h;
        ctx.fillStyle='#ffffff';ctx.fillRect(0,0,w,h);
        ctx.drawImage(source,0,0,w,h);
        function encode(){
          var qualities=[0.82,0.76,0.70],index=0;
          function attempt(){
            canvas.toBlob(function(blob){
              if(!blob){resolve(file);return;}
              if(blob.size<=450*1024 || index>=qualities.length-1 || Math.max(canvas.width,canvas.height)<=1000){
                if(blob.size>450*1024 && Math.max(canvas.width,canvas.height)>1000){
                  var nw=Math.max(1,Math.round(canvas.width*0.85)),nh=Math.max(1,Math.round(canvas.height*0.85));
                  var smaller=document.createElement('canvas'),sctx=smaller.getContext('2d');
                  if(!sctx){finish(blob);return;}
                  smaller.width=nw;smaller.height=nh;sctx.fillStyle='#fff';sctx.fillRect(0,0,nw,nh);sctx.drawImage(canvas,0,0,nw,nh);
                  canvas=smaller;index=0;attempt();return;
                }
                finish(blob);return;
              }
              index++;attempt();
            },'image/jpeg',qualities[index]);
          }
          function finish(blob){
            if(blob.size>=file.size){resolve(file);return;}
            var name=(file.name||'photo').replace(/\\.[^.]+$/,'')+'.jpg';
            try{resolve(new File([blob],name,{type:'image/jpeg',lastModified:Date.now()}));}
            catch(e){blob.name=name;resolve(blob);}
          }
          attempt();
        }
        encode();
      }
      if(typeof createImageBitmap==='function'){
        createImageBitmap(file).then(function(bitmap){
          try{compress(bitmap,bitmap.width,bitmap.height);}finally{if(bitmap.close)bitmap.close();}
        }).catch(function(){resolve(file);});
        return;
      }
      var objectUrl=URL.createObjectURL(file),img=new Image();
      img.onload=function(){try{compress(img,img.naturalWidth||img.width,img.naturalHeight||img.height);}catch(e){resolve(file);}finally{URL.revokeObjectURL(objectUrl);}};
      img.onerror=function(){URL.revokeObjectURL(objectUrl);resolve(file);};
      img.src=objectUrl;
    });
  }

  function save(skipPhoto){
    if(!isAdmin()&&!isSeller()){alert('Нет доступа к созданию карточек.');return;}
    if(isSeller()&&editingId){alert('Продавцы не могут редактировать существующие карточки.');return;}
    if(!canUse()) {alert('Нет подтверждённого подключения к Firebase.');return;}
    var name=(document.getElementById('stockName').value||'').trim(); if(!name){alert('Введите название товара, бренд или модель.');return;}
    var old=editingId?products[editingId]:null, id=editingId||uid('sp');
    var record=Object.assign({},old||{},{id:id,org:old?old.org:org(),name:name,
      category:(document.getElementById('stockCategory').value||'').trim(),
      article:(document.getElementById('stockArticle').value||'').trim() || (old&&old.article) || ('ST-'+Date.now().toString(36).toUpperCase()),
      model:'',color:(document.getElementById('stockColor').value||'').trim(),
      size:isSeller()&&old?(old.size||''):(isAdmin()&&old?(old.size||''):(formSizes.length?formSizes[0]:'')),sizes:isSeller()&&old?(Array.isArray(old.sizes)?old.sizes.slice():(old.size?[old.size]:[])):(isAdmin()&&old?(Array.isArray(old.sizes)?old.sizes.slice():(old.size?[old.size]:[])):formSizes.slice()),
      status:old?old.status:'pending',createdAt:old?old.createdAt:Date.now(),
      createdById:old?old.createdById:String(user().id),
      createdByName:old?old.createdByName:(user().name||user().username||''),
      updatedAt:Date.now(),updatedById:String(user().id)});
    delete record.description;
    if(isAdmin()){
      var costInput=document.getElementById('stockPurchaseCost'),costRaw=costInput?String(costInput.value||'').trim():'';
      if(costRaw!==''&&(!Number.isFinite(Number(costRaw))||Number(costRaw)<0)){alert('Введите корректную закупочную стоимость — ноль или больше.');return;}
      record.purchaseCost=costRaw===''?null:Number(costRaw);
      var d=document.getElementById('stockDirection');if(d&&d.value)record.direction=d.value;
    }
    if(isAdmin()&&old&&old.status==='pending'&&record.direction)record.status='active';
    var removePhoto=document.getElementById('stockRemovePhoto');if(removePhoto&&removePhoto.checked){delete record.photoUrl;delete record.photoPath;delete record.photoPublicId;}
    var camera=document.getElementById('stockPhotoCamera'),gallery=document.getElementById('stockPhotoGallery');
    var file=!skipPhoto&&((camera&&camera.files&&camera.files[0])||(gallery&&gallery.files&&gallery.files[0]));
    var saveButton=document.querySelector('#stockModal button.btn-primary'),errorBox=document.getElementById('stockSaveError');
    function showError(message,offerNoPhoto){
      if(saveButton){saveButton.disabled=false;saveButton.textContent='Сохранить';}
      if(errorBox){errorBox.textContent=message;if(offerNoPhoto){var fallback=document.createElement('button');fallback.type='button';fallback.className='btn btn-secondary';fallback.style.marginTop='7px';fallback.textContent='Сохранить карточку без фото';fallback.onclick=function(){fallback.remove();save(true);};errorBox.appendChild(document.createElement('br'));errorBox.appendChild(fallback);}}
      else alert(message);
    }
    if(file&&file.size>8*1024*1024){showError('Фото должно быть не больше 8 МБ.',false);return;}
    if(saveButton){saveButton.disabled=true;saveButton.textContent=file?'Загружаем фото…':'Сохраняем…';}
    var upload=Promise.resolve();
    if(file){
      var cloudinaryUrl='https://api.cloudinary.com/v1_1/gnesaxoh/image/upload';
      var uploadPreset='easy_stock_photos';
      var safeOrg=String(record.org||'org').replace(/[^a-zA-Z0-9_-]/g,'_');
      upload=new Promise(function(resolve,reject){
        var xhr=new XMLHttpRequest(), formData=new FormData();
        formData.append('upload_preset',uploadPreset);
        formData.append('folder','stock-products/'+safeOrg);
        xhr.open('POST',cloudinaryUrl,true);
        xhr.timeout=45000;
        xhr.upload.onprogress=function(event){
          if(event.lengthComputable&&saveButton){
            var percent=Math.round(event.loaded/event.total*100);
            saveButton.textContent='Загружаем фото… '+percent+'%';
          }
        };
        xhr.onload=function(){
          var response={};
          try{response=JSON.parse(xhr.responseText||'{}');}catch(e){}
          if(xhr.status>=200&&xhr.status<300&&response.secure_url){
            record.photoUrl=response.secure_url;
            record.photoPublicId=response.public_id||'';
            delete record.photoPath;
            resolve();
          }else{
            reject(new Error(response.error&&response.error.message?response.error.message:'Cloudinary вернул ошибку загрузки (HTTP '+xhr.status+').'));
          }
        };
        xhr.onerror=function(){reject(new Error('Не удалось связаться с Cloudinary. Проверьте интернет.'));};
        xhr.ontimeout=function(){reject(new Error('Загрузка фото не завершилась за 45 секунд. Проверьте интернет.'));};
        xhr.onabort=function(){reject(new Error('Загрузка фотографии отменена.'));};
        if(saveButton)saveButton.textContent='Подготавливаем фото…';
        prepareStockPhoto(file).then(function(preparedFile){
          formData.append('file',preparedFile,preparedFile.name||file.name||'product-photo.jpg');
          try{xhr.send(formData);}catch(e){reject(e);}
        }).catch(reject);
      });
    }
    var initialStore='';if(!old&&isAdmin()&&formSizes.length){var initialStoreEl=document.getElementById('stockInitialStore');initialStore=initialStoreEl?String(initialStoreEl.value||''):'';if(!initialStore||stockLocationIds().indexOf(initialStore)<0){showError('Выберите магазин для начального остатка.');return;}}
    upload.then(function(){var patch={};patch[PRODUCTS_PATH+'/'+id]=record;if(isSeller()&&old){var sid=String(storeId()),before=qty(id,sid),after=formSizes.length,now=Date.now();patch[BALANCES_PATH+'/'+sid+'/'+id]={quantity:after,sizes:formSizes.slice(),updatedAt:now};if(after!==before){var mid=uid('sm');patch[MOVEMENTS_PATH+'/'+mid]={id:mid,org:org(),productId:id,productName:record.name,storeId:sid,type:after>before?'receipt':'adjustment',quantityDelta:after-before,before:before,after:after,note:'Изменение размеров при редактировании карточки',createdAt:now,createdById:String(user().id),createdByName:user().name||''};}}if(isAdmin()&&old){var editStoreEl=document.getElementById('stockEditStore'),adminSid=String(editStoreEl?editStoreEl.value:(selectedStoreId||'')),adminBefore=qty(id,adminSid),adminAfter=formSizes.length,adminNow=Date.now();if(!adminSid||stockLocationIds().indexOf(adminSid)<0)throw new Error('Выберите магазин для обновления остатков.');selectedStoreId=adminSid;patch[BALANCES_PATH+'/'+adminSid+'/'+id]={quantity:adminAfter,sizes:formSizes.slice(),updatedAt:adminNow};if(adminAfter!==adminBefore){var adminMid=uid('sm');patch[MOVEMENTS_PATH+'/'+adminMid]={id:adminMid,org:org(),productId:id,productName:record.name,storeId:adminSid,type:adminAfter>adminBefore?'receipt':'adjustment',quantityDelta:adminAfter-adminBefore,before:adminBefore,after:adminAfter,note:'Изменение размеров при редактировании карточки администратором',createdAt:adminNow,createdById:String(user().id),createdByName:user().name||''};}}if(!old&&formSizes.length&&(isSeller()||isAdmin())){var initialQty=formSizes.length,initialNow=Date.now(),initialMid=uid('sm'),sid=isSeller()?String(storeId()):initialStore;patch[BALANCES_PATH+'/'+sid+'/'+id]={quantity:initialQty,sizes:formSizes.slice(),updatedAt:initialNow};patch[MOVEMENTS_PATH+'/'+initialMid]={id:initialMid,org:org(),productId:id,productName:record.name,storeId:sid,type:'receipt',quantityDelta:initialQty,before:0,after:initialQty,note:isSeller()?'Новая карточка и начальные размеры от продавца':'Начальный остаток по выбранным размерам',createdAt:initialNow,createdById:String(user().id),createdByName:user().name||''};}return db.ref().update(patch);}).then(function(){
      products[id]=record;
      
      closeForm();addAuditSafe(old?'stock_product_edit':'stock_product_create',(old?'Изменена':'Создана')+' карточка склада: '+record.name);render();
    }).catch(function(e){
      console.error('Stock card/photo save failed:',e);
      var code=e&&e.code?' ('+e.code+')':'',detail=e&&e.message?e.message:String(e);
      showError((file?'Не удалось загрузить фотографию или сохранить карточку: ':'Не удалось сохранить карточку: ')+detail+code,file&&!skipPhoto);
    });
  }
  function review(id){
    if(!isAdmin() || !canUse())return;
    var p=products[id]; if(!p || p.status!=='pending')return;
    var d=prompt('Направление карточки: введите «Кроссы» или «Изи».','Кроссы'); if(!d)return;
    var direction=/^крос/i.test(d.trim())?'krossy':/^изи/i.test(d.trim())?'easy':'';
    if(!direction){alert('Введите «Кроссы» или «Изи».');return;}
    db.ref(PRODUCTS_PATH+'/'+id).update({direction:direction,status:'active',reviewedAt:Date.now(),reviewedById:String(user().id),updatedAt:Date.now()}).then(function(){addAuditSafe('stock_product_approve','Проверена и опубликована карточка: '+p.name+' ('+direction+')');});
  }
  function adjust(id,sid){
    if(!isAdmin()||!canUse())return;
    var p=products[id];if(!p)return;
    var stores=visibleStoreIds();if(!stores.length){alert('Сначала добавьте магазины.');return;}
    var menu=stores.map(function(k,n){return (n+1)+'. '+(STORES[k]||k)+' ['+k+']';}).join('\n');
    var chosen=prompt('Выберите магазин — введите его номер или ID:\n'+menu,sid||'1');
    if(chosen===null)return;
    var store=String(chosen).trim();
    if(/^\d+$/.test(store)&&Number(store)>=1&&Number(store)<=stores.length)store=stores[Number(store)-1];
    if(stores.indexOf(store)<0){alert('Магазин не найден.');return;}
    var current=balances[String(store)]&&balances[String(store)][String(id)]||{};
    var defaults=Array.isArray(current.sizes)?current.sizes:(p.sizes&&p.sizes.length?p.sizes:(p.size?[p.size]:[]));
    var raw=prompt('Размеры и остаток для магазина «'+(STORES[store]||store)+'». Введите размеры через запятую. Каждый размер — одна штука, повторения учитываются. Например: 36, 37, 38, 38, 39',defaults.join(', '));
    if(raw===null)return;
    var sizes=raw.split(',').map(function(x){return x.trim().toUpperCase();}).filter(Boolean);
    if(sizes.some(function(x){return !/^(2[5-9]|[3-4][0-9]|5[0-4]|XXS|XS|S|M|L|XL|2XL|3XL|4XL|5XL)$/.test(x);})){alert('Допустимы цифры 25–54 и буквенные размеры от XXS до 5XL.');return;}
    var before=qty(id,store),after=sizes.length,now=Date.now(),patch={};
    patch[BALANCES_PATH+'/'+store+'/'+id]={quantity:after,sizes:sizes,updatedAt:now};
    if(after!==before){var mid=uid('sm');patch[MOVEMENTS_PATH+'/'+mid]={id:mid,org:org(),productId:id,productName:p.name,storeId:String(store),type:after>before?'receipt':'adjustment',quantityDelta:after-before,before:before,after:after,note:'Пересчёт остатка по размерам',createdAt:now,createdById:String(user().id),createdByName:user().name||''};}
    db.ref().update(patch).then(function(){addAuditSafe('stock_sizes_adjustment','Размеры и остаток «'+p.name+'» в магазине «'+(STORES[store]||store)+'»: '+before+' → '+after);render();}).catch(function(e){alert('Не удалось сохранить размеры и остаток: '+e.message);});
  }
  function addSizes(id){
    if(!isSeller()||!canUse())return;
    var p=products[id];if(!p||!sellerCanSee(p)||p.status!=='active')return;
    var sid=String(storeId()),current=balances[sid]&&balances[sid][String(id)]||{};
    var existing=Array.isArray(current.sizes)?current.sizes.map(function(x){return String(x).toUpperCase();}):[];
    var added=[],modal=document.getElementById('stockAddSizesModal');if(modal)modal.remove();
    var letters=['XXS','XS','S','M','L','XL','2XL','3XL','4XL','5XL'],sizeMode='numeric';
    var html='<div id="stockAddSizesModal" style="position:fixed;inset:0;background:rgba(20,10,16,.55);z-index:1000;display:flex;align-items:center;justify-content:center;padding:14px;"><div class="card" style="width:min(560px,100%);max-height:90vh;overflow:auto;"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center;"><div><h3 style="margin:0 0 4px;">Добавить размеры</h3><div style="font-size:13px;color:var(--text-light);">'+esc(p.name)+'</div></div><button class="btn btn-secondary" type="button" id="stockAddSizesClose">✕</button></div>';
    html+='<div style="margin-top:14px;padding:10px;border-radius:9px;background:var(--bg-secondary,#f7f7f7);"><b style="font-size:13px;">Уже есть в магазине</b><div style="font-size:13px;margin-top:5px;">'+(existing.length?esc(sizeLabel(existing)):'Размеры ещё не добавлены')+'</div><div style="font-size:12px;color:var(--text-light);margin-top:4px;">Существующие размеры сохранятся. Удалять их нельзя.</div></div>';
    html+='<div class="form-group" style="margin-top:14px;"><label>Выберите новые размеры</label><div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 10px;"><button class="btn btn-secondary" type="button" data-add-size-mode="numeric">Цифры 25–54</button><button class="btn btn-secondary" type="button" data-add-size-mode="letters">Буквы</button></div><div id="stockAddSizeGrid" style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px;"></div><div style="font-size:12px;color:var(--text-light);margin-top:8px;">Каждое нажатие добавляет одну пару. Повторные нажатия увеличивают количество выбранного размера.</div><div id="stockAddSizeSelected" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;"></div><div id="stockAddSizeCount" style="font-weight:700;margin-top:10px;">Новых пар: 0</div></div>';
    html+='<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px;"><button class="btn btn-secondary" type="button" id="stockAddSizesCancel">Отмена</button><button class="btn btn-primary" type="button" id="stockAddSizesSave" disabled>Добавить размеры</button></div></div></div>';
    document.body.insertAdjacentHTML('beforeend',html);
    var grid=document.getElementById('stockAddSizeGrid'),selected=document.getElementById('stockAddSizeSelected'),count=document.getElementById('stockAddSizeCount'),saveButton=document.getElementById('stockAddSizesSave');
    function draw(){
      var counts={};added.forEach(function(v){counts[v]=(counts[v]||0)+1;});
      grid.innerHTML='';
      var values=sizeMode==='numeric'?Array.from({length:30},function(_,i){return String(i+25);}):letters;
      values.forEach(function(v){
        var button=document.createElement('button');button.type='button';button.textContent=v+(counts[v]?' × '+counts[v]:'');
        button.style.cssText='min-height:42px;border:1px solid '+(counts[v]?'var(--accent,#7c3aed)':'var(--border)')+';border-radius:9px;background:'+(counts[v]?'rgba(124,58,237,.10)':'var(--card-bg,#fff)')+';font-weight:600;cursor:pointer;';
        button.addEventListener('click',function(){added.push(v);draw();});grid.appendChild(button);
      });
      document.querySelectorAll('[data-add-size-mode]').forEach(function(b){var active=b.getAttribute('data-add-size-mode')===sizeMode;b.style.opacity=active?'1':'.65';b.setAttribute('aria-pressed',active?'true':'false');});
      selected.innerHTML='';
      Object.keys(counts).sort(function(a,b){var an=/^\d+$/.test(a),bn=/^\d+$/.test(b);if(an&&bn)return Number(a)-Number(b);if(an)return -1;if(bn)return 1;return letters.indexOf(a)-letters.indexOf(b);}).forEach(function(v){
        var chip=document.createElement('span');chip.style.cssText='padding:5px 8px;border:1px solid var(--border);border-radius:8px;background:var(--card-bg,#fff);font-weight:600;';chip.textContent=v+' × '+counts[v];selected.appendChild(chip);
      });
      count.textContent='Новых пар: '+added.length;saveButton.disabled=!added.length;
    }
    function close(){var el=document.getElementById('stockAddSizesModal');if(el)el.remove();}
    document.getElementById('stockAddSizesClose').addEventListener('click',close);
    document.getElementById('stockAddSizesCancel').addEventListener('click',close);
    document.querySelectorAll('[data-add-size-mode]').forEach(function(b){b.addEventListener('click',function(){sizeMode=b.getAttribute('data-add-size-mode');draw();});});
    saveButton.addEventListener('click',function(){
      if(!added.length)return;
      saveButton.disabled=true;saveButton.textContent='Сохраняем…';
      var combined=existing.concat(added),before=qty(id,sid),after=combined.length,now=Date.now(),mid=uid('sm'),patch={};
      patch[BALANCES_PATH+'/'+sid+'/'+id]={quantity:after,sizes:combined,updatedAt:now};
      if(after!==before)patch[MOVEMENTS_PATH+'/'+mid]={id:mid,org:org(),productId:id,productName:p.name,storeId:sid,type:'receipt',quantityDelta:after-before,before:before,after:after,note:'Добавлены размеры в магазине',createdAt:now,createdById:String(user().id),createdByName:user().name||''};
      db.ref().update(patch).then(function(){addAuditSafe('stock_store_sizes_added','Добавлены размеры товара «'+p.name+'» в магазине «'+(STORES[sid]||sid)+'»: '+added.join(', '));close();render();}).catch(function(e){saveButton.disabled=false;saveButton.textContent='Добавить размеры';alert('Не удалось добавить размеры: '+e.message);});
    });
    draw();
  }
  function deleteProduct(id){
    if(!isAdmin()||!canUse())return;var p=products[id];if(!p)return;
    if(!confirm('Полностью удалить карточку «'+p.name+'» и остатки во всех магазинах? История операций останется для учёта.'))return;
    var patch={};patch[PRODUCTS_PATH+'/'+id]=null;
    Object.keys(balances).forEach(function(sid){if(balances[sid]&&balances[sid][id])patch[BALANCES_PATH+'/'+sid+'/'+id]=null;});
    Object.keys(movements).forEach(function(mid){var m=movements[mid];if(m&&String(m.productId)===String(id))patch[MOVEMENTS_PATH+'/'+mid+'/productName']=p.name;});
    db.ref().update(patch).then(function(){addAuditSafe('stock_product_delete','Полностью удалена карточка склада: '+p.name);}).catch(function(e){alert('Не удалось удалить карточку: '+e.message);});
  }
  function moveProduct(id,sourceId){
    if(!isAdmin()||!canUse())return;
    var p=products[String(id)];if(!p)return;
    var locations=stockLocationIds(),source=String(sourceId);
    var targets=locations.filter(function(k){return k!==source;});
    if(!targets.length){alert('Нет другого места хранения для перемещения.');return;}
    var menu=targets.map(function(k,n){return (n+1)+'. '+stockLocationName(k)+' ['+k+']';}).join('\\n');
    var choice=prompt('Куда переместить товар «'+p.name+'»? Введите номер места назначения:\\n'+menu,'1');
    if(choice===null)return;
    var target=String(choice).trim();
    if(/^\\d+$/.test(target)&&Number(target)>=1&&Number(target)<=targets.length)target=targets[Number(target)-1];
    if(targets.indexOf(target)<0){alert('Место назначения не найдено.');return;}
    var sourceBalance=balances[source]&&balances[source][String(id)]||{};
    var sourceSizes=Array.isArray(sourceBalance.sizes)?sourceBalance.sizes.slice():[];
    if(!sourceSizes.length){alert('В выбранном месте нет размеров для перемещения.');return;}
    var mode=prompt('Выберите вариант:\\n1 — Переместить целиком (все размеры и остатки)\\n2 — Переместить отдельные размеры','1');
    if(mode===null)return;
    var moving=[];
    if(String(mode).trim()==='1')moving=sourceSizes.slice();
    else if(String(mode).trim()==='2'){
      var available={};sourceSizes.forEach(function(z){var k=String(z);available[k]=(available[k]||0)+1;});
      var request=prompt('Введите размеры для перемещения через запятую. Повтор размера означает количество.\\nДоступно: '+sizeLabel(sourceSizes), '');
      if(request===null)return;
      moving=request.split(',').map(function(x){return String(x).trim().toUpperCase();}).filter(Boolean);
      var wanted={};moving.forEach(function(z){wanted[z]=(wanted[z]||0)+1;});
      if(!moving.length||Object.keys(wanted).some(function(k){return wanted[k]>(available[k]||0);})){alert('Указаны размеры или количества, которых нет в остатке. Ничего не перемещено.');return;}
    }else{alert('Выберите 1 или 2.');return;}
    var targetBalance=balances[target]&&balances[target][String(id)]||{},targetSizes=Array.isArray(targetBalance.sizes)?targetBalance.sizes.slice():[];
    var remaining=sourceSizes.slice();
    moving.forEach(function(z){var ix=remaining.indexOf(z);if(ix>=0)remaining.splice(ix,1);});
    var now=Date.now(),mid=uid('sm'),patch={};
    patch[BALANCES_PATH+'/'+source+'/'+id]={quantity:remaining.length,sizes:remaining,updatedAt:now};
    patch[BALANCES_PATH+'/'+target+'/'+id]={quantity:targetSizes.length+moving.length,sizes:targetSizes.concat(moving),updatedAt:now};
    [source,target].forEach(function(loc,index){var before=index===0?sourceSizes.length:targetSizes.length,after=index===0?remaining.length:targetSizes.length+moving.length,delta=after-before,movementId=mid+'_'+index;patch[MOVEMENTS_PATH+'/'+movementId]={id:movementId,org:org(),productId:String(id),productName:p.name,storeId:loc,type:'transfer',quantityDelta:delta,before:before,after:after,transferId:mid,fromLocation:source,toLocation:target,sizes:moving.slice(),note:'Перемещение '+stockLocationName(source)+' → '+stockLocationName(target),createdAt:now,createdById:String(user().id),createdByName:user().name||''};});
    db.ref().update(patch).then(function(){addAuditSafe('stock_transfer','Перемещён товар «'+p.name+'»: '+stockLocationName(source)+' → '+stockLocationName(target)+', '+moving.length+' шт. ('+sizeLabel(moving)+')');render();alert('Перемещение выполнено: '+moving.length+' шт.');}).catch(function(e){alert('Не удалось переместить товар: '+(e&&e.message||e));});
  }
  function activeStockStores(productId){
    return visibleStoreIds().filter(function(store){
      return Number(qty(productId,store))>0;
    }).map(String);
  }
  function mergeEligibility(mainId,sourceId){
    var main=products[String(mainId)],source=products[String(sourceId)];
    if(!main||!source)return {ok:false,reason:'Карточка не найдена.'};
    if(String(mainId)===String(sourceId))return {ok:false,reason:'Нельзя объединить карточку саму с собой.'};
    if(main.status!=='active'||source.status!=='active'||main.mergedInto||source.mergedInto)return {ok:false,reason:'Можно объединять только активные карточки.'};
    if(main.org!==source.org || (main.direction&&source.direction&&main.direction!==source.direction))return {ok:false,reason:'Карточки должны относиться к одной организации и направлению.'};
    var mainStores=activeStockStores(mainId),sourceStores=activeStockStores(sourceId);
    if(!mainStores.length||!sourceStores.length)return {ok:false,reason:'У обеих карточек должны быть фактические остатки.'};
    var overlap=mainStores.filter(function(s){return sourceStores.indexOf(s)!==-1;});
    if(overlap.length)return {ok:false,reason:'В обеих карточках есть остатки в одном магазине: '+overlap.map(function(s){return String(STORES[s]||s);}).join(', ')+'.'};
    return {ok:true,mainStores:mainStores,sourceStores:sourceStores};
  }
  function merge(mainId,sourceId){
    if(!isAdmin()||!canUse())return;
    mainId=String(mainId||'');sourceId=String(sourceId||'');
    var eligibility=mergeEligibility(mainId,sourceId);
    if(!eligibility.ok){alert(eligibility.reason);return;}
    var main=products[mainId],source=products[sourceId];
    var sourceStoreNames=eligibility.sourceStores.map(function(s){return String(STORES[s]||s);}).join(', ');
    if(!confirm('Объединить «'+source.name+'» в главную карточку «'+main.name+'»? Остатки второй карточки из магазинов '+sourceStoreNames+' будут перенесены. Первая карточка останется главной.'))return;
    var patch={},now=Date.now();
    eligibility.sourceStores.forEach(function(store){
      var sourceBalance=balances[store]&&balances[store][sourceId]||{};
      if(Number(sourceBalance.quantity||0)<=0)return;
      patch[BALANCES_PATH+'/'+store+'/'+mainId]=Object.assign({},sourceBalance,{updatedAt:now});
      patch[BALANCES_PATH+'/'+store+'/'+sourceId]=null;
    });
    // Remove any zero-only balance records for the source so the merged card is fully consolidated.
    visibleStoreIds().forEach(function(store){
      if(eligibility.sourceStores.indexOf(String(store))===-1 && balances[String(store)] && balances[String(store)][sourceId]){
        patch[BALANCES_PATH+'/'+store+'/'+sourceId]=null;
      }
    });
    var movementId=uid('sm');
    patch[MOVEMENTS_PATH+'/'+movementId]={id:movementId,org:org(),productId:mainId,mergedProductId:sourceId,type:'merge',createdAt:now,createdById:String(user().id),createdByName:String(user().name||''),note:'Объединение «'+source.name+'» в главную карточку «'+main.name+'». Магазины: '+sourceStoreNames};
    patch[PRODUCTS_PATH+'/'+sourceId+'/status']='merged';
    patch[PRODUCTS_PATH+'/'+sourceId+'/mergedInto']=mainId;
    patch[PRODUCTS_PATH+'/'+sourceId+'/mergedAt']=now;
    patch[PRODUCTS_PATH+'/'+sourceId+'/mergedById']=String(user().id);
    patch[PRODUCTS_PATH+'/'+sourceId+'/mergedByName']=String(user().name||'');
    patch[PRODUCTS_PATH+'/'+mainId+'/updatedAt']=now;
    db.ref().update(patch).then(function(){
      mergeSelectingId='';
      addAuditSafe('stock_product_merge','Объединена карточка «'+source.name+'» в главную карточку «'+main.name+'». Перенесены магазины: '+sourceStoreNames);
      render();
    }).catch(function(e){alert('Не удалось объединить карточки: '+(e&&e.message||e));});
  }
  function renameProduct(id){
    if(!isSeller())return;
    var p=products[String(id)];
    if(!p||!sellerCanSee(p)||p.status!=='active')return;
    var next=window.prompt('Новое наименование товара:',String(p.name||''));
    if(next===null)return;
    next=next.trim();
    if(!next){alert('Наименование не может быть пустым.');return;}
    if(next.length>180){alert('Наименование должно быть не длиннее 180 символов.');return;}
    if(next===String(p.name||''))return;
    var patch={};patch[PRODUCTS_PATH+'/'+id+'/name']=next;patch[PRODUCTS_PATH+'/'+id+'/updatedAt']=Date.now();patch[PRODUCTS_PATH+'/'+id+'/updatedById']=String(user().id);
    db.ref().update(patch).then(function(){p.name=next;p.updatedAt=Date.now();addAuditSafe('stock_product_rename','Продавец изменил наименование товара: '+next);render();}).catch(function(e){alert('Не удалось изменить наименование: '+(e&&e.message||e));});
  }
  function chooseProductPhoto(id){
    if(!isSeller())return;
    var p=products[String(id)];
    if(!p||!sellerCanSee(p)||p.status!=='active')return;
    var input=document.createElement('input');input.type='file';input.accept='image/*';input.capture='environment';input.style.display='none';
    document.body.appendChild(input);
    input.addEventListener('change',function(){
      var file=input.files&&input.files[0];input.remove();if(!file)return;
      if(!/^image\//i.test(file.type)){alert('Выберите файл изображения.');return;}
      if(file.size>8*1024*1024){alert('Фото должно быть не больше 8 МБ.');return;}
      setStatus('Загружаем новую фотографию…');
      var data=new FormData();data.append('file',file);data.append('upload_preset','easy_stock_photos');data.append('folder','stock-products/'+String(p.org||'org').replace(/[^a-zA-Z0-9_-]/g,'_'));
      var xhr=new XMLHttpRequest();xhr.open('POST','https://api.cloudinary.com/v1_1/gnesaxoh/image/upload',true);xhr.timeout=45000;
      xhr.onload=function(){
        var response={};try{response=JSON.parse(xhr.responseText||'{}');}catch(e){}
        if(xhr.status<200||xhr.status>=300||!response.secure_url){setStatus('');alert(response.error&&response.error.message||'Не удалось загрузить фотографию.');return;}
        var patch={};patch[PRODUCTS_PATH+'/'+id+'/photoUrl']=response.secure_url;patch[PRODUCTS_PATH+'/'+id+'/photoPublicId']=response.public_id||'';patch[PRODUCTS_PATH+'/'+id+'/updatedAt']=Date.now();patch[PRODUCTS_PATH+'/'+id+'/updatedById']=String(user().id);
        db.ref().update(patch).then(function(){p.photoUrl=response.secure_url;p.photoPublicId=response.public_id||'';p.updatedAt=Date.now();addAuditSafe('stock_product_photo','Продавец обновил фото товара: '+(p.name||id));setStatus('Фотография обновлена.');render();}).catch(function(e){setStatus('');alert('Фото загружено, но не удалось сохранить карточку: '+(e&&e.message||e));});
      };
      xhr.onerror=function(){setStatus('');alert('Не удалось связаться с Cloudinary. Проверьте интернет.');};
      xhr.ontimeout=function(){setStatus('');alert('Загрузка фото не завершилась за 45 секунд.');};
      xhr.send(data);
    },{once:true});
    input.click();
  }
  function setSearch(v){
    var input=document.getElementById('stockSearch'),start=null,end=null;
    if(input){try{start=input.selectionStart;end=input.selectionEnd;}catch(e){}}
    searchText=v||'';render();
    var next=document.getElementById('stockSearch');
    if(next){next.focus();try{if(start!==null)next.setSelectionRange(start,end);}catch(e){}}
  }
  function setFilter(v){activeFilter=v||'all';render();}
  function getSaleOptions(sid){
    sid=String(sid||'');if(!canUse()||!sid||visibleStoreIds().map(String).indexOf(sid)===-1||(isSeller()&&sid!==storeId()))return [];
    var direction=storeDirection(sid);
    return allProducts().filter(function(p){if(p.status!=='active'||p.org!==org())return false;if(isSeller()&&!sellerCanSee(p))return false;if(isAdmin()&&direction&&direction!=='mixed'&&p.direction!==direction)return false;var b=balances[sid]&&balances[sid][String(p.id)]||{},sizes=Array.isArray(b.sizes)?b.sizes.map(function(x){return String(x).toUpperCase();}):[];return sizes.length>0;}).map(function(p){var b=balances[sid][String(p.id)]||{},sizes=Array.isArray(b.sizes)?b.sizes.map(function(x){return String(x).toUpperCase();}):[],counts={};sizes.forEach(function(x){counts[x]=(counts[x]||0)+1;});return {id:String(p.id),name:String(p.name||''),category:String(p.category||''),article:String(p.article||''),brand:String(p.brand||''),model:String(p.model||''),color:String(p.color||''),photoUrl:String(p.photoUrl||''),purchaseCost:p.purchaseCost==null?null:Number(p.purchaseCost),sizes:counts,quantity:sizes.length};}).sort(function(a,b){return a.name.localeCompare(b.name,'ru');});
  }
  function completeSaleFromStock(sale){
    if(!sale||!sale.id||!sale.stockProductId||!sale.stockSize)return Promise.reject(new Error('Не заполнены данные складской продажи.'));
    if(!navigator.onLine||!canUse())return Promise.reject(new Error('Для продажи со склада требуется подключение к Firebase.'));
    var sid=String(sale.stockStoreId||sale.storeId),pid=String(sale.stockProductId),size=String(sale.stockSize).toUpperCase(),saleId=String(sale.id),quantity=Number(sale.stockQuantity||1);
    if(sid!==String(sale.storeId)||visibleStoreIds().map(String).indexOf(sid)===-1||(isSeller()&&sid!==storeId()))return Promise.reject(new Error('Нет доступа к остаткам выбранного магазина.'));
    if(!Number.isInteger(quantity)||quantity<1)return Promise.reject(new Error('Количество должно быть целым числом больше нуля.'));
    var lockRef=db.ref('stock_sale_locks/'+saleId),lock={saleId:saleId,actorId:String(user().id),startedAt:Date.now(),expiresAt:Date.now()+120000};
    return db.ref('sales_data/'+saleId).once('value').then(function(existing){
      if(existing.exists()){var old=existing.val()||{};if(String(old.stockProductId||'')===pid&&String(old.stockSize||'').toUpperCase()===size)return {alreadySaved:true,sale:old};throw new Error('Продажа с таким идентификатором уже существует.');}
      return lockRef.transaction(function(current){if(current&&Number(current.expiresAt||0)>Date.now())return;return lock;},undefined,false).then(function(lockResult){
        if(!lockResult.committed)throw new Error('Продажа уже обрабатывается на другом устройстве.');
        return Promise.all([db.ref(PRODUCTS_PATH+'/'+pid).once('value'),db.ref(BALANCES_PATH+'/'+sid+'/'+pid).once('value'),db.ref(DIRECTIONS_PATH+'/'+sid).once('value')]);
      }).then(function(snaps){
        var product=snaps[0].val(),balance=snaps[1].val()||{},direction=snaps[2].val()||'';
        if(!product||product.status!=='active'||product.org!==org())throw new Error('Карточка товара больше недоступна для продажи.');
        if(direction&&direction!=='mixed'&&product.direction!==direction)throw new Error('Товар не относится к направлению выбранного магазина.');
        var balanceRef=db.ref(BALANCES_PATH+'/'+sid+'/'+pid),before=Number(balance.quantity||0),nextBalance,manualSize=false;
        return balanceRef.transaction(function(current){
          current=current||{};var sizes=Array.isArray(current.sizes)?current.sizes.map(function(x){return String(x).toUpperCase();}):[],removed=0,filtered=sizes.filter(function(x){if(x===size&&removed<quantity){removed++;return false;}return true;});
          if(removed!==quantity){manualSize=true;nextBalance=current;return current;}
          nextBalance=Object.assign({},current,{sizes:filtered,quantity:filtered.length,updatedAt:Date.now()});return nextBalance;
        },undefined,false).then(function(tx){
          if(!tx.committed)throw new Error('Не удалось проверить остатки товара. Повторите попытку.');
          nextBalance=tx.snapshot.val()||nextBalance;
          var now=Date.now(),movementId='stock_sale_'+saleId,unitPurchaseCost=product.purchaseCost==null||product.purchaseCost===''?null:Number(product.purchaseCost),persisted=Object.assign({},sale,{stockProductName:String(product.name||sale.stockProductName||''),stockPurchaseCost:isFinite(unitPurchaseCost)&&unitPurchaseCost>=0?unitPurchaseCost:null,stockOrg:String(product.org||''),stockQuantity:quantity,stockStoreId:sid,stockMovementId:manualSize?'':movementId,stockSize:size,stockManualSize:manualSize,_pendingSync:false});
          var movement={id:movementId,org:product.org,productId:pid,productName:persisted.stockProductName,storeId:sid,type:'sale',size:size,quantityDelta:-quantity,before:before,after:Number(nextBalance.quantity||0),saleId:saleId,createdAt:now,createdById:String(user().id),createdByName:String(user().name||'')};
          var patch={};patch['sales_data/'+saleId]=persisted;if(!manualSize)patch[MOVEMENTS_PATH+'/'+movementId]=movement;
          return db.ref().update(patch).then(function(){return {sale:persisted,movement:movement};}).catch(function(writeError){
            return db.ref('sales_data/'+saleId).once('value').then(function(check){if(check.exists())return {sale:check.val(),movement:movement,alreadySaved:true};return balanceRef.transaction(function(current){current=current||{};var restored=Array.isArray(current.sizes)?current.sizes.slice():[];for(var n=0;n<quantity;n++)restored.push(size);return Object.assign({},current,{sizes:restored,quantity:restored.length,updatedAt:Date.now()});},undefined,false).then(function(){throw writeError;});});
          });
        });
      }).finally(function(){lockRef.transaction(function(current){if(current&&String(current.saleId)===saleId)return null;return current;},undefined,false);});
    });
  }
  function resolveCurrentProductId(productId){
    var id=String(productId||''),seen={};
    while(products[id]&&products[id].mergedInto&&!seen[id]){
      seen[id]=true;
      id=String(products[id].mergedInto);
    }
    return id;
  }
  function prepareSaleReturn(sale,nextReturned,eventId){
    if(!sale||!sale.stockProductId)return Promise.resolve(null);
    if(!navigator.onLine||!canUse())return Promise.reject(new Error('Для возврата складской продажи требуется подключение к Firebase.'));
    var sid=String(sale.stockStoreId||sale.storeId),originalPid=String(sale.stockProductId),pid=resolveCurrentProductId(originalPid),size=String(sale.stockSize||'').toUpperCase(),quantity=Number(sale.stockQuantity||1);
    if(!sid||!pid||!size||!Number.isInteger(quantity)||quantity<1)return Promise.reject(new Error('В складской продаже отсутствуют корректные данные товара и размера.'));
    var ref=db.ref(BALANCES_PATH+'/'+sid+'/'+pid),before=0,after=0,delta=nextReturned?quantity:-quantity;
    return ref.transaction(function(current){
      current=current||{};var sizes=Array.isArray(current.sizes)?current.sizes.map(function(x){return String(x).toUpperCase();}):[];before=sizes.length;
      if(nextReturned){for(var i=0;i<quantity;i++)sizes.push(size);}else{var removed=0;sizes=sizes.filter(function(x){if(x===size&&removed<quantity){removed++;return false;}return true;});if(removed!==quantity)return;}
      after=sizes.length;return Object.assign({},current,{sizes:sizes,quantity:after,updatedAt:Date.now()});
    },undefined,false).then(function(tx){
      if(!tx.committed)throw new Error(nextReturned?'Не удалось восстановить товар на складе.':'Нельзя отменить возврат: нужного размера больше нет в остатках.');
      var movementId='stock_'+(nextReturned?'return_':'return_cancel_')+String(eventId),movement={id:movementId,org:org(),productId:pid,productName:String(sale.stockProductName||sale.name||''),storeId:sid,type:nextReturned?'return':'sale_return_cancel',size:size,quantityDelta:delta,before:before,after:after,saleId:String(sale.id||''),returnEventId:String(eventId),createdAt:Date.now(),createdById:String(user().id),createdByName:String(user().name||'')};
      function rollback(){return ref.transaction(function(current){current=current||{};var sizes=Array.isArray(current.sizes)?current.sizes.slice():[];if(nextReturned){var removed=0;sizes=sizes.filter(function(x){if(String(x).toUpperCase()===size&&removed<quantity){removed++;return false;}return true;});if(removed!==quantity)return;}else{for(var n=0;n<quantity;n++)sizes.push(size);}return Object.assign({},current,{sizes:sizes,quantity:sizes.length,updatedAt:Date.now()});},undefined,false).then(function(result){if(!result.committed)throw new Error('Не удалось автоматически откатить изменение складского остатка.');});}
      return {movement:movement,rollback:rollback};
    });
  }

  function prepareSaleDelete(sale){
    if(!sale||!sale.stockProductId||sale.returned)return Promise.resolve(null);
    if(!navigator.onLine||!canUse())return Promise.reject(new Error('Для удаления складской продажи требуется подключение к Firebase.'));
    var sid=String(sale.stockStoreId||sale.storeId),originalPid=String(sale.stockProductId),pid=String((products[originalPid]&&products[originalPid].mergedInto)||originalPid),size=String(sale.stockSize||'').toUpperCase(),quantity=Number(sale.stockQuantity||1);
    if(!sid||!pid||!size||!Number.isInteger(quantity)||quantity<1)return Promise.reject(new Error('В продаже отсутствуют корректные данные склада.'));
    var ref=db.ref(BALANCES_PATH+'/'+sid+'/'+pid),before=0,after=0;
    return ref.transaction(function(current){current=current||{};var sizes=Array.isArray(current.sizes)?current.sizes.slice():[];before=sizes.length;for(var i=0;i<quantity;i++)sizes.push(size);after=sizes.length;return Object.assign({},current,{sizes:sizes,quantity:after,updatedAt:Date.now()});},undefined,false).then(function(tx){
      if(!tx.committed)throw new Error('Не удалось восстановить товар на складе.');
      var movementId='stock_delete_restore_'+String(sale.id),movement={id:movementId,org:String(sale.stockOrg||org()),productId:pid,productName:String(sale.stockProductName||sale.name||''),storeId:sid,type:'delete_sale_restore',size:size,quantityDelta:quantity,before:before,after:after,saleId:String(sale.id),createdAt:Date.now(),createdById:String(user().id),createdByName:String(user().name||'')};
      function rollback(){return ref.transaction(function(current){current=current||{};var sizes=Array.isArray(current.sizes)?current.sizes.slice():[],removed=0;sizes=sizes.filter(function(x){if(String(x).toUpperCase()===size&&removed<quantity){removed++;return false;}return true;});if(removed!==quantity)return;return Object.assign({},current,{sizes:sizes,quantity:sizes.length,updatedAt:Date.now()});},undefined,false).then(function(result){if(!result.committed)throw new Error('Не удалось отменить восстановление остатков после ошибки удаления.');});}
      return {movement:movement,rollback:rollback};
    });
  }
  function stockDateMs(value){
    if(value===undefined||value===null||value==='')return 0;
    if(typeof value==='number'&&isFinite(value))return value<1000000000000?value*1000:value;
    var raw=String(value);
    if(/^\\d{10,13}$/.test(raw)){var n=Number(raw);return raw.length<=10?n*1000:n;}
    var parsed=Date.parse(raw);return isFinite(parsed)?parsed:0;
  }
  function stockLocalDateMs(dateText,endOfDay){
    var parts=String(dateText||'').split('-').map(Number);
    if(parts.length!==3||!parts[0]||!parts[1]||!parts[2])return 0;
    return new Date(parts[0],parts[1]-1,parts[2],endOfDay?23:0,endOfDay?59:0,endOfDay?59:0,endOfDay?999:0).getTime();
  }
  function stockResolvedId(id){
    var current=String(id||''),seen={};
    while(products[current]&&products[current].mergedInto&&!seen[current]){seen[current]=true;current=String(products[current].mergedInto);}
    return current;
  }
  function getReplenishmentRecommendations(startDate,endDate,selectedStore,targetDays){
    if(!isAdmin()||!Object.keys(loaded).every(function(k){return loaded[k];}))return {ready:false,rows:[],message:'Складские данные ещё загружаются.'};
    var now=Date.now(),endMs=endDate?stockLocalDateMs(endDate,true):now;
    if(!endMs||endMs>now)endMs=now;
    var startMs=startDate?stockLocalDateMs(startDate,false):endMs-29*86400000;
    if(!startMs||startMs>endMs)return {ready:true,rows:[],message:'Проверьте выбранный период.'};
    var periodDays=Math.max(1,(endMs-startMs+1)/86400000),target=Math.max(1,Math.min(60,Number(targetDays)||14));
    var stores=visibleStoreIds().filter(function(id){return selectedStore==='all'||String(id)===String(selectedStore);});
    var active=allProducts().filter(function(p){return p.status==='active';}),rows=[],movementByKey={},saleMovementIds={};
    Object.keys(movements).forEach(function(key){
      var m=movements[key];if(!m||String(m.org||'')!==String(org())||!m.storeId)return;
      var sid=String(m.storeId);if(stores.indexOf(sid)===-1)return;
      var pid=stockResolvedId(m.productId);if(!pid)return;
      var key2=pid+'|'+sid,at=stockDateMs(m.createdAt||m.timestamp);if(!at)return;
      if(!movementByKey[key2])movementByKey[key2]=[];
      movementByKey[key2].push({at:at,delta:Number(m.quantityDelta)||0,before:m.before==null?null:Number(m.before),after:m.after==null?null:Number(m.after),saleId:m.saleId?String(m.saleId):'',source:'movement'});
      if(m.saleId)saleMovementIds[String(m.saleId)]=true;
    });
    (window.sales||[]).forEach(function(sale){
      if(!sale||!sale.stockProductId||!sale.stockStoreId||!sale.id)return;
      if(sale.stockOrg&&String(sale.stockOrg)!==String(org()))return;
      var sid=String(sale.stockStoreId);if(stores.indexOf(sid)===-1)return;
      if(typeof isSaleRecordDeleted==='function'&&isSaleRecordDeleted(sale.id))return;
      if(typeof isRecordBeforeStoreReset==='function'&&isRecordBeforeStoreReset(sale))return;
      if(saleMovementIds[String(sale.id)])return;
      var at=stockDateMs(sale.timestamp||sale.createdAt);if(!at)return;
      var pid=stockResolvedId(sale.stockProductId),key2=pid+'|'+sid;
      if(!movementByKey[key2])movementByKey[key2]=[];
      movementByKey[key2].push({at:at,delta:-(Number(sale.stockQuantity)||1),before:null,after:null,saleId:String(sale.id),source:'sale'});
    });
    var soldByKey={};
    (window.sales||[]).forEach(function(sale){
      if(!sale||!sale.stockProductId||!sale.stockStoreId||sale.returned)return;
      if(sale.stockOrg&&String(sale.stockOrg)!==String(org()))return;
      var sid=String(sale.stockStoreId);if(stores.indexOf(sid)===-1)return;
      if(typeof isSaleRecordDeleted==='function'&&isSaleRecordDeleted(sale.id))return;
      if(typeof isRecordBeforeStoreReset==='function'&&isRecordBeforeStoreReset(sale))return;
      var at=stockDateMs(sale.timestamp||sale.createdAt);if(!at||at<startMs||at>endMs)return;
      var pid=stockResolvedId(sale.stockProductId),key2=pid+'|'+sid;
      if(!soldByKey[key2])soldByKey[key2]=0;
      var units=Number(sale.stockQuantity)||1;if(isFinite(units)&&units>0)soldByKey[key2]+=units;
    });
    active.forEach(function(product){
      var pid=String(product.id);
      stores.forEach(function(sid){
        var current=qty(pid,sid),key2=pid+'|'+sid,events=(movementByKey[key2]||[]).slice().sort(function(a,b){return a.at-b.at;});
        var periodEvents=events.filter(function(e){return e.at>=startMs&&e.at<=endMs;});
        var deltaAfterStart=events.filter(function(e){return e.at>=startMs&&e.at<=now;}).reduce(function(sum,e){return sum+e.delta;},0);
        var opening=current-deltaAfterStart,availableDays=0,known=true;
        var firstAfterStart=events.filter(function(e){return e.at>=startMs&&e.at<=now;})[0];
        if(firstAfterStart&&firstAfterStart.before!==null&&isFinite(firstAfterStart.before))opening=firstAfterStart.before;
        else if(!firstAfterStart){
          var balance=balances[sid]&&balances[sid][pid]||{},updated=stockDateMs(balance.updatedAt);
          if(!updated||updated>startMs)known=false;
          else opening=current;
        }else known=false;
        if(opening<0){known=false;opening=0;}
        var cursor=startMs,level=opening;
        periodEvents.forEach(function(event){
          var at=Math.max(startMs,Math.min(endMs,event.at));
          if(level>0&&at>cursor)availableDays+=(at-cursor)/86400000;
          if(event.before!==null&&isFinite(event.before)&&Math.abs(level-event.before)>0.001)known=false;
          level+=event.delta;
          if(event.after!==null&&isFinite(event.after)&&Math.abs(level-event.after)>0.001){known=false;level=event.after;}
          if(level<0){known=false;level=0;}
          cursor=at;
        });
        if(level>0&&endMs>cursor)availableDays+=(endMs-cursor)/86400000;
        availableDays=Math.min(periodDays,Math.max(0,availableDays));
        var units=soldByKey[key2]||0,rate=availableDays>0?units/availableDays:0,coverage=rate>0?current/rate:null;
        var recommended=rate>0?Math.max(0,Math.ceil(rate*target-current)):0;
        var reliable=known&&availableDays>=Math.min(3,periodDays);
        var reason= !known?'История остатков неполная — оценка спроса ненадёжна':availableDays<Math.min(3,periodDays)?'Недостаточно дней наличия для оценки спроса':units<=0?'Продаж за период нет':recommended>0?'Текущего остатка недостаточно для запаса на '+target+' дней':'Запаса достаточно';
        rows.push({productId:pid,productName:String(product.name||'Без названия'),storeId:sid,storeName:stockLocationName(sid),currentStock:current,soldUnits:units,availableDays:availableDays,periodDays:periodDays,dailyDemand:rate,coverageDays:coverage,recommendedQty:reliable?recommended:0,known:reliable,reason:reason,purchaseCost:product.purchaseCost==null||product.purchaseCost===''?null:Number(product.purchaseCost)});
      });
    });
    rows.sort(function(a,b){return (b.recommendedQty-a.recommendedQty)||(a.coverageDays==null?1:b.coverageDays==null?-1:a.coverageDays-b.coverageDays)||a.productName.localeCompare(b.productName,'ru');});
    return {ready:true,rows:rows,periodDays:periodDays,targetDays:target,startDate:startDate||'',endDate:endDate||'',currentAsOf:new Date(now).toISOString()};
  }
  function getFinancialSummary(averageMarkup){
    if(!isAdmin())return null;
    var active=allProducts().filter(function(p){return p.status==='active';}),salesByProduct={};
    (window.sales||[]).forEach(function(sale){
      if(!sale||!sale.stockProductId||!sale.stockStoreId||sale.returned)return;
      if(sale.stockOrg&&String(sale.stockOrg)!==String(org()))return;
      if(stockLocationIds().indexOf(String(sale.stockStoreId))===-1)return;
      if(typeof isSaleRecordDeleted==='function'&&isSaleRecordDeleted(sale.id))return;
      if(typeof isRecordBeforeStoreReset==='function'&&isRecordBeforeStoreReset(sale))return;
      var pid=String(sale.stockProductId),seen={},resolved=pid;
      while(products[resolved]&&products[resolved].mergedInto&&!seen[resolved]){seen[resolved]=true;resolved=String(products[resolved].mergedInto);}
      var units=Number(sale.stockQuantity)||1,amount=Number(sale.price)||0;
      if(!Number.isFinite(units)||units<=0||!Number.isFinite(amount)||amount<0)return;
      if(!salesByProduct[resolved])salesByProduct[resolved]={units:0,revenue:0};
      salesByProduct[resolved].units+=units;salesByProduct[resolved].revenue+=amount;
    });
    var markup=averageMarkup!==null&&averageMarkup!==undefined&&Number.isFinite(Number(averageMarkup))?Number(averageMarkup):null;
    var result={units:0,purchase:0,purchaseKnownUnits:0,purchaseUnknownUnits:0,realization:0,realizationKnownUnits:0,realizationMarkupUnits:0,realizationUnknownUnits:0,markup:markup};
    active.forEach(function(p){
      var pid=String(p.id),units=stockLocationIds().reduce(function(sum,loc){return sum+qty(pid,loc);},0);
      if(units<=0)return;
      result.units+=units;
      var hasCost=p.purchaseCost!==null&&p.purchaseCost!==undefined&&p.purchaseCost!==''&&Number.isFinite(Number(p.purchaseCost))&&Number(p.purchaseCost)>=0;
      if(hasCost){result.purchase+=units*Number(p.purchaseCost);result.purchaseKnownUnits+=units;}else result.purchaseUnknownUnits+=units;
      var history=salesByProduct[pid];
      if(history&&history.units>0){result.realization+=units*(history.revenue/history.units);result.realizationKnownUnits+=units;}
      else if(hasCost&&markup!==null&&markup>-100){result.realization+=units*Number(p.purchaseCost)*(1+markup/100);result.realizationMarkupUnits+=units;}
      else result.realizationUnknownUnits+=units;
    });
    return result;
  }
  function expose(){
    window.stockOpenForm=openForm;window.stockCloseForm=closeForm;window.stockSave=save;window.stockReview=review;
    window.stockAdjust=adjust;window.stockAddSizes=addSizes;window.stockDelete=deleteProduct;window.stockMove=moveProduct;window.stockSetSearch=setSearch;window.stockSetFilter=setFilter;window.stockGetSaleOptions=getSaleOptions;window.stockGetStoreDirection=getStoreDirectionSetting;window.stockSaveStoreDirection=saveStoreDirectionSetting;window.stockCompleteSale=completeSaleFromStock;window.stockPrepareSaleReturn=prepareSaleReturn;window.stockPrepareSaleDelete=prepareSaleDelete;window.stockRefresh=render;window.stockGetFinancialSummary=getFinancialSummary;window.stockGetReplenishmentRecommendations=getReplenishmentRecommendations;
  }
  function start(){
    expose();load();initPage();
    if(typeof window.switchOrg==='function' && !window.switchOrg._stockWrapped){
      var originalSwitchOrg=window.switchOrg;
      var wrappedSwitchOrg=function(key){var result=originalSwitchOrg.apply(this,arguments);render();return result;};
      wrappedSwitchOrg._stockWrapped=true;window.switchOrg=wrappedSwitchOrg;
    }
    var originalShow=window.easyAppSyncShowPage;
    if(typeof originalShow==='function'&&!originalShow._stockWrapped){
      var wrapped=function(id){if(id==='stock'){show();return;}var result=originalShow.apply(this,arguments);if(id==='stores'&&typeof window.renderStoresManagement==='function')window.renderStoresManagement();return result;};
      wrapped._stockWrapped=true;window.easyAppSyncShowPage=wrapped;
    }
    // Avoid observing stockRoot mutations: render() updates innerHTML and would retrigger itself.
    if(user())render();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
