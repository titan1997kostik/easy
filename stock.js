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
  var searchText = '';
  var editingId = '';
  var selectedPhoto = null;
  var duplicatesExpanded = false;
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
  function canEditCard(p){ return isAdmin() || (isSeller() && p && (sellerCanSee(p) || (p.status === 'pending' && String(p.createdById) === String(user().id)))); }
  function addAuditSafe(action,details){ try { if(typeof addAudit === 'function') addAudit(action,details); } catch(e) { console.warn(e); } }
  function setStatus(msg,isError){ var el=document.getElementById('stockStatus'); if(el){el.textContent=msg || '';el.style.color=isError?'#b42318':'var(--text-light)';} }
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
        b.addEventListener('click',function(){window.easyAppSyncShowPage && window.easyAppSyncShowPage('stock'); render();});
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
      },function(err){ console.error('Stock sync '+name,err); loaded[name]=true; render(); });
    });
  }
  function possibleDuplicates(candidate,excludeId){
    var n=norm(candidate.name), a=norm(candidate.article), c=norm(candidate.color), z=norm(candidate.size), m=norm(candidate.model);
    return allProducts().filter(function(p){
      if(String(p.id)===String(excludeId) || p.status==='archived' || p.status==='merged') return false;
      var pn=norm(p.name), pa=norm(p.article), pm=norm(p.model);
      var compatible=(!c || !p.color || c===norm(p.color)) && (!z || !p.size || z===norm(p.size));
      return compatible && ((a && pa && a===pa && n===pn) || (n && pn===n) || (m && pm===m));
    }).slice(0,8);
  }
  function render(){
    if(!initPage()) return;
    var root=document.getElementById('stockRoot'); if(!root) return;
    if(!user()){root.innerHTML='<div class="card">Войдите в приложение, чтобы открыть склад.</div>';return;}
    if(!canUse()){root.innerHTML='<div class="card">Склад станет доступен после проверки подключения к Firebase.</div>';return;}
    var loading=statusText(); if(loading){root.innerHTML='<div class="card">'+esc(loading)+'</div>';return;}
    if(isSeller() && (!storeId() || !storeDirection(storeId()))){
      root.innerHTML='<div class="card"><b>Склад ещё не настроен.</b><p>Попросите администратора назначить направление вашему магазину в разделе «Магазины».</p></div>';return;
    }
    var list=allProducts().filter(function(p){return isAdmin() ? (activeFilter==='all' || (activeFilter==='pending' ? p.status==='pending' : activeFilter==='active' ? p.status==='active' : p.direction===activeFilter)) : sellerCanSee(p);});
    if(searchText) list=list.filter(function(p){return norm([p.name,p.article,p.category,p.color,p.size,p.brand,p.model].join(' ')).indexOf(norm(searchText))!==-1;});
    list.sort(function(a,b){return Number(b.updatedAt||b.createdAt||0)-Number(a.updatedAt||a.createdAt||0);});
    var html='<div class="card" style="margin-bottom:14px;"><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;"><div><h3 style="margin:0 0 4px;">Товары</h3><div style="font-size:12px;color:var(--text-light);">'+(isAdmin()?'Общий каталог организации':'Каталог вашего магазина')+'</div></div><button class="btn btn-primary" type="button" onclick="stockOpenForm()">＋ Новая карточка</button></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;"><input id="stockSearch" type="search" placeholder="Поиск по названию, артикулу, цвету…" value="'+esc(searchText)+'" oninput="stockSetSearch(this.value)" style="flex:1;min-width:180px;">';
    if(isAdmin()) html+='<select id="stockFilter" onchange="stockSetFilter(this.value)" style="min-width:150px;"><option value="all" '+(activeFilter==='all'?'selected':'')+'>Все карточки</option><option value="pending" '+(activeFilter==='pending'?'selected':'')+'>Ожидают проверки</option><option value="active" '+(activeFilter==='active'?'selected':'')+'>Опубликованные</option><option value="krossy" '+(activeFilter==='krossy'?'selected':'')+'>Кроссы</option><option value="easy" '+(activeFilter==='easy'?'selected':'')+'>Изи</option></select>';
    html+='</div><div id="stockStatus" style="font-size:12px;margin-top:8px;color:var(--text-light);"></div></div>';
    if(!list.length) html+='<div class="card" style="text-align:center;color:var(--text-light);">Карточек пока нет. Создайте первую карточку товара.</div>';
    list.forEach(function(p){
      var q=isAdmin()?visibleStoreIds().reduce(function(sum,s){return sum+qty(p.id,s);},0):qty(p.id,storeId());
      var state=p.status==='pending'?'Ожидает проверки':p.status==='active'?'Опубликован':'Архив';
      html+='<div class="card" style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;"><div style="width:76px;height:76px;border-radius:10px;background:#f7f2f4;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;">'+(p.photoUrl?'<img src="'+esc(p.photoUrl)+'" alt="" style="width:100%;height:100%;object-fit:cover;">':'<span style="font-size:25px;">📦</span>')+'</div><div style="flex:1;min-width:160px;"><b>'+esc(p.name||'Без названия')+'</b><div style="font-size:12px;color:var(--text-light);margin-top:3px;">'+esc([p.article,p.category,p.color,sizeLabel(p.sizes&&p.sizes.length?p.sizes:(p.size?[p.size]:[]))].filter(Boolean).join(' · '))+'</div><div style="font-size:12px;margin-top:5px;">'+(isAdmin()?esc(p.direction==='krossy'?'Кроссы':p.direction==='easy'?'Изи':'Не назначено')+' · ':'')+esc(state)+'</div><div style="font-size:13px;margin-top:5px;"><b>Остаток: '+q+'</b>'+(isAdmin()?' шт. по всем магазинам':' шт.')+'</div></div><div style="display:flex;gap:5px;flex-wrap:wrap;">';
      if(canEditCard(p)) html+='<button class="btn btn-secondary" type="button" onclick="stockOpenForm(\''+esc(p.id)+'\')">Изменить</button>';
      if(isAdmin() && p.status==='pending') html+='<button class="btn btn-success" type="button" onclick="stockReview(\''+esc(p.id)+'\')">Проверить</button>';
      if(isAdmin() && p.status==='active') html+='<button class="btn btn-secondary" type="button" onclick="stockAdjust(\''+esc(p.id)+'\')">Остатки</button><button class="btn btn-warning" type="button" onclick="stockArchive(\''+esc(p.id)+'\')">В архив</button>';
      if(isAdmin() && p.status==='archived') html+='<button class="btn btn-success" type="button" data-stock-restore="'+esc(p.id)+'">Восстановить</button>';
      html+='</div></div>';
    });
    if(isAdmin()){
      html+='<div class="card"><div style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;"><h3 style="margin:0;">Возможные дубли</h3><button class="btn btn-secondary" type="button" id="stockDuplicatesToggle">'+(duplicatesExpanded?'Скрыть проверку':'Проверить дубли')+'</button></div><p style="font-size:12px;color:var(--text-light);">Проверка запускается только по запросу, чтобы не замедлять открытие склада.</p>';
      if(duplicatesExpanded){
        var candidates=allProducts().filter(function(p){return p.status==='pending'||p.status==='active';});
        var dupes=[], seenPairs={};
        candidates.forEach(function(p){possibleDuplicates(p,p.id).forEach(function(m){var pair=[String(p.id),String(m.id)].sort().join('|');if(!seenPairs[pair]){seenPairs[pair]=true;dupes.push({p:p,m:m});}});});
        if(!dupes.length) html+='<div style="font-size:13px;color:var(--text-light);">Подозрительных совпадений не найдено.</div>';
        dupes.slice(0,100).forEach(function(d){html+='<div style="padding:9px 0;border-top:1px solid var(--border);"><b>'+esc(d.p.name)+'</b><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--text-light);margin-top:5px;">Похоже на: '+esc(d.m.name)+' ('+esc(d.m.article||'без артикула')+') <button class="btn btn-warning" type="button" data-stock-merge-source="'+esc(d.p.id)+'" data-stock-merge-target="'+esc(d.m.id)+'">Объединить</button></div></div>';});
      }
      html+='</div>';
      html+='<div class="card"><h3>Остатки по магазинам</h3><div style="overflow-x:auto;"><table style="width:100%;min-width:480px;"><thead><tr><th>Товар</th><th>Магазин</th><th>Остаток</th><th></th></tr></thead><tbody>';
      allProducts().filter(function(p){return p.status==='active';}).forEach(function(p){visibleStoreIds().forEach(function(s){html+='<tr><td>'+esc(p.name)+'</td><td>'+esc(window.STORES[s]||s)+'</td><td>'+qty(p.id,s)+'</td><td><button class="btn btn-secondary" type="button" onclick="stockAdjust(\''+esc(p.id)+'\',\''+esc(s)+'\')">Изменить</button></td></tr>';});});
      html+='</tbody></table></div></div>';
      var recent=Object.keys(movements).map(function(k){return movements[k];}).filter(function(m){return m && m.org===org() && visibleStoreIds().indexOf(String(m.storeId))!==-1;}).sort(function(a,b){return Number(b.createdAt||0)-Number(a.createdAt||0);}).slice(0,100);
      html+='<div class="card"><h3>История складских операций</h3><div style="overflow-x:auto;"><table style="width:100%;min-width:620px;"><thead><tr><th>Дата</th><th>Товар</th><th>Магазин</th><th>Операция</th><th>Изменение</th><th>Остаток после</th></tr></thead><tbody>';
      recent.forEach(function(m){var prod=products[m.productId]||{};var label=m.type==='receipt'?'Поступление':m.type==='writeoff'?'Списание':m.type==='merge'?'Объединение':'Корректировка';html+='<tr><td>'+esc(new Date(Number(m.createdAt||0)).toLocaleString('ru-RU'))+'</td><td>'+esc(prod.name||m.productId||'—')+'</td><td>'+esc(window.STORES[m.storeId]||m.storeId||'—')+'</td><td>'+label+'</td><td>'+(Number(m.quantityDelta)>0?'+':'')+Number(m.quantityDelta||0)+'</td><td>'+(m.after==null?'—':Number(m.after))+'</td></tr>';});
      if(!recent.length) html+='<tr><td colspan="6" style="color:var(--text-light);">Операций пока нет.</td></tr>';
      html+='</tbody></table></div></div>';
    }
    root.innerHTML=html;
    var dupToggle=root.querySelector('#stockDuplicatesToggle');
    if(dupToggle) dupToggle.addEventListener('click',function(){duplicatesExpanded=!duplicatesExpanded;render();});
    root.querySelectorAll('[data-stock-restore]').forEach(function(b){b.addEventListener('click',function(){restore(b.getAttribute('data-stock-restore'));});});
    root.querySelectorAll('[data-stock-merge-source]').forEach(function(b){b.addEventListener('click',function(){merge(b.getAttribute('data-stock-merge-source'),b.getAttribute('data-stock-merge-target'));});});
  }
  function openForm(id){
    if(!canUse()){alert('Нет подтверждённого подключения к Firebase.');return;}
    var p=id?products[id]:null;
    if(p && !canEditCard(p)){alert('Эту карточку нельзя редактировать.');return;}
    editingId=id||'';
    formSizes=p&&Array.isArray(p.sizes)?p.sizes.map(String):(p&&p.size?[String(p.size)]:[]);
    var combinedName=p?[p.name,p.model].filter(Boolean).join(' '):'';
    var html='<div id="stockModal" style="position:fixed;inset:0;background:rgba(20,10,16,.55);z-index:1000;display:flex;align-items:center;justify-content:center;padding:14px;"><div class="card" style="width:min(620px,100%);max-height:90vh;overflow:auto;"><div style="display:flex;justify-content:space-between;gap:10px;"><h3>'+(p?'Редактирование карточки':'Новая карточка товара')+'</h3><button class="btn btn-secondary" onclick="stockCloseForm()">✕</button></div><div class="form-group"><label>Название товара / бренд / модель *</label><input id="stockName" value="'+esc(combinedName)+'" maxlength="180" placeholder="Например: Nike Air Max 90"></div><div class="form-group"><label>Категория</label><input id="stockCategory" value="'+esc(p&&p.category)+'" placeholder="Например: кроссовки, футболка"></div><div class="form-group"><label>Артикул</label><input id="stockArticle" value="'+esc(p&&p.article)+'" placeholder="Будет создан автоматически" '+(isSeller()?'readonly':'')+'></div><div class="form-group"><label>Цвет</label><input id="stockColor" value="'+esc(p&&p.color)+'"></div><div class="form-group"><label>Размеры</label><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;"><button class="btn btn-secondary" type="button" data-size-mode="numeric" aria-pressed="true">Цифры 26–54</button><button class="btn btn-secondary" type="button" data-size-mode="letters" aria-pressed="false">Буквы</button></div><div id="stockSizeGrid" style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px;"></div><div style="font-size:12px;color:var(--text-light);margin-top:8px;">Нажмите на размер — каждое нажатие добавляет ещё одну штуку. Повторные размеры учитываются отдельно.</div><div id="stockSelectedSizes" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;"></div></div><div class="form-group"><label>Описание</label><textarea id="stockDescription" rows="3">'+esc(p&&p.description)+'</textarea></div><div class="form-group"><label>Фото (необязательно)</label><input id="stockPhoto" type="file" accept="image/*"><div style="font-size:12px;color:var(--text-light);">'+(p&&p.photoUrl?'Фото уже прикреплено. Выберите файл, чтобы заменить.':'Можно добавить позже.')+'</div>'+(p&&p.photoUrl?'<label style="display:block;margin-top:6px;"><input id="stockRemovePhoto" type="checkbox"> Удалить текущее фото</label>':'')+'</div>';
    if(isAdmin()) html+='<div class="form-group"><label>Направление</label><select id="stockDirection"><option value="">Выбрать…</option><option value="krossy" '+(p&&p.direction==='krossy'?'selected':'')+'>Кроссы</option><option value="easy" '+(p&&p.direction==='easy'?'selected':'')+'>Изи</option></select></div>';
    html+='<div id="stockSaveError" style="color:#b42318;font-size:13px;margin:8px 0;"></div><div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;"><button class="btn btn-secondary" onclick="stockCloseForm()">Отмена</button><button class="btn btn-primary" onclick="stockSave()">Сохранить</button></div></div></div>';
    document.body.insertAdjacentHTML('beforeend',html);
    var grid=document.getElementById('stockSizeGrid'), selected=document.getElementById('stockSelectedSizes');
    var sizeMode='numeric', letters=['XXS','XS','S','M','L','XL','2XL','3XL','4XL','5XL'];
    function currentSizes(){return sizeMode==='numeric'?Array.from({length:29},function(_,i){return String(i+26);}):letters.slice();}
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
        var minus=document.createElement('button');minus.type='button';minus.textContent='−';minus.title='Уменьшить количество';minus.style.cssText='border:0;background:transparent;font-size:18px;cursor:pointer;padding:0 3px;';
        minus.addEventListener('click',function(){var i=formSizes.indexOf(v);if(i>=0)formSizes.splice(i,1);drawSizes();});
        var plus=document.createElement('button');plus.type='button';plus.textContent='+';plus.title='Увеличить количество';plus.style.cssText='border:0;background:transparent;font-size:17px;cursor:pointer;padding:0 3px;';
        plus.addEventListener('click',function(){formSizes.push(v);drawSizes();});
        chip.appendChild(minus);chip.appendChild(plus);selected.appendChild(chip);
      });
      if(!formSizes.length)selected.textContent='Размеры пока не добавлены';
    }
    document.querySelectorAll('[data-size-mode]').forEach(function(button){button.addEventListener('click',function(){sizeMode=button.getAttribute('data-size-mode');drawSizes();});});
    drawSizes();
  }
  function closeForm(){var el=document.getElementById('stockModal');if(el)el.remove();}
  function save(){
    if(!canUse()) {alert('Нет подтверждённого подключения к Firebase.');return;}
    var name=(document.getElementById('stockName').value||'').trim(); if(!name){alert('Введите название товара, бренд или модель.');return;}
    var old=editingId?products[editingId]:null;
    var id=editingId||uid('sp');
    var record=Object.assign({},old||{},{
      id:id,org:old?old.org:org(),name:name,
      category:(document.getElementById('stockCategory').value||'').trim(),
      article:(document.getElementById('stockArticle').value||'').trim() || (old&&old.article) || ('ST-'+Date.now().toString(36).toUpperCase()),
      model:'',
      color:(document.getElementById('stockColor').value||'').trim(),
      size:formSizes.length?formSizes[0]:'',sizes:formSizes.slice(),
      description:(document.getElementById('stockDescription').value||'').trim(),
      status:old?old.status:'pending',
      createdAt:old?old.createdAt:Date.now(),
      createdById:old?old.createdById:String(user().id),
      createdByName:old?old.createdByName:(user().name||user().username||''),
      updatedAt:Date.now(),updatedById:String(user().id)
    });
    if(isAdmin()){
      var d=document.getElementById('stockDirection');
      if(d && d.value) record.direction=d.value;
    }
    if(isAdmin() && old && old.status==='pending' && record.direction) record.status='active';
    var removePhoto=document.getElementById('stockRemovePhoto'); if(removePhoto && removePhoto.checked){delete record.photoUrl;delete record.photoPath;}
    var file=document.getElementById('stockPhoto').files[0];
    var saveRecord=function(){
      var saveButton=document.querySelector('#stockModal button.btn-primary'); if(saveButton){saveButton.disabled=true;saveButton.textContent='Сохраняем…';}
      db.ref(PRODUCTS_PATH+'/'+id).set(record).then(function(){
        products[id]=record; if(old && old.photoPath && old.photoPath!==record.photoPath && firebase.storage){firebase.storage().ref(old.photoPath).delete().catch(function(){});} closeForm(); addAuditSafe(old?'stock_product_edit':'stock_product_create',(old?'Изменена':'Создана')+' карточка склада: '+record.name); render();
      }).catch(function(e){console.error('Stock card save failed:',e);if(saveButton){saveButton.disabled=false;saveButton.textContent='Сохранить';}var msg='Не удалось сохранить карточку: '+(e&&e.message?e.message:String(e));var status=document.getElementById('stockSaveError');if(status)status.textContent=msg;else alert(msg);});
    };
    if(file){
      if(!window.firebase || !firebase.storage){alert('Хранилище фотографий ещё не подключено. Карточку можно сохранить без фото и добавить фото позже.');return;}
      if(file.size>8*1024*1024){alert('Фото должно быть не больше 8 МБ.');return;}
      var path='stock-products/'+record.org+'/'+id+'/'+Date.now()+'_'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
      firebase.storage().ref(path).put(file).then(function(s){return s.ref.getDownloadURL();}).then(function(url){record.photoUrl=url;record.photoPath=path;saveRecord();}).catch(function(e){console.error(e);alert('Фото не загрузилось. Попробуйте ещё раз или сохраните карточку без фото.');});
    } else { try { saveRecord(); } catch(e) { console.error('Stock save exception:',e); alert('Ошибка сохранения: '+(e.message||e)); } }
  }
  function review(id){
    if(!isAdmin() || !canUse())return;
    var p=products[id]; if(!p || p.status!=='pending')return;
    var d=prompt('Направление карточки: введите «Кроссы» или «Изи».','Кроссы'); if(!d)return;
    var direction=/^крос/i.test(d.trim())?'krossy':/^изи/i.test(d.trim())?'easy':'';
    if(!direction){alert('Введите «Кроссы» или «Изи».');return;}
    var dup=possibleDuplicates(p,id);
    if(dup.length && !confirm('Найдены возможные совпадения: '+dup.map(function(x){return x.name;}).join(', ')+'. Всё равно опубликовать отдельную карточку?'))return;
    db.ref(PRODUCTS_PATH+'/'+id).update({direction:direction,status:'active',reviewedAt:Date.now(),reviewedById:String(user().id),updatedAt:Date.now()}).then(function(){addAuditSafe('stock_product_approve','Проверена и опубликована карточка: '+p.name+' ('+direction+')');});
  }
  function adjust(id,sid){
    if(!isAdmin() || !canUse())return;
    var p=products[id]; if(!p)return;
    var store=sid||prompt('Введите ID магазина для корректировки остатка:\n'+visibleStoreIds().map(function(k){return k+': '+(STORES[k]||k);}).join('\n'),visibleStoreIds()[0]||'');
    if(!store || visibleStoreIds().indexOf(String(store))<0)return;
    var before=qty(id,store), kind=prompt('Тип операции: поступление, списание или корректировка.','поступление');
    if(kind===null)return;
    kind=norm(kind); var type=/^пост/.test(kind)?'receipt':/^спис/.test(kind)?'writeoff':/^кор/.test(kind)?'adjustment':'';
    if(!type){alert('Введите: поступление, списание или корректировка.');return;}
    var raw=prompt('Текущий остаток: '+before+'. Введите '+(type==='adjustment'?'новое количество':'количество операции')+':',type==='adjustment'?String(before):'1');
    if(raw===null)return; var amount=Number(raw); if(!Number.isInteger(amount)||amount<0 || (type!=='adjustment'&&amount<1)){alert('Введите целое количество. Для поступления и списания минимум 1.');return;}
    var after=type==='receipt'?before+amount:type==='writeoff'?before-amount:amount; if(after<0){alert('Нельзя списать больше, чем есть на остатке.');return;}
    var delta=after-before, mid=uid('sm'), now=Date.now(), patch={};
    patch[BALANCES_PATH+'/'+store+'/'+id]={quantity:after,updatedAt:now};
    patch[MOVEMENTS_PATH+'/'+mid]={id:mid,org:org(),productId:id,storeId:String(store),type:type,quantityDelta:delta,before:before,after:after,note:type==='receipt'?'Поступление':type==='writeoff'?'Списание':'Корректировка остатка',createdAt:now,createdById:String(user().id),createdByName:user().name||''};
    db.ref().update(patch).then(function(){addAuditSafe('stock_adjustment','Остаток «'+p.name+'» в магазине «'+(STORES[store]||store)+'»: '+before+' → '+after);}).catch(function(e){alert('Не удалось изменить остаток: '+e.message);});
  }
  function restore(id){ if(!isAdmin()||!canUse())return; var p=products[id]; if(!p||p.status!=='archived')return; if(!p.direction){alert('У карточки не назначено направление. Отредактируйте её перед восстановлением.');return;} db.ref(PRODUCTS_PATH+'/'+id).update({status:'active',restoredAt:Date.now(),restoredById:String(user().id)}).then(function(){addAuditSafe('stock_product_restore','Восстановлена карточка: '+p.name);}); }
  function archive(id){
    if(!isAdmin()||!canUse())return; var p=products[id];if(!p||!confirm('Переместить карточку «'+p.name+'» в архив? Остатки и история сохранятся.'))return;
    db.ref(PRODUCTS_PATH+'/'+id).update({status:'archived',archivedAt:Date.now(),archivedById:String(user().id)}).then(function(){addAuditSafe('stock_product_archive','В архив: '+p.name);});
  }
  function merge(id,targetId){
    if(!isAdmin()||!canUse())return;
    var sourceId=id, keepId=targetId, a=products[sourceId], b=products[keepId];
    if(!a||!b||sourceId===keepId)return;
    if(a.status==='active' && b.status==='pending'){var swap=a;a=b;b=swap;var swapId=sourceId;sourceId=keepId;keepId=swapId;}
    if(a.org!==b.org || (a.direction && b.direction && a.direction!==b.direction)){alert('Объединять можно только карточки одной организации и совместимого направления.');return;}
    if(!confirm('Объединить «'+a.name+'» с карточкой «'+b.name+'»? Остатки будут перенесены в основную карточку, исходная останется в истории как объединённая.'))return;
    var patch={}, now=Date.now();
    visibleStoreIds().forEach(function(s){var qa=qty(sourceId,s),qb=qty(keepId,s);if(qa){patch[BALANCES_PATH+'/'+s+'/'+keepId]={quantity:qa+qb,updatedAt:now};patch[BALANCES_PATH+'/'+s+'/'+sourceId]=null;}});
    var mid=uid('sm');
    patch[MOVEMENTS_PATH+'/'+mid]={id:mid,org:org(),productId:keepId,mergedProductId:sourceId,type:'merge',createdAt:now,createdById:String(user().id),note:'Объединение карточки «'+a.name+'» с «'+b.name+'»'};
    patch[PRODUCTS_PATH+'/'+sourceId+'/status']='merged';
    patch[PRODUCTS_PATH+'/'+sourceId+'/direction']=b.direction || a.direction || null;
    patch[PRODUCTS_PATH+'/'+sourceId+'/mergedInto']=keepId;
    patch[PRODUCTS_PATH+'/'+sourceId+'/mergedAt']=now;
    db.ref().update(patch).then(function(){addAuditSafe('stock_product_merge','Объединены карточки «'+a.name+'» → «'+b.name+'»');}).catch(function(e){alert('Не удалось объединить карточки: '+e.message);});
  }
  function openMergeDialog(id,targetId){merge(id,targetId);}
  function setSearch(v){searchText=v||'';render();}
  function setFilter(v){activeFilter=v||'all';render();}
  function expose(){
    window.stockOpenForm=openForm;window.stockCloseForm=closeForm;window.stockSave=save;window.stockReview=review;
    window.stockAdjust=adjust;window.stockArchive=archive;window.stockRestore=restore;window.stockMerge=merge;window.stockSetSearch=setSearch;window.stockSetFilter=setFilter;
  }
  function augmentStores(){
    if(!isAdmin() || !document.getElementById('storesManagement'))return;
    var host=document.getElementById('storesManagement');
    if(host.querySelector('#stockStoreDirections'))return;
    var box=document.createElement('div');box.id='stockStoreDirections';box.className='card';
    var html='<h3>Направление магазина</h3><p style="font-size:12px;color:var(--text-light);">Настройка доступна администратору. Продавцы это поле не видят.</p>';
    visibleStoreIds().forEach(function(k){var v=storeDirection(k);html+='<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--border);"><b style="flex:1;min-width:130px;">'+esc(STORES[k]||k)+'</b><select data-stock-store="'+esc(k)+'"><option value="">Не настроено</option><option value="krossy" '+(v==='krossy'?'selected':'')+'>Кроссы</option><option value="easy" '+(v==='easy'?'selected':'')+'>Изи</option><option value="mixed" '+(v==='mixed'?'selected':'')+'>Смешанный</option></select><button class="btn btn-secondary" type="button" data-stock-save-store="'+esc(k)+'">Сохранить</button></div>';});
    box.innerHTML=html;host.appendChild(box);
    box.querySelectorAll('[data-stock-save-store]').forEach(function(b){b.addEventListener('click',function(){var k=b.getAttribute('data-stock-save-store'),sel=box.querySelector('[data-stock-store="'+k+'"]');if(!sel.value){alert('Выберите направление магазина.');return;}db.ref(DIRECTIONS_PATH+'/'+k).set(sel.value).then(function(){storeDirections[k]=sel.value;addAuditSafe('stock_store_direction','Изменено направление магазина «'+(STORES[k]||k)+'»: '+sel.value);render();});});});
  }
  function watchStorePage(){
    if(typeof window.renderStoresManagement!=='function'||window.renderStoresManagement._stockWrapped)return;
    var original=window.renderStoresManagement;
    var wrapped=function(){original.apply(this,arguments);augmentStores();};
    wrapped._stockWrapped=true;window.renderStoresManagement=wrapped;
  }
  function start(){
    expose();load();initPage();watchStorePage();
    if(typeof window.switchOrg==='function' && !window.switchOrg._stockWrapped){
      var originalSwitchOrg=window.switchOrg;
      var wrappedSwitchOrg=function(key){var result=originalSwitchOrg.apply(this,arguments);render();return result;};
      wrappedSwitchOrg._stockWrapped=true;window.switchOrg=wrappedSwitchOrg;
    }
    var originalShow=window.easyAppSyncShowPage;
    if(typeof originalShow==='function'&&!originalShow._stockWrapped){
      var wrapped=function(id){if(id==='stock'){show();return;}return originalShow.apply(this,arguments);};
      wrapped._stockWrapped=true;window.easyAppSyncShowPage=wrapped;
    }
    // Avoid observing stockRoot mutations: render() updates innerHTML and would retrigger itself.
    if(user())render();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
