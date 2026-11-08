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
      '<div class="business-advisor-filters" style="display:flex;align-items:end;gap:10px;flex-wrap:wrap;margin-bottom:14px;">' +
        '<div class="form-group" style="margin:0;flex:1;min-width:150px;"><label for="businessAdvisorPeriod">Период анализа</label><select id="businessAdvisorPeriod"><option value="7">Последние 7 дней</option><option value="30" selected>Последние 30 дней</option><option value="90">Последние 90 дней</option></select></div>' +
        '<div class="form-group" style="margin:0;flex:1;min-width:170px;"><label for="businessAdvisorStore">Магазин</label><select id="businessAdvisorStore"><option value="all">Все доступные магазины</option></select></div>' +
        '<button type="button" class="btn btn-secondary" id="businessAdvisorRefresh">↻ Пересчитать</button>' +
      '</div>' +
      '<p id="businessAdvisorPeriodLabel" style="font-size:12px;color:var(--text-light);margin:0 0 12px;"></p>' +
      '<section class="card" id="businessAdvisorStoreFinanceCard" style="padding:18px;margin:0 0 14px;">' +
        '<h3 style="margin:0 0 12px;border:0;padding:0;">Сравнение магазинов</h3>' +
        '<div id="businessAdvisorStoreFinance" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:8px;"></div>' +
      '</section>' +
      '<section class="card" id="businessAdvisorBreakEvenCard" style="padding:18px;margin:0;">' +
        '<h3 style="margin:0 0 12px;border:0;padding:0;">ТОЧКИ БЕЗУБЫТОЧНОСТИ</h3>' +
        '<div id="businessAdvisorExpenseAnalysis"></div>' +
      '</section>';
    page.appendChild(section);
    if (!initialized) {
      var period = el('businessAdvisorPeriod');
      var store = el('businessAdvisorStore');
      var refresh = el('businessAdvisorRefresh');
      if (period) period.addEventListener('change', render);
      if (store) store.addEventListener('change', render);
      if (refresh) refresh.addEventListener('click', render);
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
  function getFinancialSummary(start, end, storeId) {
    if (typeof window.getEasyFinancialSummary !== 'function') return null;
    try { return window.getEasyFinancialSummary(start, end, storeId); }
    catch (error) { console.warn('Easy financial summary unavailable:', error); return null; }
  }
  function financialPercent(value) {
    return num(value).toLocaleString('ru-RU', { maximumFractionDigits:1 }) + '%';
  }
  function renderFinancialPanel(storeRows) {
    var storeHost = el('businessAdvisorStoreFinance');
    if (!storeHost) return;
    if (!storeRows || !storeRows.length) {
      storeHost.innerHTML = '<p style="font-size:12px;color:var(--text-light);">Нет доступных магазинов для сравнения.</p>';
      return;
    }
    storeRows.sort(function(a,b) {
      var aReady = a.summary && a.summary.netProfit !== null && a.summary.netProfit !== undefined && a.summary.costCalculationAvailable;
      var bReady = b.summary && b.summary.netProfit !== null && b.summary.netProfit !== undefined && b.summary.costCalculationAvailable;
      if (aReady !== bReady) return aReady ? -1 : 1;
      return aReady ? num(b.summary.netProfit) - num(a.summary.netProfit) : String(a.name).localeCompare(String(b.name), 'ru');
    });
    var storeCards = storeRows.map(function(item) {
      var summary = item.summary;
      var ready = summary && summary.costCalculationAvailable && summary.netProfit !== null && summary.netProfit !== undefined;
      var net = ready ? ((!summary.costDataComplete ? '≈ ' : '') + money(summary.netProfit)) : '—';
      var margin = ready && summary.grossMargin !== null ? financialPercent(summary.grossMargin) : '—';
      var state = !ready ? 'Себестоимость неполная' : summary.costDataComplete ? 'Фактические цены' : 'Есть оценка';
      return '<article style="border:1px solid var(--border);border-radius:10px;padding:10px;background:#fff;min-width:0;">' +
        '<strong style="display:block;font-size:12px;margin-bottom:7px;">' + esc(item.name) + '</strong>' +
        '<div style="font-size:17px;font-weight:800;line-height:1.3;">' + esc(net) + '</div>' +
        '<div style="font-size:10px;color:var(--text-light);margin-top:3px;">Результат до распределения общих расходов · валовая маржа ' + esc(margin) + '</div>' +
        '<div style="font-size:10px;color:var(--text-light);margin-top:5px;">Выручка ' + esc(summary ? money(summary.netRevenue) : '—') + ' · расходы магазина ' + esc(summary ? money(summary.allExpenses) : '—') + '</div>' +
        '<div style="font-size:10px;margin-top:6px;color:' + (ready && summary.costDataComplete ? '#28764d' : '#9a6414') + ';">' + esc(state) + '</div></article>';
    }).join('');
    storeHost.innerHTML = '<p style="grid-column:1/-1;font-size:11px;line-height:1.5;color:var(--text-light);margin:0 0 4px;">Показан результат по расходам, привязанным к каждому магазину. Общие расходы организации не распределяются автоматически, а оценка себестоимости по магазинам может отличаться от общей. Поэтому суммы карточек не обязаны складываться в консолидированную чистую прибыль.</p>' + storeCards;
  }

function renderExpenseAnalysis(current) {
    var host = el('businessAdvisorExpenseAnalysis');
    if (!host) return;
    var details = current && current.expenseDetails;
    if (!current || !details) {
      host.innerHTML = '<p style="font-size:12px;color:var(--text-light);">Точка безубыточности не рассчитана: финансовые данные за выбранный период недоступны.</p>';
      return;
    }
    var ordinary = Math.max(0, num(details.ordinaryTotal));
    var recurring = Math.max(0, num(details.recurringTotal));
    var salary = Math.max(0, num(current.salaryExpenses));
    var taxAndFees = num(current.tax) + num(current.cardFee) + num(current.sbpFee);
    var operatingCostBase = ordinary + recurring + salary;
    var breakEvenHtml = '';
    var canEstimateBreakEven = current.costCalculationAvailable && current.netRevenue > 0 &&
      current.costOfGoods !== null && current.costOfGoods !== undefined;
    if (canEstimateBreakEven) {
      var contribution = current.netRevenue - num(current.costOfGoods) - taxAndFees;
      var contributionRate = contribution / current.netRevenue;
      if (contributionRate > 0 && operatingCostBase >= 0) {
        var breakEven = operatingCostBase / contributionRate;
        var gap = breakEven - current.netRevenue;
        var approximate = !current.costDataComplete;
        var costQuality = approximate ? 'Оценка: часть себестоимости рассчитана по средней наценке.' : 'Себестоимость подтверждена фактическими закупочными ценами.';
        breakEvenHtml = '<div style="padding:12px;border:1px solid var(--border);border-radius:11px;background:#fff;">' +
          '<div style="font-size:11px;color:var(--text-light);font-weight:700;">ТОЧКА БЕЗУБЫТОЧНОСТИ ЗА ВЫБРАННЫЙ ПЕРИОД</div>' +
          '<div style="font-size:22px;font-weight:850;margin:4px 0;">' + (approximate ? '≈ ' : '') + esc(money(breakEven)) + '</div>' +
          '<div style="font-size:11px;line-height:1.45;color:var(--text-light);">Маржинальный доход после себестоимости, налога и эквайринга: ' + esc(pct(contributionRate)) + '. Текущая выручка после возвратов: ' + esc(money(current.netRevenue)) + '.</div>' +
          '<div style="font-size:12px;font-weight:750;margin-top:7px;color:' + (gap > 0 ? '#a16615' : '#28764d') + ';">' +
          (gap > 0 ? 'До безубыточности не хватает ' + esc(money(gap)) : 'Выше точки безубыточности на ' + esc(money(Math.abs(gap)))) + '</div>' +
          '<div style="font-size:10px;line-height:1.45;color:var(--text-light);margin-top:6px;">' + esc(costQuality) + ' Оценка предполагает, что обычные, регулярные расходы и начисленная зарплата сохранятся в рублях, а валовая маржа, налоговая нагрузка и эквайринг останутся на уровне периода. Это сценарный ориентир, не прогноз.</div>' +
          '</div>';
      } else {
        breakEvenHtml = '<p style="padding:10px;border:1px solid var(--border);border-radius:10px;font-size:11px;color:var(--text-light);">Точку безубыточности нельзя надёжно оценить: после себестоимости, налога и эквайринга не остаётся положительного маржинального дохода.</p>';
      }
    } else {
      breakEvenHtml = '<p style="padding:10px;border:1px solid var(--border);border-radius:10px;font-size:11px;color:var(--text-light);">Точка безубыточности не рассчитана: для неё нужна себестоимость продаж и положительная выручка периода.</p>';
    }
    host.innerHTML = breakEvenHtml;
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
    var periodLabel = el('businessAdvisorPeriodLabel');
    if (periodLabel) {
      periodLabel.textContent = bounds.start.split('-').reverse().join('.') + ' — ' +
        bounds.end.split('-').reverse().join('.') + ' · ' +
        (selectedStore === 'all' ? 'все доступные магазины' : storeLabel(selectedStore));
    }
    if (!visibleKeys.length) {
      renderFinancialPanel([]);
      renderExpenseAnalysis(null);
      return;
    }
    var financeStoreIds = selectedStore === 'all' ? visibleKeys.slice() : [selectedStore];
    var financeStoreRows = financeStoreIds.map(function(id) {
      return { id:String(id), name:storeLabel(id), summary:getFinancialSummary(bounds.start, bounds.end, String(id)) };
    }).filter(function(item) { return !!item.summary; });
    var financialCurrent = getFinancialSummary(bounds.start, bounds.end, selectedStore);
    renderFinancialPanel(financeStoreRows);
    renderExpenseAnalysis(financialCurrent);
  }

  window.renderBusinessAdvisor = render;
})();