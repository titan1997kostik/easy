(function () {
  'use strict';

  var rootId = 'businessAdvisorRoot';
  var initialized = false;

  function el(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch];
    });
  }
  function num(value) {
    var n = Number(value);
    return isFinite(n) ? n : 0;
  }
  function money(value) {
    return num(value).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
  }
  function pct(value) {
    return (num(value) * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '%';
  }
  function dateString(date) {
    if (typeof window.getLocalDateString === 'function') return window.getLocalDateString(date);
    var d = date instanceof Date ? date : new Date(date);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function recordDate(record) {
    var value = record && (record.timestamp || record.createdAt || record.date);
    if (!value) return '';
    if (typeof window.getRecordDateString === 'function') return window.getRecordDateString(value);
    return String(value).slice(0, 10);
  }
  function getBounds(days) {
    var today = new Date();
    var end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
    var start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days + 1);
    var previousEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1, 23, 59, 59, 999);
    var previousStart = new Date(previousEnd.getFullYear(), previousEnd.getMonth(), previousEnd.getDate() - days + 1);
    return {
      start: dateString(start), end: dateString(end),
      previousStart: dateString(previousStart), previousEnd: dateString(previousEnd),
      days: days
    };
  }
  function inRange(record, start, end) {
    var day = recordDate(record);
    return !!day && day >= start && day <= end;
  }
  function storeLabel(id) {
    var stores = window.STORES || {};
    return stores[String(id)] || ('Магазин ' + String(id));
  }
  function getVisibleStores() {
    try {
      return typeof window.getVisibleStoreKeys === 'function' ? window.getVisibleStoreKeys().map(String) : [];
    } catch (error) { return []; }
  }
  function buildMarkup(page) {
    if (!page || el(rootId)) return;
    var section = document.createElement('section');
    section.id = rootId;
    section.className = 'business-advisor-module';
    section.style.marginTop = '18px';
    section.innerHTML =
      '<section class="card" style="padding:20px;">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;">' +
          '<div style="min-width:0;flex:1;">' +
            '<div style="display:flex;align-items:center;gap:9px;margin-bottom:6px;">' +
              '<span aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:12px;background:#fce7ef;font-size:22px;">✦</span>' +
              '<div><h3 style="margin:0;border:0;padding:0;">Умные рекомендации по бизнесу</h3><p style="font-size:13px;color:var(--text-light);margin:3px 0 0;">Анализ данных Easy и конкретные действия для управления магазинами.</p></div>' +
            '</div>' +
          '</div>' +
          '<span style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;background:#f4f4f5;color:#575569;font-size:11px;font-weight:700;">РАСЧЁТЫ ВНУТРИ EASY · БЕЗ API</span>' +
        '</div>' +
        '<div class="business-advisor-filters" style="display:flex;align-items:end;gap:10px;flex-wrap:wrap;margin-top:18px;">' +
          '<div class="form-group" style="margin:0;flex:1;min-width:150px;"><label for="businessAdvisorPeriod">Период анализа</label><select id="businessAdvisorPeriod"><option value="7">Последние 7 дней</option><option value="30" selected>Последние 30 дней</option><option value="90">Последние 90 дней</option></select></div>' +
          '<div class="form-group" style="margin:0;flex:1;min-width:170px;"><label for="businessAdvisorStore">Магазин</label><select id="businessAdvisorStore"><option value="all">Все доступные магазины</option></select></div>' +
          '<button type="button" class="btn btn-secondary" id="businessAdvisorRefresh">↻ Пересчитать</button>' +
        '</div>' +
        '<p id="businessAdvisorPeriodLabel" style="font-size:12px;color:var(--text-light);margin:10px 0 14px;"></p>' +
        '<div id="businessAdvisorMetrics" class="business-advisor-metrics" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:16px;"></div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:12px 0;">' +
          '<h3 style="margin:0;border:0;padding:0;">Что требует внимания</h3><span id="businessAdvisorStatus" role="status" aria-live="polite" style="font-size:12px;color:var(--text-light);"></span>' +
        '</div>' +
        '<div id="businessAdvisorRecommendations" style="display:flex;flex-direction:column;gap:10px;"><div style="padding:16px;color:var(--text-light);">Подготавливаем рекомендации…</div></div>' +
        '<div id="businessAdvisorSources" style="margin-top:13px;padding-top:11px;border-top:1px solid var(--border);font-size:11px;color:var(--text-light);line-height:1.55;"></div>' +
      '</section>' +
      '<section class="card" style="padding:18px;">' +
        '<div style="display:flex;align-items:center;gap:9px;margin-bottom:7px;"><span aria-hidden="true" style="font-size:22px;">✓</span><h3 style="margin:0;border:0;padding:0;">Как работает помощник</h3><span style="margin-left:auto;padding:4px 8px;border-radius:999px;background:#eef8f1;color:#28764d;font-size:10px;font-weight:700;">БЕЗ ПЛАТНЫХ API</span></div>' +
        '<p style="font-size:13px;color:var(--text-light);line-height:1.6;margin:0;">Рекомендации выше рассчитываются самим приложением Easy по вашим продажам, возвратам, расходам и складским данным. Подключать внешний ИИ, вводить API-ключ или оплачивать запросы не нужно. Диалог с ИИ можно добавить отдельно позднее, но для работы этого блока он не требуется.</p>' +
      '</section>';
    page.appendChild(section);
    if (!initialized) {
      var period = el('businessAdvisorPeriod');
      var store = el('businessAdvisorStore');
      var refresh = el('businessAdvisorRefresh');
      if (period) period.addEventListener('change', render);
      if (store) store.addEventListener('change', render);
      if (refresh) refresh.addEventListener('click', render);
      section.addEventListener('click', function (event) {
        var button = event.target.closest('[data-advisor-page]');
        if (!button) return;
        var target = button.getAttribute('data-advisor-page');
        if (target && typeof window.easyAppSyncShowPage === 'function') window.easyAppSyncShowPage(target);
      });
      initialized = true;
    }
  }
  function fillStoreOptions(selected) {
    var select = el('businessAdvisorStore');
    if (!select) return 'all';
    var visible = getVisibleStores();
    var previous = selected || select.value || 'all';
    var html = '<option value="all">Все доступные магазины</option>';
    visible.forEach(function (id) {
      html += '<option value="' + esc(id) + '">' + esc(storeLabel(id)) + '</option>';
    });
    select.innerHTML = html;
    select.value = previous === 'all' || visible.indexOf(String(previous)) !== -1 ? String(previous) : 'all';
    return select.value;
  }
  function aggregateSales(rows, bounds) {
    var result = { revenue:0, returnedRevenue:0, netRevenue:0, checks:0, returnedChecks:0, products:{}, stores:{} };
    (rows || []).forEach(function (sale) {
      if (!inRange(sale, bounds.start, bounds.end)) return;
      var price = Math.max(0, num(sale.price));
      result.revenue += price;
      result.checks++;
      var returned = sale.returned === true;
      if (returned) {
        result.returnedRevenue += price;
        result.returnedChecks++;
      } else {
        result.netRevenue += price;
      }
      var productName = String(sale.productName || sale.catalogProductName || sale.name || 'Без названия').trim() || 'Без названия';
      var productKey = String(sale.productId || productName);
      if (!result.products[productKey]) result.products[productKey] = { name:productName, revenue:0, checks:0 };
      if (!returned) {
        result.products[productKey].revenue += price;
        result.products[productKey].checks++;
      }
      var sid = String(sale.storeId || '');
      if (!result.stores[sid]) result.stores[sid] = { revenue:0, checks:0 };
      if (!returned) {
        result.stores[sid].revenue += price;
        result.stores[sid].checks++;
      }
    });
    result.averageCheck = result.checks - result.returnedChecks > 0
      ? result.netRevenue / (result.checks - result.returnedChecks) : 0;
    result.returnRate = result.checks > 0 ? result.returnedChecks / result.checks : 0;
    return result;
  }
  function aggregateExpenses(rows, bounds) {
    var result = { amount:0, count:0 };
    (rows || []).forEach(function (expense) {
      if (!inRange(expense, bounds.start, bounds.end)) return;
      var amount = num(expense.amount);
      if (amount <= 0) return;
      result.amount += amount;
      result.count++;
    });
    return result;
  }
  function changePercent(current, previous) {
    if (previous > 0) return (current - previous) / previous;
    return null;
  }
  function metricCard(label, value, note) {
    return '<div style="background:#fff;border:1px solid var(--border);border-radius:12px;padding:13px;min-width:0;">' +
      '<div style="font-size:11px;color:var(--text-light);font-weight:650;margin-bottom:6px;">' + esc(label) + '</div>' +
      '<div style="font-size:clamp(18px,2vw,24px);font-weight:800;line-height:1.25;overflow-wrap:anywhere;">' + esc(value) + '</div>' +
      '<div style="font-size:10px;color:var(--text-light);margin-top:5px;line-height:1.4;">' + esc(note) + '</div></div>';
  }
  function recommendation(level, icon, title, text, reason, page) {
    return {
      level:level, icon:icon, title:title, text:text, reason:reason, page:page || ''
    };
  }
  function recommendationMarkup(item) {
    var color = item.level === 'danger' ? '#b3263b' : item.level === 'warning' ? '#9a6414' : item.level === 'success' ? '#28764d' : '#6b6070';
    var background = item.level === 'danger' ? '#fff0f1' : item.level === 'warning' ? '#fff8e9' : item.level === 'success' ? '#effaf3' : '#f8f5f7';
    var action = item.page ? '<button type="button" class="btn btn-secondary" data-advisor-page="' + esc(item.page) + '" style="margin-top:10px;padding:7px 11px;font-size:12px;">Перейти к данным →</button>' : '';
    return '<article style="border:1px solid var(--border);border-radius:13px;padding:14px;background:#fff;">' +
      '<div style="display:flex;align-items:flex-start;gap:11px;">' +
        '<span aria-hidden="true" style="flex:0 0 34px;width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:' + background + ';color:' + color + ';font-size:18px;">' + esc(item.icon) + '</span>' +
        '<div style="min-width:0;flex:1;"><div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:5px;"><strong style="font-size:14px;">' + esc(item.title) + '</strong><span style="font-size:10px;font-weight:750;letter-spacing:.3px;color:' + color + ';">' + (item.level === 'danger' ? 'ВАЖНО' : item.level === 'warning' ? 'ВНИМАНИЕ' : item.level === 'success' ? 'ВОЗМОЖНОСТЬ' : 'НАБЛЮДЕНИЕ') + '</span></div>' +
          '<p style="font-size:13px;line-height:1.55;margin:0 0 6px;">' + esc(item.text) + '</p>' +
          '<p style="font-size:11px;line-height:1.5;color:var(--text-light);margin:0;"><strong>Основание:</strong> ' + esc(item.reason) + '</p>' + action +
        '</div></div></article>';
  }
  function render() {
    var page = el('workspacePage-analytics');
    if (!page || !window.currentUser || window.currentUser.role !== 'admin') return;
    buildMarkup(page);
    var days = Number(el('businessAdvisorPeriod') && el('businessAdvisorPeriod').value) || 30;
    if ([7,30,90].indexOf(days) === -1) days = 30;
    var selectedStore = fillStoreOptions(el('businessAdvisorStore') && el('businessAdvisorStore').value || 'all');
    var bounds = getBounds(days);
    var visibleKeys = getVisibleStores();
    if (!visibleKeys.length || typeof window.getAnalyticsScopedData !== 'function') {
      el('businessAdvisorMetrics').innerHTML = metricCard('Продажи', '—', 'Нет доступа к аналитическим данным');
      el('businessAdvisorRecommendations').innerHTML = '<div style="padding:16px;color:var(--text-light);">Данные магазинов пока недоступны. Проверьте подключение и права доступа.</div>';
      return;
    }
    var scope = window.getAnalyticsScopedData(selectedStore, visibleKeys);
    var currentSales = aggregateSales(scope.sales || [], bounds);
    var previousBounds = { start:bounds.previousStart, end:bounds.previousEnd };
    var previousSales = aggregateSales(scope.sales || [], previousBounds);
    var currentExpenses = aggregateExpenses(scope.expenses || [], bounds);
    var previousExpenses = aggregateExpenses(scope.expenses || [], previousBounds);
    var salesChange = changePercent(currentSales.netRevenue, previousSales.netRevenue);
    var expenseChange = changePercent(currentExpenses.amount, previousExpenses.amount);
    var recommendations = [];
    var nonReturnedChecks = currentSales.checks - currentSales.returnedChecks;
    if (currentSales.checks === 0) {
      recommendations.push(recommendation('info','ℹ','Пока недостаточно продаж для анализа','За выбранный период не найдено продаж в доступных данных. Когда появятся записи, здесь будут динамика выручки, возвраты и сравнение магазинов.','Продажи за период ' + bounds.start.split('-').reverse().join('.') + ' — ' + bounds.end.split('-').reverse().join('.') + '; доступных магазинов: ' + visibleKeys.length + '.','sales'));
    } else if (salesChange !== null && salesChange <= -0.15 && previousSales.checks >= 3 && currentSales.checks >= 3) {
      recommendations.push(recommendation('danger','↘','Выручка снизилась','Чистая выручка за выбранный период уменьшилась на ' + pct(Math.abs(salesChange)) + ' по сравнению с предыдущим равным периодом. Проверьте, в каких магазинах и товарных группах падение сильнее всего.','Текущий период: ' + money(currentSales.netRevenue) + '; предыдущий: ' + money(previousSales.netRevenue) + '; сравнение по ' + currentSales.checks + ' и ' + previousSales.checks + ' продажам.','analytics'));
    } else if (salesChange !== null && salesChange >= 0.15 && currentSales.checks >= 3 && previousSales.checks >= 3) {
      recommendations.push(recommendation('success','↗','Выручка растёт','Чистая выручка выросла на ' + pct(salesChange) + ' к предыдущему равному периоду. Сравните остатки и наличие лидирующих товаров, чтобы не потерять темп продаж.','Текущий период: ' + money(currentSales.netRevenue) + '; предыдущий: ' + money(previousSales.netRevenue) + '.','purchase'));
    } else {
      recommendations.push(recommendation('info','◷','Выручка без резких изменений','По сравнению с предыдущим равным периодом изменение чистой выручки не достигло порога ±15%. Следите за динамикой и средним чеком.','Текущий период: ' + money(currentSales.netRevenue) + '; предыдущий: ' + money(previousSales.netRevenue) + '; изменение: ' + (salesChange === null ? 'нет базы для сравнения' : pct(salesChange)) + '.','analytics'));
    }
    if (currentSales.checks >= 10 && currentSales.returnRate >= 0.1) {
      recommendations.push(recommendation('warning','↩','Повышенная доля возвратов','Возвраты составляют ' + pct(currentSales.returnRate) + ' от количества продаж. Проверьте причины возвратов, размеры, качество товара и работу с ожиданиями покупателей.','Возвращено ' + currentSales.returnedChecks + ' из ' + currentSales.checks + ' продаж на сумму ' + money(currentSales.returnedRevenue) + '.','sales'));
    }
    if (currentExpenses.count >= 2 && previousExpenses.count >= 2 && expenseChange !== null && expenseChange >= 0.2 && (currentExpenses.amount - previousExpenses.amount) >= 1000) {
      recommendations.push(recommendation('warning','₽','Расходы растут быстрее обычного','Записанные расходы увеличились на ' + pct(expenseChange) + ' относительно предыдущего периода. Проверьте крупные статьи и повторяющиеся платежи до следующего планирования бюджета.','Текущий период: ' + money(currentExpenses.amount) + ' (' + currentExpenses.count + ' записей); предыдущий: ' + money(previousExpenses.amount) + ' (' + previousExpenses.count + ' записей).','expenses'));
    }
    var storeRows = Object.keys(currentSales.stores).map(function (id) {
      return { id:id, name:storeLabel(id), revenue:currentSales.stores[id].revenue, checks:currentSales.stores[id].checks };
    }).filter(function (item) { return item.checks >= 3; });
    if (selectedStore === 'all' && storeRows.length >= 2) {
      storeRows.sort(function (a,b) { return a.revenue - b.revenue; });
      var weakest = storeRows[0], strongest = storeRows[storeRows.length - 1];
      if (strongest.revenue > 0 && weakest.revenue / strongest.revenue <= 0.55) {
        recommendations.push(recommendation('warning','⌂','Большая разница между магазинами','В магазине «' + weakest.name + '» выручка заметно ниже, чем в «' + strongest.name + '». Сравните ассортимент, наличие ходовых размеров, график смен и поток покупателей.','' + weakest.name + ': ' + money(weakest.revenue) + ' (' + weakest.checks + ' продаж); ' + strongest.name + ': ' + money(strongest.revenue) + ' (' + strongest.checks + ' продаж).','analytics'));
      }
    }
    var productRows = Object.keys(currentSales.products).map(function (key) { return currentSales.products[key]; }).sort(function (a,b) { return b.revenue - a.revenue; });
    if (productRows.length && currentSales.netRevenue > 0 && productRows[0].checks >= 5) {
      var productShare = productRows[0].revenue / currentSales.netRevenue;
      if (productShare >= 0.4) {
        recommendations.push(recommendation('info','★','Продажи зависят от одного товара','Товар «' + productRows[0].name + '» формирует ' + pct(productShare) + ' чистой выручки. Проверьте запас этого товара и подумайте, какие похожие позиции могут дополнить ассортимент.','Продажи товара: ' + money(productRows[0].revenue) + '; чистая выручка: ' + money(currentSales.netRevenue) + '; продаж товара: ' + productRows[0].checks + '.','purchase'));
      }
    }
    var stockResult = null;
    if (typeof window.stockGetReplenishmentRecommendations === 'function') {
      try { stockResult = window.stockGetReplenishmentRecommendations('', '', selectedStore, 14); } catch (stockError) { stockResult = null; }
    }
    if (stockResult && stockResult.ready) {
      var stockRisk = (stockResult.rows || []).filter(function (row) {
        return row && (row.priorityStatus === 'urgent' || row.priorityStatus === 'soon') &&
          (num(row.soldUnits) > 0 || num(row.currentStock) <= 0);
      });
      var urgentCount = stockRisk.filter(function (row) { return row.priorityStatus === 'urgent'; }).length;
      if (urgentCount > 0) {
        var sample = stockRisk.slice(0,3).map(function (row) { return row.productName + ' — ' + row.storeName + ', остаток ' + num(row.currentStock) + ' шт.'; }).join('; ');
        recommendations.push(recommendation('danger','📦','Есть риск дефицита товара',urgentCount + ' позиций имеют срочный статус по складскому алгоритму. Проверьте их остатки и план пополнения, особенно если эти товары продолжают продаваться.','Складской расчёт использует историю движений, текущие остатки и продажи; примеры: ' + (sample || 'см. план закупки') + '.','purchase'));
      } else if (stockRisk.length > 0) {
        recommendations.push(recommendation('warning','📦','Часть товаров скоро потребует внимания',stockRisk.length + ' позиций получили статус «скоро» по расчёту остатков. Проверьте, какие из них действительно нужно пополнить.','Расчёт по текущим остаткам и истории спроса; горизонт оценки — 14 дней.','purchase'));
      }
    }
    if (typeof window.countSalesMissingPurchaseCostForVisibleOrg === 'function' && typeof window.isPurchaseCostOwner === 'function' && window.isPurchaseCostOwner()) {
      var missingCosts = window.countSalesMissingPurchaseCostForVisibleOrg();
      if (missingCosts > 0) {
        recommendations.push(recommendation('info','🧾','Не для всех продаж указана себестоимость','Для ' + missingCosts + ' продаж ещё не заполнена закупочная стоимость. Пока она неизвестна, выводы о реальной прибыли и маржинальности могут быть неполными.','Счётчик использует доступные продажи текущей организации, без удалённых записей и записей до сброса магазина.','costs'));
      }
    }
    if (!recommendations.length) {
      recommendations.push(recommendation('success','✓','Критичных сигналов не обнаружено','По доступным данным и выбранному периоду автоматические проверки не нашли резких отклонений. Это не гарантирует отсутствие проблем — регулярно сверяйте продажи, расходы и остатки.','Проверки: динамика выручки, возвраты, записанные расходы, сравнение магазинов, концентрация продаж и складские сигналы.','analytics'));
    }
    var metrics = el('businessAdvisorMetrics');
    if (metrics) {
      metrics.innerHTML =
        metricCard('Чистая выручка', money(currentSales.netRevenue), (salesChange === null ? 'нет базы для сравнения' : (salesChange >= 0 ? '+' : '') + pct(salesChange) + ' к прошлому периоду')) +
        metricCard('Продажи', String(nonReturnedChecks), 'Средний чек: ' + money(currentSales.averageCheck)) +
        metricCard('Возвраты', String(currentSales.returnedChecks), 'Доля от продаж: ' + pct(currentSales.returnRate)) +
        metricCard('Записанные расходы', money(currentExpenses.amount), currentExpenses.count + ' записей за период');
    }
    var periodLabel = el('businessAdvisorPeriodLabel');
    if (periodLabel) periodLabel.textContent = bounds.start.split('-').reverse().join('.') + ' — ' + bounds.end.split('-').reverse().join('.') + ' · сравнение с предыдущими ' + days + ' днями · ' + (selectedStore === 'all' ? 'все доступные магазины' : storeLabel(selectedStore));
    var recHost = el('businessAdvisorRecommendations');
    if (recHost) recHost.innerHTML = recommendations.map(recommendationMarkup).join('');
    var status = el('businessAdvisorStatus');
    if (status) status.textContent = recommendations.length + ' сигналов · по данным Easy';
    var sources = el('businessAdvisorSources');
    if (sources) {
      sources.textContent = 'Учтено: ' + (scope.sales || []).length + ' доступных записей продаж в истории, ' +
        (scope.expenses || []).length + ' записей расходов, ' + visibleKeys.length + ' доступных магазинов. ' +
        'Выводы рассчитываются локально из данных приложения; возвраты вычитаются из чистой выручки. ' +
        'Периодические расходы и полная чистая прибыль пока не включены в этот первый этап.';
    }
  }

  window.renderBusinessAdvisor = render;
})();