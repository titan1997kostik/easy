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
  var selectedStoreOrg = '';
  function selectedStoreStorageKey(){ return 'easy_stock_selected_store_'+encodeURIComponent(org()); }
  function restoreSelectedStore(){
    if(!isAdmin())return;
    var currentOrg=org();
    if(selectedStoreOrg===currentOrg)return;
    selectedStoreOrg=currentOrg;
    try{selectedStoreId=String(localStorage.getItem(selectedStoreStorageKey())||'');}catch(e){selectedStoreId='';}
  }
  function persistSelectedStore(){
    if(!isAdmin())return;
    try{localStorage.setItem(selectedStoreStorageKey(),String(selectedStoreId||''));}catch(e){}
  }
  var advisorCategoryFilter = 'all';
  var searchText = '';
  var editingId = '';
  var selectedPhoto = null;
  var mergeSelectingId = '';
  var mergeSelectingStoreId = '';
  var formSizes = [];
  var refs = {};
  var replenishmentCache = Object.create(null);
  var replenishmentCacheRevision = 0;
  function invalidateReplenishmentCache(){ replenishmentCache = Object.create(null); replenishmentCacheRevision++; if(adminTab==='advisor')render(); }

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
  function statusText(){ return loaded.products&&loaded.balances&&loaded.directions ? '' : 'Загружаем складские данные из Firebase…'; }
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
    [['products',PRODUCTS_PATH],['balances',BALANCES_PATH],['directions',DIRECTIONS_PATH]].forEach(function(pair){
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
        invalidateReplenishmentCache();
        render();
        var analyticsPage=document.getElementById('workspacePage-analytics'),rankingPane=document.getElementById('analyticsProductRankingPane');
        if(typeof window.renderPurchaseCardRanking==='function'&&analyticsPage&&analyticsPage.classList.contains('active')&&rankingPane&&rankingPane.style.display!=='none')window.renderPurchaseCardRanking();
        if(typeof window.drawChart==='function'&&document.getElementById('workspacePage-analytics')&&document.getElementById('workspacePage-analytics').classList.contains('active'))window.drawChart();
        if(typeof window.renderPurchaseRecommendations==='function'&&document.getElementById('workspacePage-purchase')&&document.getElementById('workspacePage-purchase').classList.contains('active'))window.renderPurchaseRecommendations();
        if(name==='directions'&&typeof window.renderStoresManagement==='function')window.renderStoresManagement();
        if(window.refreshStockSaleProducts && document.getElementById('stockSaleEnabled') && document.getElementById('stockSaleEnabled').checked) window.refreshStockSaleProducts();
      },function(err){ console.error('Stock sync '+name,err); loaded[name]=true; render(); });
    });
  }
  function loadMovements(){ if(refs.movements||!window.db||!db.ref)return; refs.movements=db.ref(MOVEMENTS_PATH); refs.movements.on('value',function(snap){movements=snap.val()||{};loaded.movements=true;render();},function(err){console.error('Stock history sync',err);loaded.movements=true;render();}); }
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


  function stockAdvisorCategoryKey(value){
    var category=String(value||'').trim();
    return category || '__uncategorized__';
  }
  function stockAdvisorCategoryLabel(value){
    return String(value||'').trim() || 'Без категории';
  }
  function stockAdvisorIsFootwear(product){
    var category=norm(product&&product.category||'');
    return /обув|крос|ботин|сандал|туфл|shoe|sneaker/.test(category);
  }
  function getStockConsolidationRecommendations(){
    if(!isAdmin()||!loaded.products||!loaded.balances)return {ready:false,moves:[],message:'Складские данные ещё загружаются.'};
    var stores=visibleStoreIds().map(String),warehouse=warehouseId(),allLocations=stores.concat([warehouse]),storeSet=Object.create(null),salesByProductStore=Object.create(null),productsList=allProducts().filter(function(p){return p.status==='active'&&!p.mergedInto;}),moves=[];
    stores.forEach(function(storeId){storeSet[storeId]=true;});
    (window.sales||[]).forEach(function(sale){
      if(!sale||!sale.stockProductId||!sale.id||sale.returned)return;
      if(sale.stockOrg&&String(sale.stockOrg)!==String(org()))return;
      var sid=String(sale.stockStoreId||sale.storeId||'');
      if(!storeSet[sid])return;
      if(typeof isSaleRecordDeleted==='function'&&isSaleRecordDeleted(sale.id))return;
      if(typeof isStoreDeleted==='function'&&isStoreDeleted(sid))return;
      var resetCheckRecord=sale.storeId?sale:Object.assign({},sale,{storeId:sid});
      if(typeof isRecordBeforeStoreReset==='function'&&isRecordBeforeStoreReset(resetCheckRecord))return;
      var pid=stockResolvedId(sale.stockProductId),units=Number(sale.stockQuantity);
      if(!isFinite(units)||units<=0)units=1;
      if(!salesByProductStore[pid])salesByProductStore[pid]=Object.create(null);
      salesByProductStore[pid][sid]=(salesByProductStore[pid][sid]||0)+units;
    });
    productsList.forEach(function(product){
      var pid=String(product.id),locations=[];
      allLocations.forEach(function(sid){
        var balance=balances[sid]&&balances[sid][pid]||{},sizes=Array.isArray(balance.sizes)?balance.sizes.map(String):[];
        if(!sizes.length||qty(pid,sid)<=0)return;
        var unique={};sizes.forEach(function(size){unique[size]=(unique[size]||0)+1;});
        locations.push({storeId:sid,sizes:sizes,quantity:sizes.length,sizeCount:Object.keys(unique).length,sizeSummary:sizeLabel(sizes)});
      });
      if(!locations.length)return;
      var shopLocations=locations.filter(function(location){return location.storeId!==warehouse;});
      if(!shopLocations.length)return;
      var recommendations=[];
      if(stockAdvisorIsFootwear(product)){
        var footwearTarget=shopLocations.slice().sort(function(a,b){return b.quantity-a.quantity||stockLocationName(a.storeId).localeCompare(stockLocationName(b.storeId),'ru');})[0];
        locations.filter(function(source){return source.sizeCount<=2&&source.storeId!==footwearTarget.storeId;}).forEach(function(source){
          recommendations.push({
            source:source,
            target:footwearTarget,
            actionLabel:'Переместить все размеры',
            reason:'Переносится весь остаток карточки из локации-донора. Склад хранения может быть донором, но получателем выбирается только магазин с наибольшим текущим остатком этой карточки.'
          });
        });
      }else{
        var productSales=salesByProductStore[pid]||Object.create(null);
        var allShopLocations=stores.map(function(sid){
          var balance=balances[sid]&&balances[sid][pid]||{},sizes=Array.isArray(balance.sizes)?balance.sizes.map(String):[];
          var unique={};sizes.forEach(function(size){unique[size]=(unique[size]||0)+1;});
          return {storeId:sid,sizes:sizes,quantity:qty(pid,sid),sizeCount:Object.keys(unique).length,sizeSummary:sizeLabel(sizes)};
        });
        allShopLocations.filter(function(source){return source.quantity===1&&source.sizes.length===1;}).forEach(function(source){
          var sourceSales=Number(productSales[source.storeId]||0);
          var betterTargets=allShopLocations.filter(function(candidate){
            return candidate.storeId!==source.storeId&&Number(productSales[candidate.storeId]||0)>sourceSales;
          }).sort(function(a,b){
            return Number(productSales[b.storeId]||0)-Number(productSales[a.storeId]||0)
              ||a.quantity-b.quantity
              ||stockLocationName(a.storeId).localeCompare(stockLocationName(b.storeId),'ru');
          });
          if(!betterTargets.length)return;
          var target=betterTargets[0],targetSales=Number(productSales[target.storeId]||0);
          recommendations.push({
            source:source,
            target:target,
            actionLabel:'Переместить 1 шт.',
            reason:'В магазине «'+stockLocationName(target.storeId)+'» продано '+targetSales+' шт. этой карточки, а в исходном магазине — '+sourceSales+' шт. По доступной истории продаж спрос выше.'
          });
        });
      }
      recommendations.forEach(function(recommendation){
        var source=recommendation.source,target=recommendation.target,after=target.sizes.concat(source.sizes);
        var inventory=allLocations.filter(function(location){return location!==source.storeId&&location!==target.storeId;}).map(function(location){
          var balance=balances[location]&&balances[location][pid]||{};
          var sizes=Array.isArray(balance.sizes)?balance.sizes.map(String):[];
          return {locationId:location,locationName:stockLocationName(location),quantity:qty(pid,location),sizes:sizes,sizeSummary:sizeLabel(sizes)};
        });
        moves.push({
          productId:pid,productName:String(product.name||'Без названия'),
          category:String(product.category||'').trim(),categoryKey:stockAdvisorCategoryKey(product.category),
          photoUrl:String(product.photoUrl||''),sourceId:source.storeId,sourceName:stockLocationName(source.storeId),
          sourceSizes:source.sizes.slice(),quantity:source.quantity,sizeCount:source.sizeCount,sizeSummary:source.sizeSummary,
          targetId:target.storeId,targetName:stockLocationName(target.storeId),targetSizes:target.sizes.slice(),
          targetSummary:sizeLabel(target.sizes),targetStock:target.quantity,afterSizes:after,afterSummary:sizeLabel(after),
          inventory:inventory,actionLabel:recommendation.actionLabel,reason:recommendation.reason
        });
      });
    });
    moves.sort(function(a,b){return a.category.localeCompare(b.category,'ru')||b.quantity-a.quantity||a.productName.localeCompare(b.productName,'ru');});
    return {ready:true,moves:moves};
  }
  function renderStockAdvisorHtml(){
    var result=getStockConsolidationRecommendations();
    if(!result.ready)return '<div class="card">'+esc(result.message||'Загрузка рекомендаций…')+'</div>';
    var categoryMap=Object.create(null);
    allProducts().filter(function(p){return p.status==='active'&&!p.mergedInto;}).forEach(function(p){
      var key=stockAdvisorCategoryKey(p.category);categoryMap[key]=stockAdvisorCategoryLabel(p.category);
    });
    if(advisorCategoryFilter!=='all'&&!Object.prototype.hasOwnProperty.call(categoryMap,advisorCategoryFilter))advisorCategoryFilter='all';
    var categoryKeys=Object.keys(categoryMap).sort(function(a,b){return categoryMap[a].localeCompare(categoryMap[b],'ru');});
    var visibleMoves=result.moves.filter(function(item){return advisorCategoryFilter==='all'||item.categoryKey===advisorCategoryFilter;});
    var html='<div class="card" style="margin-bottom:14px;"><h3>Помощник склада</h3><p style="font-size:13px;color:var(--text-light);">Для обуви сохранён прежний алгоритм: локация с не более чем двумя разными размерами может стать донором, а получателем выбирается магазин с наибольшим остатком. Для остальных товаров при остатке 1 шт. в магазине предлагается перемещение туда, где по доступной истории продаж эту карточку покупают чаще.</p>'
      +'<div style="margin-top:12px;"><label for="stockAdvisorCategory" style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Категория товара</label><select id="stockAdvisorCategory" style="width:100%;max-width:360px;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--card,#fff);color:var(--text);"><option value="all" '+(advisorCategoryFilter==='all'?'selected':'')+'>Все категории</option>'
      +categoryKeys.map(function(key){return '<option value="'+esc(key)+'" '+(advisorCategoryFilter===key?'selected':'')+'>'+esc(categoryMap[key])+'</option>';}).join('')
      +'</select><div style="font-size:12px;color:var(--text-light);margin-top:5px;">Рекомендации сгруппированы по категориям. Можно выбрать одну категорию для отдельного анализа.</div></div></div>';
    html+='<div class="card" style="margin-bottom:14px;"><b style="font-size:22px;">'+visibleMoves.length+'</b><div style="font-size:12px;color:var(--text-light);">предложений перемещения'+(advisorCategoryFilter==='all'?'':' в категории «'+esc(categoryMap[advisorCategoryFilter]||'')+'»')+'</div>'
      +(advisorCategoryFilter==='all'?'':'<div style="font-size:12px;color:var(--text-light);margin-top:4px;">Всего по всем категориям: '+result.moves.length+'</div>')+'</div>';
    if(visibleMoves.length){
      var grouped=Object.create(null);
      visibleMoves.forEach(function(item){if(!grouped[item.categoryKey])grouped[item.categoryKey]=[];grouped[item.categoryKey].push(item);});
      Object.keys(grouped).sort(function(a,b){return (categoryMap[a]||'Без категории').localeCompare(categoryMap[b]||'Без категории','ru');}).forEach(function(categoryKey){
        var groupItems=grouped[categoryKey],categoryName=categoryMap[categoryKey]||'Без категории';
        html+='<h3 style="margin:18px 0 10px;">'+esc(categoryName)+' <span style="font-size:12px;font-weight:400;color:var(--text-light);">· '+groupItems.length+'</span></h3>';
        groupItems.forEach(function(item){
          var inventoryHtml='<div style="margin-top:12px;padding:11px;border:1px solid var(--border);border-radius:9px;"><b style="font-size:13px;">Остатки и размеры в других магазинах и на складе</b><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:7px;margin-top:9px;">';
          item.inventory.filter(function(location){return Number(location.quantity)>0;}).forEach(function(location){
            inventoryHtml+='<div style="padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--card,#fff);">'
              +'<div style="font-size:12px;font-weight:700;">'+esc(location.locationName)+'</div>'
              +'<div style="font-size:12px;margin-top:4px;">Остаток: <b>'+location.quantity+' шт.</b></div>'
              +'<div style="font-size:12px;color:var(--text-light);margin-top:3px;">Размеры: '+(location.sizes.length?'<span style="color:var(--text);">'+esc(location.sizeSummary)+'</span>':'нет')+'</div></div>';
          });
          inventoryHtml+='</div></div>';
          html+='<div class="card" style="margin-bottom:12px;">'
            +(item.photoUrl?'<img src="'+esc(cardPhotoUrl(item.photoUrl))+'" alt="" loading="lazy" style="width:56px;height:56px;object-fit:cover;border-radius:9px;float:left;margin:0 10px 8px 0;">':'')
            +'<b>'+esc(item.productName)+'</b><div style="font-size:12px;color:var(--text-light);margin-top:3px;">'+esc(categoryName)+'</div>'
            +'<div style="font-size:13px;margin:6px 0 10px;clear:both;">'+esc(item.sourceName)+' → <b>'+esc(item.targetName)+'</b></div>'
            +'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:9px;">'
            +'<div style="padding:10px;border:1px solid var(--border);border-radius:9px;"><b style="font-size:12px;">Забираем полностью · '+item.quantity+' шт.</b><div style="font-size:13px;margin-top:5px;">'+esc(item.sizeSummary)+'</div></div>'
            +'<div style="padding:10px;border:1px solid var(--border);border-radius:9px;"><b style="font-size:12px;">В магазине назначения сейчас · '+item.targetStock+' шт.</b><div style="font-size:13px;margin-top:5px;">'+esc(item.targetSummary||'Нет размеров')+'</div></div>'
            +'<div style="padding:10px;border:1px solid var(--border);border-radius:9px;"><b style="font-size:12px;">Будет после переноса · '+item.afterSizes.length+' шт.</b><div style="font-size:13px;margin-top:5px;">'+esc(item.afterSummary)+'</div></div></div>'
            +inventoryHtml
            +'<div style="font-size:12px;color:var(--text-light);margin-top:9px;">'+esc(item.reason)+'</div>'
            +'<button class="btn btn-primary" style="margin-top:10px;" type="button" data-stock-advisor-move="1" data-product-id="'+esc(item.productId)+'" data-source-id="'+esc(item.sourceId)+'" data-target-id="'+esc(item.targetId)+'">'+esc(item.actionLabel||'Переместить все размеры')+'</button></div>';
        });
      });
    }else{
      html+='<div class="card" style="color:var(--text-light);">'+(advisorCategoryFilter==='all'?'Подходящих перемещений пока нет. Для товаров, кроме обуви, рекомендация появится, когда в магазине останется 1 шт. и найдётся магазин с более высокими продажами этой карточки.':'В выбранной категории пока нет предложений перемещения.')+'</div>';
    }
    return html;
  }
  function render(){
    ensureStockActionStyles();
    if(!initPage()) return;
    var page=document.getElementById('workspacePage-stock');
    if(!page || !page.classList.contains('active')) return;
    var root=document.getElementById('stockRoot'); if(!root) return;
    if(!user()){root.innerHTML='<div class="card">Войдите в приложение, чтобы открыть склад.</div>';return;}
    if(!canUse()){root.innerHTML='<div class="card">Склад станет доступен после проверки подключения к Firebase.</div>';return;}
    var loading=statusText(); if(loading){root.innerHTML='<div class="card">'+esc(loading)+'</div>';return;} if(isAdmin()&&adminTab==='history'&&!loaded.movements){root.innerHTML='<div class="card">Загружаем историю складских операций…</div>';loadMovements();return;}
    if(isSeller() && (!storeId() || !storeDirection(storeId()))){
      root.innerHTML='<div class="card"><b>Склад ещё не настроен.</b><p>Попросите администратора назначить направление вашего магазина в разделе «Управление магазинами».</p></div>';return;
    }
    restoreSelectedStore();
    var stores=visibleStoreIds();
    var locations=stockLocationIds();
    if(isAdmin() && selectedStoreId!=='all' && locations.length && locations.indexOf(String(selectedStoreId))===-1){ selectedStoreId=String(stores[0]||warehouseId()); persistSelectedStore(); }
    var list=allProducts().filter(function(p){return isAdmin() ? (activeFilter==='all' || (activeFilter==='pending' ? p.status==='pending' : activeFilter==='active' ? p.status==='active' : p.direction===activeFilter)) : sellerCanSee(p);});
    if(isAdmin() && adminTab==='shops' && selectedStoreId!=='all') list=list.filter(function(p){return qty(p.id,selectedStoreId)>0;});
    if(searchText) list=list.filter(function(p){return norm([p.name,p.article,p.category,p.color,p.size,p.brand,p.model].join(' ')).indexOf(norm(searchText))!==-1;});
    list.sort(function(a,b){return Number(b.updatedAt||b.createdAt||0)-Number(a.updatedAt||a.createdAt||0);});
    var html='';
    if(isAdmin()){
      if(['shops','history','advisor'].indexOf(adminTab)===-1)adminTab='shops';html+='<div class="card" style="margin-bottom:14px;"><div style="display:flex;gap:7px;flex-wrap:wrap;"><button class="btn '+(adminTab==='shops'?'btn-primary':'btn-secondary')+'" data-stock-tab="shops" type="button">Магазины</button><button class="btn '+(adminTab==='advisor'?'btn-primary':'btn-secondary')+'" data-stock-tab="advisor" type="button">Помощник склада</button><button class="btn '+(adminTab==='history'?'btn-primary':'btn-secondary')+'" data-stock-tab="history" type="button">История</button></div></div>';
      if(adminTab==='shops'){
        var totalUnits=0,totalProducts=allProducts().filter(function(p){return p.status==='active';}).length;
        locations.forEach(function(k){Object.keys(balances[k]||{}).forEach(function(pid){totalUnits+=Number((balances[k][pid]||{}).quantity||0);});});
        html+='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px;"><div class="card"><div style="font-size:12px;color:var(--text-light);">Магазинов</div><b style="font-size:24px;">'+stores.length+'</b></div><div class="card"><div style="font-size:12px;color:var(--text-light);">Активных товаров</div><b style="font-size:24px;">'+totalProducts+'</b></div><div class="card"><div style="font-size:12px;color:var(--text-light);">Всего единиц</div><b style="font-size:24px;">'+totalUnits+'</b></div></div>';
        html+='<div class="card" style="margin-bottom:14px;"><h3>Выберите магазин или склад хранения</h3><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;"><button type="button" data-stock-select-store="all" class="card" style="text-align:left;cursor:pointer;border:2px solid '+(selectedStoreId==='all'?'var(--primary)':'var(--border)')+';background:'+(selectedStoreId==='all'?'#fff0f5':'var(--card)')+';"><b>📋 Все товары</b><div style="font-size:12px;color:var(--text-light);margin-top:6px;">Полный каталог организации</div><div style="font-size:12px;color:var(--primary);margin-top:8px;">'+(selectedStoreId==='all'?'Выбрано':'Показать все карточки →')+'</div></button>';
        locations.forEach(function(k){var units=Object.keys(balances[k]||{}).reduce(function(sum,pid){return sum+Number((balances[k][pid]||{}).quantity||0);},0);var count=Object.keys(balances[k]||{}).filter(function(pid){return Number((balances[k][pid]||{}).quantity||0)>0;}).length;html+='<button type="button" data-stock-select-store="'+esc(k)+'" class="card" style="text-align:left;cursor:pointer;border:2px solid '+(String(k)===String(selectedStoreId)?'var(--primary)':'var(--border)')+';background:'+(String(k)===String(selectedStoreId)?'#fff0f5':'var(--card)')+';"><b>'+(String(k)===warehouseId()?'📦 ':'🏬 ')+esc(stockLocationName(k))+'</b><div style="font-size:12px;color:var(--text-light);margin-top:6px;">'+count+' товаров · '+units+' единиц</div><div style="font-size:12px;color:var(--primary);margin-top:8px;">'+(String(k)===String(selectedStoreId)?'Выбран':'Открыть магазин →')+'</div></button>';});
        if(!stores.length) html+='<div style="color:var(--text-light);">Сначала добавьте магазины в разделе «Магазины».</div>';
        html+='</div></div>';
      }
      if(adminTab==='advisor') html+=renderStockAdvisorHtml();
    }
    if(!isAdmin() || adminTab==='shops'){
    html+='<div class="card" style="margin-bottom:14px;"><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;"><div><h3 style="margin:0 0 4px;">'+(isAdmin()?(selectedStoreId==='all'?'Все товары':'Товары: «'+esc(stockLocationName(selectedStoreId))+'»'):'Товары')+'</h3><div style="font-size:12px;color:var(--text-light);">'+(isAdmin()?'Общий каталог организации':'Каталог вашего магазина')+'</div></div>'+(isAdmin()&&selectedStoreId!=='all'?'<button class="btn btn-secondary" type="button" id="stockOpenCatalog">＋ Из общего каталога</button>':'')+'<button class="btn btn-primary" type="button" onclick="stockOpenForm()">＋ Новая карточка</button>'+'</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;"><input id="stockSearch" type="search" placeholder="Поиск по названию, артикулу, цвету…" value="'+esc(searchText)+'" oninput="stockSetSearch(this.value)" style="flex:1;min-width:180px;">';
    if(isAdmin()) html+='<select id="stockFilter" onchange="stockSetFilter(this.value)" style="min-width:150px;"><option value="all" '+(activeFilter==='all'?'selected':'')+'>Все карточки</option><option value="pending" '+(activeFilter==='pending'?'selected':'')+'>Ожидают проверки</option><option value="active" '+(activeFilter==='active'?'selected':'')+'>Опубликованные</option><option value="krossy" '+(activeFilter==='krossy'?'selected':'')+'>Кроссы</option><option value="easy" '+(activeFilter==='easy'?'selected':'')+'>Изи</option></select>';
    html+='</div><div id="stockStatus" style="font-size:12px;margin-top:8px;color:var(--text-light);"></div></div>';
    if(isAdmin()&&mergeSelectingId){
      var selectedMain=products[mergeSelectingId];
      html+='<div class="card" style="margin-bottom:12px;border:1px solid var(--warning);"><b>Выбрана главная карточка:</b> '+esc(selectedMain&&selectedMain.name||'Товар')+'<div style="font-size:12px;color:var(--text-light);margin-top:4px;">Теперь выберите вторую карточку. Если у обеих карточек есть остатки в одной локации, размеры и количество будут сложены без потери товара.</div></div>';
    }
    if(!list.length) html+='<div class="card" style="text-align:center;color:var(--text-light);">В выбранном магазине или на складе пока нет товаров с остатком.</div>';
    list.forEach(function(p){
      var balanceStoreId=isAdmin()?String(selectedStoreId):String(storeId());
      var currentBalance=balances[balanceStoreId]&&balances[balanceStoreId][String(p.id)]||{};
      var q=isAdmin()?(selectedStoreId==='all'?locations.reduce(function(sum,loc){return sum+qty(p.id,loc);},0):qty(p.id,selectedStoreId)):qty(p.id,storeId());
      var shownSizes=selectedStoreId==='all'&&isAdmin()?locations.reduce(function(all,loc){var b=balances[loc]&&balances[loc][String(p.id)];return all.concat(b&&Array.isArray(b.sizes)?b.sizes:[]);},[]):(Array.isArray(currentBalance.sizes)?currentBalance.sizes:[]);
      var sizesHtml=shownSizes.length?'<div style="font-size:13px;margin-top:6px;"><span style="color:var(--text-light);">Размеры:</span> <b>'+esc(sizeLabel(shownSizes))+'</b></div>':'<div style="font-size:12px;color:var(--text-light);margin-top:6px;">Размеры пока не добавлены</div>';
      var state=p.status==='pending'?'Ожидает проверки':p.status==='active'?'Опубликован':'Архив';
      var costHtml=isAdmin()&&p.purchaseCost!=null?'<div style="font-size:13px;margin-top:5px;">Закупка: <b>'+esc(p.purchaseCost)+'</b></div>':'';
      html+='<div class="card" style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;"><div '+(isSeller()&&p.status==='active'?'data-stock-photo="'+esc(p.id)+'" title="Нажмите, чтобы заменить фото"':'')+' style="width:76px;height:76px;border-radius:10px;background:#f7f2f4;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;'+(isSeller()&&p.status==='active'?'cursor:pointer;outline:1px dashed var(--primary);':'')+'">'+(p.photoUrl?'<img src="'+esc(cardPhotoUrl(p.photoUrl))+'" alt="" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover;">':'<span style="font-size:25px;">📦</span>')+'</div><div style="flex:1;min-width:160px;"><b '+(isSeller()&&p.status==='active'?'data-stock-rename="'+esc(p.id)+'" title="Нажмите, чтобы изменить название" style="cursor:pointer;border-bottom:1px dashed var(--primary);"':'')+'>'+esc(p.name||'Без названия')+'</b><div style="font-size:12px;color:var(--text-light);margin-top:3px;">'+esc([p.article,p.category,p.color].filter(Boolean).join(' · '))+'</div>'+sizesHtml+'<div style="font-size:12px;margin-top:5px;">'+(isAdmin()?esc(p.direction==='krossy'?'Кроссы':p.direction==='easy'?'Изи':'Не назначено')+' · ':'')+esc(state)+'</div>'+costHtml+'<div style="font-size:13px;margin-top:5px;"><b>Остаток: '+q+'</b>'+(isAdmin()?(selectedStoreId==='all'?' шт. всего':' шт. в этом магазине'):' шт.')+'</div></div><div class="stock-card-actions" style="display:flex;gap:5px;flex-wrap:wrap;">';
      if(canEditCard(p)) html+='<button class="btn btn-secondary" type="button" onclick="stockOpenForm(\''+esc(p.id)+'\')">Изменить</button>';
      if(isAdmin() && selectedStoreId!=='all' && p.status==='active') html+='<button class="btn btn-primary" type="button" onclick="stockMove(\''+esc(p.id)+'\',\''+esc(balanceStoreId)+'\')">Переместить</button>';
      if(isAdmin() && p.status==='active'){
        if(!mergeSelectingId) html+='<button class="btn btn-warning" type="button" data-stock-merge-start="'+esc(p.id)+'">Объединить</button>';
        else if(String(mergeSelectingId)!==String(p.id)){
          var eligibility=mergeEligibility(mergeSelectingId,p.id,mergeSelectingStoreId,selectedStoreId);
          html+='<button class="btn '+(eligibility.ok?'btn-warning':'btn-secondary')+'" type="button" data-stock-merge-finish="'+esc(p.id)+'" '+(eligibility.ok?'':'disabled title="'+esc(eligibility.reason)+'"')+'>Объединить</button>';
          if(!eligibility.ok)html+='<div style="flex-basis:100%;font-size:11px;color:var(--danger,#b42318);margin-top:3px;">'+esc(eligibility.reason)+'</div>';
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
    var catalogButton=root.querySelector('#stockOpenCatalog');if(catalogButton)catalogButton.addEventListener('click',openCatalog);
    var advisorCategorySelect=root.querySelector('#stockAdvisorCategory');if(advisorCategorySelect)advisorCategorySelect.addEventListener('change',function(){advisorCategoryFilter=String(this.value||'all');render();});
    root.querySelectorAll('[data-stock-tab]').forEach(function(b){b.addEventListener('click',function(){adminTab=b.getAttribute('data-stock-tab');render();});});
    root.querySelectorAll('[data-stock-advisor-move]').forEach(function(b){b.addEventListener('click',function(){moveProduct(b.getAttribute('data-product-id'),b.getAttribute('data-source-id'),{targetId:b.getAttribute('data-target-id'),storesOnly:true,forceAll:true});});});
    root.querySelectorAll('[data-stock-select-store]').forEach(function(b){b.addEventListener('click',function(){selectedStoreId=b.getAttribute('data-stock-select-store');persistSelectedStore();render();});});
    root.querySelectorAll('[data-stock-rename]').forEach(function(el){el.addEventListener('click',function(){renameProduct(el.getAttribute('data-stock-rename'));});});
    root.querySelectorAll('[data-stock-photo]').forEach(function(el){el.addEventListener('click',function(){chooseProductPhoto(el.getAttribute('data-stock-photo'));});});
    root.querySelectorAll('[data-stock-merge-start]').forEach(function(b){b.addEventListener('click',function(){
      var origin=String(selectedStoreId||'');
      if(!origin||origin==='all'||stockLocationIds().map(String).indexOf(origin)===-1){alert('Сначала откройте конкретный магазин или склад и выберите карточку в нём.');return;}
      var productId=String(b.getAttribute('data-stock-merge-start')||'');
      if(qty(productId,origin)<=0){alert('У этой карточки нет остатка в выбранной локации.');return;}
      mergeSelectingId=productId;mergeSelectingStoreId=origin;render();
    });});
    root.querySelectorAll('[data-stock-merge-cancel]').forEach(function(b){b.addEventListener('click',function(){mergeSelectingId='';mergeSelectingStoreId='';render();});});
    root.querySelectorAll('[data-stock-merge-finish]').forEach(function(b){b.addEventListener('click',function(){merge(mergeSelectingId,b.getAttribute('data-stock-merge-finish'),mergeSelectingStoreId,selectedStoreId);});});
  }

  function openCatalog(){
    if(!isAdmin() || !canUse()){alert('Общий каталог доступен только администратору после подключения к Firebase.');return;}
    var targetId=String(selectedStoreId||'');
    var locations=stockLocationIds().map(String);
    if(!targetId || targetId==='all' || locations.indexOf(targetId)===-1){
      alert('Сначала выберите конкретный магазин или склад хранения.');
      return;
    }
    var candidates=allProducts().filter(function(p){return p && p.status==='active' && !p.mergedInto;});
    if(!candidates.length){alert('В общем каталоге пока нет опубликованных карточек.');return;}
    var oldModal=document.getElementById('stockCatalogModal');if(oldModal)oldModal.remove();
    var modal=document.createElement('div');modal.id='stockCatalogModal';
    modal.style.cssText='position:fixed;inset:0;z-index:10020;background:rgba(20,10,16,.58);display:flex;align-items:center;justify-content:center;padding:12px;';
    modal.innerHTML='<div role="dialog" aria-modal="true" aria-labelledby="stockCatalogTitle" style="width:100%;max-width:760px;max-height:92vh;overflow:hidden;display:flex;flex-direction:column;background:var(--card,#fff);color:var(--text);border-radius:14px;padding:18px;box-shadow:0 12px 40px rgba(0,0,0,.25);">'
      +'<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;"><div><h3 id="stockCatalogTitle" style="margin:0;">Общий каталог товаров</h3><div style="font-size:13px;color:var(--text-light);margin-top:4px;">Добавление в место хранения: <b>'+esc(stockLocationName(targetId))+'</b></div></div><button type="button" data-catalog-close="1" aria-label="Закрыть" style="border:0;background:transparent;font-size:25px;cursor:pointer;color:inherit;">×</button></div>'
      +'<input id="stockCatalogSearch" type="search" placeholder="Поиск по названию, артикулу, категории…" style="width:100%;margin:14px 0 10px;padding:11px;border:1px solid var(--border);border-radius:9px;background:var(--card,#fff);color:var(--text);">'
      +'<div style="font-size:12px;color:var(--text-light);margin-bottom:9px;">Выберите существующую карточку. Новая карточка товара не создаётся.</div>'
      +'<div id="stockCatalogItems" style="overflow:auto;min-height:100px;padding:1px 2px 4px;"></div></div>';
    document.body.appendChild(modal);
    var search=modal.querySelector('#stockCatalogSearch'),results=modal.querySelector('#stockCatalogItems');
    function close(){if(modal&&modal.parentNode)modal.parentNode.removeChild(modal);}
    function renderItems(){
      var term=norm(search.value);
      var matches=candidates.filter(function(p){
        return !term || norm([p.name,p.article,p.category,p.color,p.brand,p.model].join(' ')).indexOf(term)!==-1;
      }).sort(function(a,b){return String(a.name||'').localeCompare(String(b.name||''),'ru');});
      if(!matches.length){results.innerHTML='<div style="padding:24px 10px;text-align:center;color:var(--text-light);">По вашему запросу ничего не найдено.</div>';return;}
      results.innerHTML=matches.map(function(p){
        var pid=String(p.id),currentQty=qty(pid,targetId);
        var currentBalance=balances[targetId]&&balances[targetId][pid]||{};
        var currentSizes=Array.isArray(currentBalance.sizes)?currentBalance.sizes:[];
        var sourceLocations=locations.filter(function(sid){return sid!==targetId && qty(pid,sid)>0;});
        var sourceText=sourceLocations.length?sourceLocations.map(function(sid){
          var sourceBalance=balances[sid]&&balances[sid][pid]||{};
          var sourceSizes=Array.isArray(sourceBalance.sizes)?sourceBalance.sizes:[];
          return stockLocationName(sid)+': '+qty(pid,sid)+' шт.'+(sourceSizes.length?' ('+sizeLabel(sourceSizes)+')':'');
        }).join(' · '):'Нет остатков в других магазинах/на складе';
        var moveButtons=sourceLocations.map(function(sid){
          return '<button type="button" class="btn btn-secondary" data-catalog-move="'+esc(pid)+'" data-catalog-source="'+esc(sid)+'" style="font-size:12px;padding:7px 9px;">Переместить из '+esc(stockLocationName(sid))+' · '+qty(pid,sid)+' шт.</button>';
        }).join('');
        return '<div style="display:flex;gap:12px;align-items:flex-start;padding:12px 8px;border-bottom:1px solid var(--border);">'
          +'<div style="width:60px;height:60px;flex:0 0 60px;border-radius:9px;background:#f7f2f4;display:flex;align-items:center;justify-content:center;overflow:hidden;">'
          +(p.photoUrl?'<img src="'+esc(cardPhotoUrl(p.photoUrl))+'" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;">':'<span style="font-size:23px;">📦</span>')+'</div>'
          +'<div style="flex:1;min-width:0;"><b>'+esc(p.name||'Без названия')+'</b>'
          +'<div style="font-size:12px;color:var(--text-light);margin-top:3px;">'+esc([p.article,p.category,p.color].filter(Boolean).join(' · '))+'</div>'
          +'<div style="font-size:12px;margin-top:6px;">'+(currentQty>0?'<span style="color:var(--primary);font-weight:600;">Уже есть здесь: '+currentQty+' шт.</span>'+(currentSizes.length?' · '+esc(sizeLabel(currentSizes)):''):'<span style="color:var(--text-light);">В выбранном месте пока нет остатка</span>')+'</div>'
          +'<div style="font-size:12px;color:var(--text-light);margin-top:4px;">В других локациях: '+esc(sourceText)+'</div>'
          +'<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:9px;">'
          +'<button type="button" class="btn btn-primary" data-catalog-add="'+esc(pid)+'" style="font-size:12px;padding:7px 9px;">'+(currentQty>0?'Добавить / изменить размеры':'Добавить в этот магазин')+'</button>'
          +moveButtons+'</div></div></div>';
      }).join('');
    }
    modal.querySelectorAll('[data-catalog-close]').forEach(function(button){button.addEventListener('click',close);});
    modal.addEventListener('click',function(event){if(event.target===modal)close();});
    search.addEventListener('input',renderItems);
    results.addEventListener('click',function(event){
      var addButton=event.target.closest('[data-catalog-add]');
      if(addButton){
        var productId=String(addButton.getAttribute('data-catalog-add')||'');
        close();
        openForm(productId);
        return;
      }
      var moveButton=event.target.closest('[data-catalog-move]');
      if(moveButton){
        var productIdToMove=String(moveButton.getAttribute('data-catalog-move')||'');
        var sourceId=String(moveButton.getAttribute('data-catalog-source')||'');
        close();
        moveProduct(productIdToMove,sourceId,{targetId:targetId});
      }
    });
    renderItems();
    search.focus();
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
    if(editStoreSelect)editStoreSelect.addEventListener('change',function(){selectedStoreId=String(this.value||'');persistSelectedStore();var balance=balances[selectedStoreId]&&balances[selectedStoreId][String(p.id)]||{};formSizes=Array.isArray(balance.sizes)?balance.sizes.map(String):[];drawSizes();});
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
    if(!canUse()) {
      var syncDiagnostic=String(window.easyAppSyncFirebaseError||'').trim();
      var message='Карточка не сохранена: '+(syncDiagnostic
        ? syncDiagnostic
        : (!navigator.onLine
          ? 'нет подключения к интернету.'
          : 'Firebase ещё не завершил проверку актуальности данных.'));
      var diagnosticBox=document.getElementById('stockSaveError');
      if(diagnosticBox) diagnosticBox.textContent=message;
      alert(message);
      return;
    }
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
  function moveProduct(id,sourceId,moveOptions){
    if(!isAdmin()||!canUse())return;
    moveOptions=moveOptions||{};
    var p=products[String(id)];if(!p)return;
    var locations=stockLocationIds().map(String),source=String(sourceId);
    var targets=locations.filter(function(k){return k!==source;});
    if(moveOptions.storesOnly)targets=targets.filter(function(k){return visibleStoreIds().map(String).indexOf(k)!==-1;});
    var preferredTarget=String(moveOptions.targetId||'');
    if(moveOptions.storesOnly)targets=targets.filter(function(k){return visibleStoreIds().map(String).indexOf(k)!==-1;});
    if(!targets.length){alert('Нет другого магазина для перемещения.');return;}
    var sourceBalance=balances[source]&&balances[source][String(id)]||{};
    var sourceSizes=Array.isArray(sourceBalance.sizes)?sourceBalance.sizes.map(String):[];
    if(!sourceSizes.length){alert('В выбранном месте нет размеров для перемещения.');return;}
    var counts={};
    sourceSizes.forEach(function(size){counts[size]=(counts[size]||0)+1;});
    var sortedSizes=Object.keys(counts).sort(function(a,b){
      var an=/^\d+$/.test(a),bn=/^\d+$/.test(b);
      if(an&&bn)return Number(a)-Number(b);
      if(an)return -1;if(bn)return 1;
      var letters=['XXS','XS','S','M','L','XL','2XL','3XL','4XL','5XL'];
      return letters.indexOf(a.toUpperCase())-letters.indexOf(b.toUpperCase());
    });
    var modal=document.getElementById('stockMoveModal');if(modal)modal.remove();
    modal=document.createElement('div');modal.id='stockMoveModal';
    modal.style.cssText='position:fixed;inset:0;z-index:10080;background:rgba(20,20,25,.55);display:flex;align-items:center;justify-content:center;padding:14px;overflow-y:auto;';
    if(preferredTarget&&targets.indexOf(preferredTarget)===-1)preferredTarget='';
    var options=targets.map(function(k){return '<option value="'+esc(k)+'" '+(preferredTarget===k?'selected':'')+'>'+esc(stockLocationName(k))+'</option>';}).join('');
    var rows=sortedSizes.map(function(size){
      return '<label style="display:grid;grid-template-columns:minmax(0,1fr) 90px 72px;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid var(--border);"><span style="font-weight:600;">'+esc(size)+' <small style="font-weight:400;color:var(--text-light);">доступно '+counts[size]+'</small></span><input type="number" min="0" max="'+counts[size]+'" step="1" value="0" data-move-size="'+esc(size)+'" style="width:100%;min-width:0;padding:8px;border:1px solid var(--border);border-radius:8px;"><button type="button" class="btn btn-secondary" data-move-all-size="'+esc(size)+'" style="padding:6px;">Все</button></label>';
    }).join('');
    modal.innerHTML='<div role="dialog" aria-modal="true" aria-labelledby="stockMoveTitle" style="width:100%;max-width:480px;max-height:90vh;overflow:auto;background:var(--card,#fff);color:var(--text);border-radius:14px;padding:18px;box-shadow:0 12px 40px rgba(0,0,0,.25);">'
      +'<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;"><h3 id="stockMoveTitle" style="margin:0;">Перемещение товара</h3><button type="button" data-move-close="1" aria-label="Закрыть" style="border:0;background:transparent;font-size:24px;cursor:pointer;">×</button></div>'
      +'<p style="margin:8px 0 14px;font-weight:600;">'+esc(p.name||'Товар')+'</p>'
      +'<div style="font-size:13px;color:var(--text-light);margin-bottom:5px;">Откуда</div><div style="padding:10px;border:1px solid var(--border);border-radius:8px;margin-bottom:12px;">'+esc(stockLocationName(source))+'</div>'
      +'<label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;" for="stockMoveTarget">Куда переместить</label><select id="stockMoveTarget" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--card,#fff);color:var(--text);">'+options+'</select>'
      +'<div style="font-size:13px;font-weight:600;margin:16px 0 7px;">Количество</div>'
      +'<label style="display:flex;gap:8px;align-items:center;padding:10px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;"><input type="radio" name="stockMoveMode" value="all" checked> <span>Переместить весь остаток — '+sourceSizes.length+' шт.</span></label>'
      +(moveOptions.forceAll?'':'<label style="display:flex;gap:8px;align-items:center;padding:10px;border:1px solid var(--border);border-radius:8px;"><input type="radio" name="stockMoveMode" value="partial"> <span>Выбрать размеры и количество</span></label><div id="stockMoveSizes" style="display:none;margin-top:8px;">'+rows+'</div>')
      +'<div id="stockMoveSummary" style="font-size:13px;color:var(--text-light);margin-top:12px;">Будет перемещено: '+sourceSizes.length+' шт.</div>'
      +'<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px;"><button type="button" class="btn btn-secondary" data-move-close="1">Отмена</button><button type="button" class="btn btn-primary" id="stockMoveConfirm">Переместить</button></div>'
      +'</div>';
    document.body.appendChild(modal);
    function close(){if(modal&&modal.parentNode)modal.parentNode.removeChild(modal);}
    function selectedSizes(){
      var mode=modal.querySelector('input[name="stockMoveMode"]:checked');
      if(!mode||mode.value==='all')return sourceSizes.slice();
      var wanted=[];
      modal.querySelectorAll('[data-move-size]').forEach(function(input){
        var n=Number(input.value),max=Number(input.max);
        if(!Number.isInteger(n)||n<0||n>max)throw new Error('Проверьте количество для размера '+input.getAttribute('data-move-size')+'.');
        for(var j=0;j<n;j++)wanted.push(String(input.getAttribute('data-move-size')));
      });
      return wanted;
    }
    function updateSummary(){
      try{
        var n=selectedSizes().length,summary=modal.querySelector('#stockMoveSummary');
        if(summary)summary.textContent='Будет перемещено: '+n+' шт.';
        var confirmButton=modal.querySelector('#stockMoveConfirm');
        if(confirmButton)confirmButton.disabled=n===0;
      }catch(e){
        var summaryError=modal.querySelector('#stockMoveSummary');
        if(summaryError)summaryError.textContent=e.message;
        var confirmError=modal.querySelector('#stockMoveConfirm');if(confirmError)confirmError.disabled=true;
      }
    }
    modal.querySelectorAll('[data-move-close]').forEach(function(b){b.addEventListener('click',close);});
    modal.querySelectorAll('input[name="stockMoveMode"]').forEach(function(r){
      r.addEventListener('change',function(){
        modal.querySelector('#stockMoveSizes').style.display=r.value==='partial'&&r.checked?'block':'none';
        updateSummary();
      });
    });
    modal.querySelectorAll('[data-move-size]').forEach(function(input){input.addEventListener('input',updateSummary);});
    modal.querySelectorAll('[data-move-all-size]').forEach(function(button){
      button.addEventListener('click',function(){
        var size=button.getAttribute('data-move-all-size'),input=modal.querySelector('[data-move-size="'+size.replace(/"/g,'\\"')+'"]');
        if(input){input.value=input.max;var partial=modal.querySelector('input[name="stockMoveMode"][value="partial"]');partial.checked=true;modal.querySelector('#stockMoveSizes').style.display='block';updateSummary();}
      });
    });
    modal.querySelector('#stockMoveConfirm').addEventListener('click',function(){
      var button=modal.querySelector('#stockMoveConfirm');
      try{
        var moving=selectedSizes(),target=String(modal.querySelector('#stockMoveTarget').value||'');
        if(!targets.includes(target))throw new Error('Выберите корректное место назначения.');
        if(!moving.length)throw new Error('Укажите количество для перемещения.');
        if(moving.length>sourceSizes.length)throw new Error('Нельзя переместить больше остатка.');
        var remaining=sourceSizes.slice();
        moving.forEach(function(size){
          var index=remaining.indexOf(size);
          if(index<0)throw new Error('Остаток изменился. Обновите карточку и повторите перемещение.');
          remaining.splice(index,1);
        });
        button.disabled=true;button.textContent='Перемещаем…';
        var transferError=null,transferTime=Date.now();
        db.ref(BALANCES_PATH).transaction(function(allBalances){
          allBalances=allBalances||{};
          var liveSource=allBalances[source]&&allBalances[source][String(id)]||{};
          var liveSourceSizes=Array.isArray(liveSource.sizes)?liveSource.sizes.map(String):[];
          var liveRemaining=liveSourceSizes.slice();
          for(var moveIndex=0;moveIndex<moving.length;moveIndex++){
            var liveIndex=liveRemaining.indexOf(moving[moveIndex]);
            if(liveIndex<0){transferError='Остаток изменился или товара уже недостаточно. Обновите карточку и повторите.';return;}
            liveRemaining.splice(liveIndex,1);
          }
          var liveTarget=allBalances[target]&&allBalances[target][String(id)]||{};
          var liveTargetSizes=Array.isArray(liveTarget.sizes)?liveTarget.sizes.map(String):[];
          var nextBalances=Object.assign({},allBalances);
          nextBalances[source]=Object.assign({},allBalances[source]||{});
          nextBalances[target]=Object.assign({},allBalances[target]||{});
          nextBalances[source][String(id)]=Object.assign({},liveSource,{quantity:liveRemaining.length,sizes:liveRemaining,updatedAt:transferTime});
          nextBalances[target][String(id)]=Object.assign({},liveTarget,{quantity:liveTargetSizes.length+moving.length,sizes:liveTargetSizes.concat(moving),updatedAt:transferTime});
          return nextBalances;
        },undefined,false).then(function(result){
          if(!result.committed)throw new Error(transferError||'Перемещение не выполнено. Остатки не изменены.');
          close();render();alert('Перемещение выполнено: '+moving.length+' шт. ('+sizeLabel(moving)+').');
        }).catch(function(error){
          button.disabled=false;button.textContent='Переместить';
          alert('Не удалось переместить товар: '+(error&&error.message||error));
        });
      }catch(error){alert(error&&error.message||String(error));}
    });
    modal.addEventListener('click',function(event){if(event.target===modal)close();});
  }
  function activeStockLocations(productId){
    // Include the organization's warehouse as well as retail stores.
    return stockLocationIds().filter(function(location){
      return Number(qty(productId,location))>0;
    }).map(String);
  }
  function mergeEligibility(mainId,sourceId,mainOrigin,sourceOrigin){
    var main=products[String(mainId)],source=products[String(sourceId)];
    if(!main||!source)return {ok:false,reason:'Карточка не найдена.'};
    if(String(mainId)===String(sourceId))return {ok:false,reason:'Нельзя объединить карточку саму с собой.'};
    if(main.status!=='active'||source.status!=='active'||main.mergedInto||source.mergedInto)return {ok:false,reason:'Можно объединять только активные карточки.'};
    if(main.org!==source.org || (main.direction&&source.direction&&main.direction!==source.direction))return {ok:false,reason:'Карточки должны относиться к одной организации и направлению.'};
    var locations=stockLocationIds().map(String);
    mainOrigin=String(mainOrigin||'');sourceOrigin=String(sourceOrigin||'');
    if(!mainOrigin||!sourceOrigin||mainOrigin==='all'||sourceOrigin==='all'||locations.indexOf(mainOrigin)===-1||locations.indexOf(sourceOrigin)===-1)return {ok:false,reason:'Выберите для каждой карточки отдельный магазин или склад хранения.'};
    if(mainOrigin===sourceOrigin)return {ok:false,reason:'Нельзя объединять две карточки из одного магазина или склада. Выберите другую локацию.'};
    if(qty(mainId,mainOrigin)<=0)return {ok:false,reason:'У первой карточки нет остатка в выбранной локации: '+stockLocationName(mainOrigin)+'.'};
    if(qty(sourceId,sourceOrigin)<=0)return {ok:false,reason:'У второй карточки нет остатка в выбранной локации: '+stockLocationName(sourceOrigin)+'.'};
    var mainLocations=activeStockLocations(mainId),sourceLocations=activeStockLocations(sourceId);
    return {ok:true,mainLocations:mainLocations,sourceLocations:sourceLocations,mainOrigin:mainOrigin,sourceOrigin:sourceOrigin};
  }
  function mergeCompareCardHtml(product,role,locations){
    var total=locations.reduce(function(sum,location){return sum+qty(product.id,location);},0);
    var direction=product.direction==='krossy'?'Кроссы':product.direction==='easy'?'Изи':'Не назначено';
    var html='<div style="min-width:0;padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--card,#fff);">';
    html+='<div style="font-size:11px;font-weight:700;color:var(--text-light);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;">'+esc(role)+'</div>';
    html+='<div style="display:flex;gap:9px;align-items:flex-start;min-width:0;">';
    if(product.photoUrl)html+='<img src="'+esc(cardPhotoUrl(product.photoUrl))+'" alt="" loading="lazy" style="width:64px;height:64px;object-fit:cover;border-radius:9px;flex:0 0 64px;">';
    html+='<div style="min-width:0;"><div style="font-size:15px;font-weight:700;overflow-wrap:anywhere;">'+esc(product.name||'Без названия')+'</div>';
    html+='<div style="font-size:12px;color:var(--text-light);margin-top:4px;overflow-wrap:anywhere;">'+esc([product.article,product.category,product.color].filter(Boolean).join(' · ')||'Без дополнительных данных')+'</div>';
    html+='<div style="font-size:12px;color:var(--text-light);margin-top:4px;">'+esc(direction)+'</div></div></div>';
    html+='<div style="margin-top:10px;padding:9px;border-radius:8px;background:var(--bg,#f7f7f8);"><div style="font-size:11px;color:var(--text-light);">Всего по всем локациям</div><div style="font-size:20px;font-weight:800;">'+total+' шт.</div></div>';
    html+='<div style="font-size:12px;font-weight:700;margin:11px 0 6px;">Остатки по магазинам и складу</div>';
    html+='<div style="display:grid;gap:6px;">';
    locations.forEach(function(location){
      var balance=balances[location]&&balances[location][String(product.id)]||{};
      var sizes=Array.isArray(balance.sizes)?balance.sizes.map(String):[];
      var quantity=qty(product.id,location);
      html+='<div style="padding:7px 8px;border:1px solid var(--border);border-radius:8px;min-width:0;">';
      html+='<div style="display:flex;justify-content:space-between;gap:6px;align-items:baseline;"><span style="font-size:12px;font-weight:600;overflow-wrap:anywhere;">'+esc(stockLocationName(location))+'</span><b style="font-size:12px;white-space:nowrap;">'+quantity+' шт.</b></div>';
      html+='<div style="font-size:11px;color:var(--text-light);margin-top:3px;overflow-wrap:anywhere;">Размеры: '+(quantity>0?(sizes.length?esc(sizeLabel(sizes)):'не указаны'):'нет остатка')+'</div></div>';
    });
    html+='</div></div>';
    return html;
  }

  function merge(mainId,sourceId,mainOrigin,sourceOrigin){
    if(!isAdmin()||!canUse())return;
    mainId=String(mainId||'');sourceId=String(sourceId||'');
    var eligibility=mergeEligibility(mainId,sourceId,mainOrigin,sourceOrigin);
    if(!eligibility.ok){alert(eligibility.reason);return;}
    var main=products[mainId],source=products[sourceId];
    var locations=stockLocationIds().map(String);
    var oldModal=document.getElementById('stockMergeConfirmModal');if(oldModal)oldModal.remove();
    var modal=document.createElement('div');modal.id='stockMergeConfirmModal';
    modal.style.cssText='position:fixed;inset:0;z-index:10060;background:rgba(20,10,16,.62);display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;';
    modal.innerHTML='<div style="width:min(980px,100%);max-height:94vh;overflow:auto;background:var(--card,#fff);color:var(--text);border-radius:16px;padding:16px;box-shadow:0 20px 70px rgba(0,0,0,.28);">'
      +'<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">'
      +'<div><h3 style="margin:0;font-size:19px;">Сравнение карточек перед объединением</h3>'
      +'<p style="font-size:13px;color:var(--text-light);margin:6px 0 0;">Проверьте названия, характеристики, размеры и остатки в каждой локации.</p></div>'
      +'<button type="button" data-merge-close aria-label="Закрыть" style="border:0;background:transparent;color:var(--text);font-size:25px;line-height:1;cursor:pointer;padding:0 4px;">×</button></div>'
      +'<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:14px;">'
      +mergeCompareCardHtml(main,'Главная карточка · останется',locations)
      +mergeCompareCardHtml(source,'Объединяемая карточка · будет закрыта',locations)
      +'</div>'
      +'<div style="margin-top:12px;padding:11px;border:1px solid var(--border);border-radius:9px;font-size:13px;">'
      +'<b>Что произойдёт:</b> остатки и размеры второй карточки будут перенесены в первую в локациях: '
      +'<b>'+esc(eligibility.sourceLocations.map(function(location){return stockLocationName(location);}).join(', '))+'</b>. '
      +'Первая карточка из «'+esc(stockLocationName(mainOrigin))+'» останется основной. Вторая карточка из «'+esc(stockLocationName(sourceOrigin))+'» будет объединена с ней.</div>'
      +'<div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:14px;">'
      +'<button type="button" class="btn btn-secondary" data-merge-close>Отмена</button>'
      +'<button type="button" class="btn btn-warning" data-merge-confirm>Подтвердить объединение</button>'
      +'</div></div>';
    document.body.appendChild(modal);

    var closed=false;
    function closeModal(){
      if(closed)return;
      closed=true;
      modal.remove();
      document.removeEventListener('keydown',onKeydown);
    }
    function onKeydown(event){if(event.key==='Escape')closeModal();}
    modal.querySelectorAll('[data-merge-close]').forEach(function(button){button.addEventListener('click',closeModal);});
    modal.addEventListener('click',function(event){if(event.target===modal)closeModal();});
    document.addEventListener('keydown',onKeydown);

    var confirmButton=modal.querySelector('[data-merge-confirm]');
    confirmButton.addEventListener('click',function(){
      if(!isAdmin()||!canUse()){closeModal();alert('Соединение потеряно. Объединение не выполнено.');return;}
      var currentEligibility=mergeEligibility(mainId,sourceId,mainOrigin,sourceOrigin);
      if(!currentEligibility.ok){closeModal();alert('Остатки изменились. Проверьте карточки ещё раз: '+currentEligibility.reason);render();return;}
      var currentMain=products[mainId],currentSource=products[sourceId];
      if(!currentMain||!currentSource){closeModal();alert('Одна из карточек больше недоступна. Объединение не выполнено.');render();return;}
      confirmButton.disabled=true;
      confirmButton.textContent='Объединяем...';
      var sourceLocationNames=currentEligibility.sourceLocations.map(function(location){return stockLocationName(location);}).join(', ');
      var patch={},now=Date.now();
      currentEligibility.sourceLocations.forEach(function(location){
        var sourceBalance=balances[location]&&balances[location][sourceId]||{};
        var mainBalance=balances[location]&&balances[location][mainId]||{};
        var sourceQuantity=Number(sourceBalance.quantity||0);
        if(sourceQuantity<=0)return;
        var mainQuantity=Number(mainBalance.quantity||0);
        var combinedBalance=Object.assign({},sourceBalance,mainBalance,{
          quantity:mainQuantity+sourceQuantity,
          updatedAt:now
        });
        if(Array.isArray(sourceBalance.sizes)||Array.isArray(mainBalance.sizes)){
          combinedBalance.sizes=(Array.isArray(mainBalance.sizes)?mainBalance.sizes.map(String):[])
            .concat(Array.isArray(sourceBalance.sizes)?sourceBalance.sizes.map(String):[]);
        }
        patch[BALANCES_PATH+'/'+location+'/'+mainId]=combinedBalance;
        patch[BALANCES_PATH+'/'+location+'/'+sourceId]=null;
      });
      // Remove any zero-only balance records from the source in stores and in the warehouse.
      stockLocationIds().forEach(function(location){
        if(currentEligibility.sourceLocations.indexOf(String(location))===-1 && balances[String(location)] && balances[String(location)][sourceId]){
          patch[BALANCES_PATH+'/'+location+'/'+sourceId]=null;
        }
      });
      var movementId=uid('sm');
      patch[MOVEMENTS_PATH+'/'+movementId]={id:movementId,org:org(),productId:mainId,mergedProductId:sourceId,type:'merge',createdAt:now,createdById:String(user().id),createdByName:String(user().name||''),note:'Объединение «'+currentSource.name+'» в главную карточку «'+currentMain.name+'». Локации: '+sourceLocationNames};
      patch[PRODUCTS_PATH+'/'+sourceId+'/status']='merged';
      patch[PRODUCTS_PATH+'/'+sourceId+'/mergedInto']=mainId;
      patch[PRODUCTS_PATH+'/'+sourceId+'/mergedAt']=now;
      patch[PRODUCTS_PATH+'/'+sourceId+'/mergedById']=String(user().id);
      patch[PRODUCTS_PATH+'/'+sourceId+'/mergedByName']=String(user().name||'');
      patch[PRODUCTS_PATH+'/'+mainId+'/updatedAt']=now;
      db.ref().update(patch).then(function(){
        closeModal();
        mergeSelectingId='';
        mergeSelectingStoreId='';
        addAuditSafe('stock_product_merge','Объединена карточка «'+currentSource.name+'» в главную карточку «'+currentMain.name+'». Перенесены локации: '+sourceLocationNames);
        render();
      }).catch(function(error){
        confirmButton.disabled=false;
        confirmButton.textContent='Подтвердить объединение';
        alert('Не удалось объединить карточки: '+(error&&error.message||error));
      });
    });
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
    if(!isAdmin()||!loaded.products||!loaded.balances)return {ready:false,rows:[],message:'Складские данные ещё загружаются.'};
    var now=Date.now(),day=86400000,target=Math.max(1,Math.min(60,Number(targetDays)||14));
    var salesRows=window.sales||[];
    var stores=visibleStoreIds().filter(function(id){return selectedStore==='all'||String(id)===String(selectedStore);});
    var endMs=endDate?Math.min(stockLocalDateMs(endDate,true)||now,now):now;
    var startMs=startDate?stockLocalDateMs(startDate,false):endMs-30*day;
    if(!startMs||!endMs||startMs>endMs)return {ready:true,rows:[],message:'Проверьте выбранный период.'};
    var periodDays=startDate?Math.max(1,Math.ceil((endMs-startMs+1)/day)):30;
    var dayKey=new Date(now).toISOString().slice(0,10);
    var cacheKey=[org(),String(selectedStore||'all'),stores.join(','),target,String(startDate||''),String(endDate||''),dayKey,replenishmentCacheRevision,salesRows.length].join('|');
    var cached=replenishmentCache[cacheKey];
    if(cached&&cached.salesRef===salesRows&&cached.salesLength===salesRows.length)return cached.result;

    var storeSet=Object.create(null),soldByKey=Object.create(null),rows=[];
    stores.forEach(function(id){storeSet[String(id)]=true;});
    salesRows.forEach(function(sale){
      if(!sale||!sale.stockProductId||!sale.stockStoreId||!sale.id||sale.returned)return;
      if(sale.stockOrg&&String(sale.stockOrg)!==String(org()))return;
      var sid=String(sale.stockStoreId);
      if(!storeSet[sid])return;
      if(typeof isSaleRecordDeleted==='function'&&isSaleRecordDeleted(sale.id))return;
      if(typeof isRecordBeforeStoreReset==='function'&&isRecordBeforeStoreReset(sale))return;
      var at=stockDateMs(sale.timestamp||sale.createdAt);
      if(!at||at<startMs||at>endMs)return;
      var pid=stockResolvedId(sale.stockProductId),key=pid+'|'+sid;
      var units=Number(sale.stockQuantity)||1;
      if(!isFinite(units)||units<=0)units=1;
      soldByKey[key]=(soldByKey[key]||0)+units;
    });

    var active=allProducts().filter(function(product){return product.status==='active';});
    var salesRankByKey=Object.create(null);
    stores.forEach(function(sid){
      var selling=[];
      active.forEach(function(product){
        var key=String(product.id)+'|'+String(sid),units=Number(soldByKey[key]||0);
        if(units>0)selling.push({productId:String(product.id),name:String(product.name||''),units:units});
      });
      selling.sort(function(a,b){return b.units-a.units||a.name.localeCompare(b.name,'ru');});
      var topCount=selling.length?Math.max(1,Math.ceil(selling.length*0.25)):0;
      selling.forEach(function(item,index){salesRankByKey[item.productId+'|'+String(sid)]=index<topCount?index+1:null;});
    });

    function isFootwearProduct(product){
      var category=norm(product&&product.category||'');
      return /обув|крос|ботин|сандал|туфл|shoe|sneaker/.test(category);
    }
    active.forEach(function(product){
      var pid=String(product.id),footwear=isFootwearProduct(product);
      stores.forEach(function(sid){
        var current=qty(pid,sid),key=pid+'|'+sid,units=Number(soldByKey[key]||0);
        if(units<=0&&current<=0)return;
        var rate=units/periodDays;
        var coverage=rate>0?current/rate:null;
        var recommended=rate>0?Math.max(0,Math.ceil(rate*target-current)):0;
        var salesRank=salesRankByKey[key],isTopSeller=salesRank!==undefined&&salesRank!==null;
        var urgentStockLimit=footwear?3:1;
        var priorityStatus=(isTopSeller&&current<=urgentStockLimit)||(coverage!==null&&coverage<=2)?'urgent':(current<=0||(coverage!==null&&coverage<=4)?'soon':'sufficient');
        var periodLabel=startDate?'за выбранный период':'за последние 30 дней';
        var reason=units<=0?'Продаж '+periodLabel+' нет':recommended>0?'По продажам '+periodLabel+' текущего остатка недостаточно на '+target+' дней':'Запаса достаточно';
        rows.push({
          productId:pid,productName:String(product.name||'Без названия'),photoUrl:String(product.photoUrl||''),
          storeId:sid,storeName:stockLocationName(sid),currentStock:current,soldUnits:units,
          availableDays:null,periodDays:periodDays,dailyDemand:rate,coverageDays:coverage,
          recommendedQty:recommended,known:false,reason:reason,
          purchaseCost:product.purchaseCost==null||product.purchaseCost===''?null:Number(product.purchaseCost),
          priorityStatus:priorityStatus,salesRank:salesRank,urgentStockLimit:urgentStockLimit,isFootwear:footwear
        });
      });
    });
    var priorityOrder={urgent:0,soon:1,sufficient:2};
    rows.sort(function(a,b){return priorityOrder[a.priorityStatus]-priorityOrder[b.priorityStatus]||(b.recommendedQty-a.recommendedQty)||(a.coverageDays==null?1:b.coverageDays==null?-1:a.coverageDays-b.coverageDays)||a.productName.localeCompare(b.productName,'ru');});
    var result={ready:true,rows:rows,periodDays:periodDays,targetDays:target,startDate:startDate||'',endDate:endDate||'',currentAsOf:new Date(now).toISOString(),calculationMode:'last_30_days_sales'};
    replenishmentCache[cacheKey]={salesRef:salesRows,salesLength:salesRows.length,result:result};
    var cacheKeys=Object.keys(replenishmentCache);if(cacheKeys.length>12)delete replenishmentCache[cacheKeys[0]];
    return result;
  }
  function getCardSalesRanking(startDate,endDate,selectedStore,previousStartDate,previousEndDate){
    if(!isAdmin()||!loaded.products||!loaded.balances)return {ready:false,rows:[],message:'Складские данные ещё загружаются.'};
    var now=Date.now(),salesRows=window.sales||[];
    var stores=visibleStoreIds().filter(function(id){return selectedStore==='all'||String(id)===String(selectedStore);});
    var storeSet={};stores.forEach(function(id){storeSet[String(id)]=true;});
    var active=allProducts().filter(function(p){return p.status!=='pending';}),productById={};
    active.forEach(function(product){productById[String(product.id)]=product;});
    var validSales=[],earliest=Infinity;
    salesRows.forEach(function(sale){
      if(!sale||!sale.stockProductId||!sale.id)return;
      if(sale.stockOrg&&String(sale.stockOrg)!==String(org()))return;
      var sid=String(sale.stockStoreId||sale.storeId||'');
      if(!storeSet[sid])return;
      if(sale.returned)return;
      if(typeof isSaleRecordDeleted==='function'&&isSaleRecordDeleted(sale.id))return;
      if(typeof isStoreDeleted==='function'&&isStoreDeleted(sid))return;
      var resetCheckRecord=sale.storeId?sale:Object.assign({},sale,{storeId:sid});
      if(typeof isRecordBeforeStoreReset==='function'&&isRecordBeforeStoreReset(resetCheckRecord))return;
      var at=stockDateMs(sale.timestamp||sale.createdAt);
      if(!at)return;
      var pid=stockResolvedId(sale.stockProductId);
      if(!productById[pid])return;
      validSales.push({sale:sale,at:at,pid:pid,sid:sid});
      if(at<earliest)earliest=at;
    });
    if(!isFinite(earliest))return {ready:true,rows:[],periodDays:0,message:'За выбранный период нет продаж, связанных с карточками склада.'};
    function dateFloor(ms){var d=new Date(ms);return new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();}
    var startMs=startDate?stockLocalDateMs(startDate,false):dateFloor(earliest);
    var endMs=endDate?stockLocalDateMs(endDate,true):now;
    if(!startMs||!endMs||startMs>endMs)return {ready:true,rows:[],periodDays:0,message:'Проверьте выбранный период.'};
    var periodStartDate=new Date(startMs),periodEndDate=new Date(endMs);
    var periodDays=Math.max(1,Math.round((Date.UTC(periodEndDate.getFullYear(),periodEndDate.getMonth(),periodEndDate.getDate())-Date.UTC(periodStartDate.getFullYear(),periodStartDate.getMonth(),periodStartDate.getDate()))/86400000)+1);
    var prevStartMs=previousStartDate?stockLocalDateMs(previousStartDate,false):0;
    var prevEndMs=previousEndDate?stockLocalDateMs(previousEndDate,true):0;
    var hasPrevious=!!(prevStartMs&&prevEndMs&&prevStartMs<=prevEndMs);
    var totals={};
    active.forEach(function(product){
      var pid=String(product.id),stock=0;
      stores.forEach(function(sid){stock+=qty(pid,sid);});
      totals[pid]={product:product,sold:0,revenue:0,shops:{},previous:0,stock:stock};
    });
    validSales.forEach(function(item){
      var sale=item.sale,record=totals[item.pid];
      if(!record)return;
      var units=Number(sale.stockQuantity)||1;
      if(!isFinite(units)||units<=0)units=1;
      if(item.at>=startMs&&item.at<=endMs){
        record.sold+=units;
        record.revenue+=Math.max(0,Number(sale.price)||0);
        record.shops[item.sid]=true;
      }else if(hasPrevious&&item.at>=prevStartMs&&item.at<=prevEndMs){
        record.previous+=units;
      }
    });
    var rows=[];
    Object.keys(totals).forEach(function(pid){
      var record=totals[pid];
      if(record.sold<=0)return;
      rows.push({
        productId:pid,
        productName:String(record.product.name||'Без названия'),
        photoUrl:String(record.product.photoUrl||''),
        soldUnits:record.sold,
        averageDailySales:record.sold/periodDays,
        storesWithSales:Object.keys(record.shops).length,
        currentStock:record.stock,
        revenue:record.revenue,
        previousSoldUnits:hasPrevious?record.previous:null,
        periodDays:periodDays
      });
    });
    rows.sort(function(a,b){return b.soldUnits-a.soldUnits||b.averageDailySales-a.averageDailySales||a.productName.localeCompare(b.productName,'ru');});
    return {ready:true,rows:rows,periodDays:periodDays,startDate:startDate||new Date(startMs).getFullYear()+'-'+String(new Date(startMs).getMonth()+1).padStart(2,'0')+'-'+String(new Date(startMs).getDate()).padStart(2,'0'),endDate:endDate||'',hasPrevious:hasPrevious};
  }
  function getCardSalesAntiRanking(startDate,endDate,selectedStore){
    if(!isAdmin()||!loaded.products||!loaded.balances||!loaded.movements)return {ready:false,rows:[],insufficientRows:[],message:'История остатков ещё загружается.'};
    var now=Date.now(),salesRows=window.sales||[],DAY=86400000;
    var stores=visibleStoreIds().filter(function(id){return selectedStore==='all'||String(id)===String(selectedStore);});
    if(!stores.length)return {ready:true,rows:[],insufficientRows:[],periodDays:0,message:'Нет доступных магазинов для выбранного фильтра.'};
    var storeSet={},active=allProducts().filter(function(p){return p.status==='active';}),movementByKey={},saleOutMovementIds={},saleReturnMovementIds={},salesByKey={},untrackedReturns={},earliest=Infinity,earliestBalance=Infinity;
    stores.forEach(function(id){storeSet[String(id)]=true;});
    Object.keys(movements).forEach(function(key){
      var m=movements[key];if(!m||String(m.org||'')!==String(org())||!m.storeId)return;
      var sid=String(m.storeId);if(!storeSet[sid]||(typeof isStoreDeleted==='function'&&isStoreDeleted(sid)))return;
      if(typeof isRecordBeforeStoreReset==='function'&&isRecordBeforeStoreReset(m))return;
      var pid=stockResolvedId(m.productId);if(!pid)return;
      var at=stockDateMs(m.createdAt||m.timestamp);if(!at)return;
      var key2=pid+'|'+sid;
      if(!movementByKey[key2])movementByKey[key2]=[];
      var before=m.before==null?null:Number(m.before),after=m.after==null?null:Number(m.after),delta=Number(m.quantityDelta);
      movementByKey[key2].push({at:at,delta:isFinite(delta)?delta:0,before:before,after:after,saleId:m.saleId?String(m.saleId):''});
      if(m.saleId&&String(m.type||'')==='sale')saleOutMovementIds[String(m.saleId)]=true;
      if(m.saleId&&String(m.type||'')==='return')saleReturnMovementIds[String(m.saleId)]=true;
      if(at<earliest)earliest=at;
    });
    salesRows.forEach(function(sale){
      if(!sale||!sale.stockProductId||!sale.id)return;
      if(sale.stockOrg&&String(sale.stockOrg)!==String(org()))return;
      var sid=String(sale.stockStoreId||sale.storeId||'');if(!storeSet[sid]||(typeof isStoreDeleted==='function'&&isStoreDeleted(sid)))return;
      if(typeof isSaleRecordDeleted==='function'&&isSaleRecordDeleted(sale.id))return;
      var resetRecord=sale.storeId?sale:Object.assign({},sale,{storeId:sid});
      if(typeof isRecordBeforeStoreReset==='function'&&isRecordBeforeStoreReset(resetRecord))return;
      var at=stockDateMs(sale.timestamp||sale.createdAt);if(!at)return;
      var pid=stockResolvedId(sale.stockProductId);if(!pid)return;
      var key2=pid+'|'+sid;
      if(at<earliest)earliest=at;
      var units=Number(sale.stockQuantity)||1;
      if(!isFinite(units)||units<=0)units=1;
      if(sale.returned&&!saleReturnMovementIds[String(sale.id)])untrackedReturns[key2]=true;
      if(!saleOutMovementIds[String(sale.id)]){
        if(!movementByKey[key2])movementByKey[key2]=[];
        movementByKey[key2].push({at:at,delta:-units,before:null,after:null,saleId:String(sale.id)});
      }
      if(sale.returned)return;
      if(!salesByKey[key2])salesByKey[key2]={units:0,revenue:0};
      salesByKey[key2].units+=units;
      salesByKey[key2].revenue+=Math.max(0,Number(sale.price)||0);
    });
    if(startDate){
      var startMs=stockLocalDateMs(startDate,false);
    }else{
      var startMs=earliest;
      if(!isFinite(startMs)){
        stores.forEach(function(sid){
          active.forEach(function(product){
            var balance=balances[sid]&&balances[sid][String(product.id)]||{},updated=stockDateMs(balance.updatedAt);
            if(updated&&updated<earliestBalance)earliestBalance=updated;
          });
        });
        startMs=isFinite(earliestBalance)?earliestBalance:now-29*DAY;
      }else{
        var earliestDate=new Date(startMs);
        startMs=new Date(earliestDate.getFullYear(),earliestDate.getMonth(),earliestDate.getDate()).getTime();
      }
    }
    var requestedEndMs=endDate?stockLocalDateMs(endDate,true):now;
    var endMs=Math.min(requestedEndMs||now,now);
    if(!startMs||!endMs||startMs>endMs)return {ready:true,rows:[],insufficientRows:[],periodDays:0,message:'Проверьте выбранный период.'};
    var startDay=new Date(startMs),endDay=new Date(endMs);
    var periodDays=Math.max(1,Math.round((Date.UTC(endDay.getFullYear(),endDay.getMonth(),endDay.getDate())-Date.UTC(startDay.getFullYear(),startDay.getMonth(),startDay.getDate()))/DAY)+1);
    var requiredDays=Math.max(7,periodDays*0.5),rows=[],insufficientRows=[];
    Object.keys(movementByKey).forEach(function(key){movementByKey[key].sort(function(a,b){return a.at-b.at;});});
    function getAvailability(pid,sid){
      var key2=pid+'|'+sid,events=movementByKey[key2]||[],current=qty(pid,sid),balance=balances[sid]&&balances[sid][pid]||{};
      var first=null,deltaSinceStart=0,known=!untrackedReturns[key2];
      for(var i=0;i<events.length;i++){
        var event=events[i];
        if(event.at<startMs||event.at>now)continue;
        deltaSinceStart+=event.delta;
        if(!first)first=event;
      }
      var opening=current-deltaSinceStart;
      if(first&&first.before!==null&&isFinite(first.before))opening=first.before;
      else if(first)known=false;
      else{
        var updated=stockDateMs(balance.updatedAt);
        if(!updated||updated>startMs)known=false;
        else opening=current;
      }
      if(opening<0){known=false;opening=0;}
      var availableDays=0,level=opening,cursor=startMs;
      for(var j=0;j<events.length;j++){
        var periodEvent=events[j],at=periodEvent.at;
        if(at<startMs)continue;
        if(at>endMs)break;
        if(level>0&&at>cursor)availableDays+=(at-cursor)/DAY;
        if(periodEvent.before!==null&&isFinite(periodEvent.before)&&Math.abs(level-periodEvent.before)>0.001)known=false;
        level+=periodEvent.delta;
        if(periodEvent.after!==null&&isFinite(periodEvent.after)&&Math.abs(level-periodEvent.after)>0.001){known=false;level=periodEvent.after;}
        if(level<0){known=false;level=0;}
        cursor=at;
      }
      if(level>0&&endMs>cursor)availableDays+=(endMs-cursor)/DAY;
      var verified=opening;
      for(var k=0;k<events.length;k++){
        var verifyEvent=events[k];
        if(verifyEvent.at<startMs||verifyEvent.at>now)continue;
        if(verifyEvent.before!==null&&isFinite(verifyEvent.before)&&Math.abs(verified-verifyEvent.before)>0.001)known=false;
        verified+=verifyEvent.delta;
        if(verifyEvent.after!==null&&isFinite(verifyEvent.after)&&Math.abs(verified-verifyEvent.after)>0.001){known=false;verified=verifyEvent.after;}
        if(verified<0){known=false;verified=0;}
      }
      if(Math.abs(verified-current)>0.001)known=false;
      availableDays=Math.min(periodDays,Math.max(0,availableDays));
      var eligibilityDays=availableDays,nowDate=new Date(now),todayStart=new Date(nowDate.getFullYear(),nowDate.getMonth(),nowDate.getDate()).getTime();
      if(endMs>=todayStart&&current>0)eligibilityDays+=Math.max(0,1-(now-todayStart)/DAY);
      return {known:known,availableDays:availableDays,eligibilityDays:eligibilityDays,currentStock:current};
    }
    active.forEach(function(product){
      var pid=String(product.id),allSold=0,allRevenue=0,allCurrent=0,knownDays=0,knownStores=0,qualifiedStores=0,sold=0,revenue=0,currentStock=0,availableDays=0,shopsWithSales=0;
      stores.forEach(function(sid){
        var stats=getAvailability(pid,String(sid)),saleStats=salesByKey[pid+'|'+String(sid)]||{units:0,revenue:0};
        allSold+=saleStats.units;allRevenue+=saleStats.revenue;allCurrent+=stats.currentStock;
        if(stats.known){knownStores++;knownDays+=stats.availableDays;}
        if(stats.known&&stats.eligibilityDays+0.01>=requiredDays){
          qualifiedStores++;sold+=saleStats.units;revenue+=saleStats.revenue;currentStock+=stats.currentStock;availableDays+=stats.availableDays;
          if(saleStats.units>0)shopsWithSales++;
        }
      });
      if(qualifiedStores){
        rows.push({
          productId:pid,productName:String(product.name||'Без названия'),photoUrl:String(product.photoUrl||''),
          soldUnits:sold,averageDailySales:availableDays>0?sold/availableDays:0,availableDays:availableDays,
          expectedStoreDays:periodDays*qualifiedStores,storesWithData:qualifiedStores,storesTotal:stores.length,
          storesWithSales:shopsWithSales,currentStock:currentStock,revenue:revenue,periodDays:periodDays,
          excludedStoreCount:stores.length-qualifiedStores
        });
      }else{
        var reason=knownStores===0?'История остатков неполная':knownDays+0.01<7?'Менее 7 дней подтверждённого наличия':'Товар был в наличии менее половины периода';
        insufficientRows.push({
          productId:pid,productName:String(product.name||'Без названия'),photoUrl:String(product.photoUrl||''),
          soldUnits:allSold,revenue:allRevenue,availableDays:knownDays,expectedStoreDays:periodDays*stores.length,
          storesWithData:knownStores,storesTotal:stores.length,currentStock:allCurrent,periodDays:periodDays,
          requiredDays:requiredDays,reason:reason
        });
      }
    });
    rows.sort(function(a,b){return a.averageDailySales-b.averageDailySales||a.soldUnits-b.soldUnits||a.productName.localeCompare(b.productName,'ru');});
    insufficientRows.sort(function(a,b){return b.availableDays-a.availableDays||a.soldUnits-b.soldUnits||a.productName.localeCompare(b.productName,'ru');});
    return {ready:true,rows:rows,insufficientRows:insufficientRows,periodDays:periodDays,requiredDays:requiredDays,startDate:startDate||'',endDate:endDate||'',minimumDays:7,minimumShare:0.5};
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
    window.stockAdjust=adjust;window.stockAddSizes=addSizes;window.stockDelete=deleteProduct;window.stockMove=moveProduct;window.stockSetSearch=setSearch;window.stockSetFilter=setFilter;window.stockGetSaleOptions=getSaleOptions;window.stockGetStoreDirection=getStoreDirectionSetting;window.stockSaveStoreDirection=saveStoreDirectionSetting;window.stockCompleteSale=completeSaleFromStock;window.stockPrepareSaleReturn=prepareSaleReturn;window.stockPrepareSaleDelete=prepareSaleDelete;window.stockRefresh=render;window.stockGetFinancialSummary=getFinancialSummary;window.stockGetReplenishmentRecommendations=getReplenishmentRecommendations;window.stockGetCardSalesRanking=getCardSalesRanking;window.stockGetCardSalesAntiRanking=getCardSalesAntiRanking;window.stockGetStockConsolidationRecommendations=getStockConsolidationRecommendations;window.stockInvalidateReplenishmentCache=invalidateReplenishmentCache;
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
