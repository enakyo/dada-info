/**
 * Dada Survivor Info Tool - Application Logic
 * 
 * Architecture:
 * - TimeManager: Handles UTC+8 game time calculations.
 * - DataManager: Handles config loading, localStorage, and i18n.
 * - EventCalculator: Contains business logic for different event types.
 * - UIManager: Manages DOM updates, Calendar, and Config Modal.
 */

// --- Constants ---
const CONFIG_PATH = 'config.json';
const STORAGE_KEY_CONFIG = 'dada_info_config';
const MS_PER_DAY = 86400000;

// --- TimeManager ---
class TimeManager {
    constructor(offset = 8) {
        this.offset = offset; // Game Timezone Offset (UTC+8)
    }

    /**
     * Returns "Today's" date in Game Time (UTC+8).
     * If local time is JST (UTC+9) 0:30, it's still previous day in UTC+8.
     * JST 1:00 = UTC+8 0:00 (New Day)
     * @returns {Date} Date object set to 00:00:00 of the game day
     */
    getGameDate(dateObj = new Date()) {
        // 1. Get UTC timestamp
        const utcMs = dateObj.getTime();
        // 2. Add Game Offset (UTC+8) -> Shift to Game Timezone
        const gameMs = utcMs + (this.offset * 3600000);
        const gameDate = new Date(gameMs);

        // 3. Normalize to midnight using UTC getters (since gameDate represents Game Time as UTC)
        return new Date(gameDate.getUTCFullYear(), gameDate.getUTCMonth(), gameDate.getUTCDate());
    }

    /**
     * Format date as YYYY-MM-DD
     */
    formatDateKey(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    /**
     * Parse YYYY-MM-DD string as Game Date (00:00)
     */
    parseDateKey(dateStr) {
        const [y, m, d] = dateStr.split('-').map(Number);
        return new Date(y, m - 1, d);
    }

    /**
     * Calculate difference in days between two dates
     */
    diffDays(from, to) {
        // Discard time portion to avoid DST issues (though using UTC internally helps)
        const utc1 = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
        const utc2 = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
        return Math.floor((utc2 - utc1) / MS_PER_DAY);
    }
}

// --- DataManager ---
class DataManager {
    constructor() {
        this.config = null;
        this.lang = 'ja';
    }

    async load() {
        // 1. Try localStorage
        const saved = localStorage.getItem(STORAGE_KEY_CONFIG);
        if (saved) {
            try {
                this.config = JSON.parse(saved);
                console.log('Loaded config from localStorage');
            } catch (e) {
                console.error('Failed to parse saved config', e);
            }
        }

        // 2. If no local or invalid, load default
        if (!this.config) {
            const res = await fetch(CONFIG_PATH + '?t=' + Date.now());
            this.config = await res.json();
            console.log('Loaded default config');
        }

        // Set Initial Lang
        const savedLang = localStorage.getItem('dada_lang');
        this.lang = savedLang || this.config.settings.defaultLang;
    }

    saveToStorage() {
        localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(this.config));
        localStorage.setItem('dada_lang', this.lang);
    }

    reset() {
        localStorage.removeItem(STORAGE_KEY_CONFIG);
        localStorage.removeItem('dada_lang');
        location.reload();
    }

    setLang(lang) {
        this.lang = lang;
        localStorage.setItem('dada_lang', lang);
    }

    t(key, params = {}) {
        const term = this.config.terms[this.lang]?.[key] || key;
        return term.replace(/{(\w+)}/g, (_, k) => params[k] !== undefined ? params[k] : `{${k}}`);
    }

    getEvents() {
        return this.config.events || [];
    }
}

// --- EventCalculator ---
class EventCalculator {
    constructor(timeManager, dataManager) {
        this.tm = timeManager;
        this.dm = dataManager;
    }

    calculate(event, targetDate) {
        const startDate = this.tm.parseDateKey(event.startDate || '2000-01-01');
        const diff = this.tm.diffDays(startDate, targetDate);

        // Common result object
        let result = {
            event,
            isActive: false,
            statusLabel: '',
            detailLabel: '',
            extraLabel: '',
            isUpdateDay: false,
            statusClass: 'status-active' // active, exchange-only, finished, preparation
        };

        // Global Pre-check: If event hasn't started yet (and not a cyclical one that implies past starts)
        // Actually, for this tool, we assume startDate is the anchor. If diff < 0, it's "Before Start".
        if (diff < 0) {
            result.statusLabel = this.dm.t('status.preparation');
            result.detailLabel = this.dm.t('label.remaining', { day: Math.abs(diff) });
            result.statusClass = 'status-preparation';
            return result;
        }

        switch (event.type) {
            case 'weekly_schedule':
                this._calcWeekly(event, targetDate, result);
                break;
            case 'cycle_days':
                this._calcCycleDays(event, diff, result);
                break;
            case 'season_rounds':
                this._calcSeasonRounds(event, diff, result);
                break;
            case 'season_week_gates':
                this._calcSeasonWeekGates(event, diff, result);
                break;
            case 'remaining_only':
                this._calcRemainingOnly(event, diff, result);
                break;
            case 'weekly_update': // Simple weekly refresh
                this._calcWeeklyUpdate(event, targetDate, result);
                break;
            default:
                result.isActive = true;
                result.statusLabel = 'Unknown Type';
        }

        return result;
    }

    _calcWeekly(event, targetDate, result) {
        // 0=Sun, 1=Mon... 6=Sat
        // But config might use 1=Mon...7=Sun or similar. 
        // Let's assume standard JS day: 0=Sun, 1=Mon, ..., 6=Sat
        // Config needs to map these. 
        // Helper: Mon=1,...Sun=7 (Common in games) OR 0=Sun
        const day = targetDate.getDay();
        // Dada usually updates on Mon or Tue depending on event?
        // Let's use config.schedule keys as JS Day (0-6).
        // Or map terms: Mon->1..Sun->7? config.json uses 1..6,0

        // Config.json schedule keys: "1"(Mon) .. "6"(Sat), "0"(Sun)
        const dayKey = String(day);
        const dayConfig = event.schedule[dayKey];

        if (!dayConfig) {
            result.isActive = false;
            return;
        }

        result.isActive = true;

        // Status Text
        if (dayConfig.type === 'preparation') {
            result.statusClass = 'status-preparation';
            result.statusLabel = this.dm.t('status.preparation');
        } else if (dayConfig.type === 'finished') {
            result.statusClass = 'status-finished';
            result.statusLabel = this.dm.t('status.expedition_finished');
            result.detailLabel = this.dm.t('status.finished');
        } else {
            result.statusClass = 'status-active';
            result.statusLabel = this.dm.t('status.active');
        }

        if (dayConfig.phaseKey) {
            result.detailLabel = this.dm.t(dayConfig.phaseKey);
            if (dayConfig.subIndex) {
                // Use label.day logic for consistency ("Day X")
                const dayStr = this.dm.t('label.day', { day: dayConfig.subIndex });
                result.detailLabel += ` / ${dayStr}`;
            }
        }

        if (dayConfig.extraKey) {
            result.extraLabel = this.dm.t(dayConfig.extraKey);
        }
    }

    _calcCycleDays(event, diff, result) {
        // diff is days since start. 
        // Cycle index = diff % cycleLength
        const cyclePos = diff % event.cycleDays; // 0 to cycleDays-1
        const currentDay = cyclePos + 1; // 1-based

        // Find phase definition
        let foundPhase = null;
        if (event.phases) {
            foundPhase = event.phases.find(p => p.days.includes(currentDay));
        }

        if (foundPhase) {
            result.isActive = true;
            if (foundPhase.type === 'exchange_only') {
                result.statusClass = 'status-exchange-only';
                result.statusLabel = this.dm.t('status.exchange_only');
            } else {
                result.statusClass = 'status-active';
                result.statusLabel = this.dm.t('status.active');
            }

            if (foundPhase.isUpdateDay) {
                result.isUpdateDay = true;
                result.extraLabel = this.dm.t('status.update_day');
            }
        } else {
            // Default fallback if no phase defined but cycle is running
            if (event.defaultType === 'active') {
                result.isActive = true;
                result.statusLabel = this.dm.t('status.active');
            }
        }

        result.detailLabel = this.dm.t('label.cycle_day', { day: currentDay });

        // Escape Operation Special Logic
        if (event.id === 'escape_op') {
            const remaining = event.cycleDays - cyclePos;
            if (currentDay === 27) {
                result.detailLabel = this.dm.t('label.last_day');
                result.statusClass = 'text-last-day';
            } else if (currentDay === 28) {
                result.detailLabel = this.dm.t('status.finished');
            } else {
                result.detailLabel = this.dm.t('label.remaining', { day: remaining });
            }
        }
        // Limited Event Special Logic
        else if (event.id === 'limited_event') {
            // If day 5 (Last active day), show Last Day in extraLabel
            if (currentDay === 5) {
                result.extraLabel = this.dm.t('label.last_day');
            }
            // Fallback to generically showing remaining if configured?
            // But keep existing generic logic for others:
        }
        else if (event.showRemaining) {
            const remaining = event.cycleDays - cyclePos;
            if (remaining === 1) {
                result.detailLabel = this.dm.t('label.last_day');
                result.statusClass = 'text-last-day';
            } else if (remaining === 2) {
                result.detailLabel = this.dm.t('tag.ending_soon');
                result.statusClass = 'tag-ending-soon';
            } else {
                result.detailLabel = this.dm.t('label.remaining', { day: remaining });
            }
        }
    }

    _calcSeasonRounds(event, diff, result) {
        const seasonPos = diff % event.seasonDays; // 0 to 27
        const roundIndex = Math.floor(seasonPos / event.roundDays) + 1;
        const dayInRound = (seasonPos % event.roundDays) + 1;

        result.isActive = true;
        result.statusLabel = this.dm.t('status.active');
        result.detailLabel = `${this.dm.t('label.round', { round: roundIndex })} / ${this.dm.t('label.day', { day: dayInRound })}`;

        // Echo Special Logic: Day 28 (seasonPos 27) is Tallying
        if (event.id === 'echo' && seasonPos === 27) {
            result.detailLabel = this.dm.t('label.tallying');
        }

        // Check if season just started
        if (seasonPos === 0) result.isUpdateDay = true;
    }

    _calcSeasonWeekGates(event, diff, result) {
        const seasonPos = diff % event.seasonDays;
        // Week updates on specific day?
        // If startDate is aligned with the update weekday, simple division works.
        // Spec says: Starts 2026-01-15 (Thu), update is Thu. So 7-day chunks are correct.
        const weekIndex = Math.floor(seasonPos / 7) + 1;
        const remaining = event.seasonDays - seasonPos;

        result.isActive = true;
        result.statusLabel = this.dm.t('status.active');

        let weekLabel = this.dm.t('label.week', { week: weekIndex });
        let remainingLabel = '';

        if (event.id === 'zone_op' && seasonPos === 27) {
            remainingLabel = this.dm.t('label.last_day');
            result.statusClass = 'text-last-day';
        } else {
            remainingLabel = this.dm.t('label.remaining', { day: remaining });
        }
        
        result.detailLabel = `${weekLabel}・${remainingLabel}`;

        if (event.gates) {
            const gate = event.gates.find(g => g.week === weekIndex);
            if (gate && gate.extraKey) {
                result.extraLabel = this.dm.t(gate.extraKey);
            }
        }

        if (seasonPos % 7 === 0) {
            result.extraLabel += (result.extraLabel ? ' / ' : '') + this.dm.t('status.update_day');
        }
    }

    _calcRemainingOnly(event, diff, result) {
        const cyclePos = diff % event.cycleDays;
        const remaining = event.cycleDays - cyclePos;

        result.isActive = true;
        result.statusLabel = this.dm.t('status.active');

        // Logic for value 1: "Last Day"
        if (remaining === 1) {
            result.detailLabel = this.dm.t('label.last_day');
            result.statusClass = 'text-last-day';
        } else {
            const labelKey = event.remainingLabelKey || 'label.remaining';
            result.detailLabel = this.dm.t(labelKey, { day: remaining });
        }

        if (cyclePos === 0) result.isUpdateDay = true;
    }

    _calcWeeklyUpdate(event, targetDate, result) {
        result.isActive = true;
        result.statusLabel = this.dm.t('status.active');

        // Calculate days until next updateWeekday
        // JS Day: 0(Sun)..6(Sat)
        const currentDay = targetDate.getDay();
        const targetDay = event.updateWeekday !== undefined ? event.updateWeekday : 1; // Default Mon

        let dayDiff = targetDay - currentDay;
        if (dayDiff <= 0) dayDiff += 7;

        // If today IS the update day (and we assume update happens at start of day),
        // Then "Remaining" is 7 days (full cycle) or 0? Usually "Updated today"

        if (currentDay === targetDay) {
            result.isUpdateDay = true;
            result.detailLabel = this.dm.t('status.update_day');
            result.extraLabel = this.dm.t('label.next_update', { day: 7 });
        } else {
            // Logic for value 1: "Last Day"
            if (dayDiff === 1) {
                result.detailLabel = this.dm.t('label.last_day');
                result.statusClass = 'text-last-day';
            } else {
                result.detailLabel = this.dm.t('label.next_update', { day: dayDiff });
            }
        }
    }
}

// --- UIManager ---
class UIManager {
    constructor(dataManager, timeManager, eventCalculator) {
        this.dm = dataManager;
        this.tm = timeManager;
        this.ec = eventCalculator;

        this.currentDate = this.tm.getGameDate();
        this.selectedDate = new Date(this.currentDate);

        // DOM Elements
        this.elTitle = document.getElementById('app-title');
        this.elCurrentMonth = document.getElementById('current-month-label');
        this.elCalendarContainer = document.getElementById('calendar-container');
        this.elSelectedDate = document.getElementById('selected-date-label');
        this.elEventList = document.getElementById('event-list');

        // Config Modal
        this.modal = document.getElementById('config-modal');
        this.btnConfig = document.getElementById('config-btn');
        this.btnClose = document.getElementById('close-config');
        this.btnSave = document.getElementById('save-config-btn');
        this.btnReset = document.getElementById('reset-config-btn');
        this.iptJson = document.getElementById('config-json-editor');
        this.selLang = document.getElementById('lang-select');

        this.bindEvents();
    }

    bindEvents() {
        document.getElementById('prev-month').addEventListener('click', () => this.moveMonth(-1));
        document.getElementById('next-month').addEventListener('click', () => this.moveMonth(1));
        document.getElementById('today-btn').addEventListener('click', () => {
            this.selectedDate = new Date(this.tm.getGameDate());
            this.renderCalendar();
            this.renderEventList();
        });

        this.btnConfig.addEventListener('click', () => this.openConfig());
        this.btnClose.addEventListener('click', () => this.closeConfig());
        this.btnSave.addEventListener('click', () => this.saveConfig());
        this.btnReset.addEventListener('click', () => this.dm.reset());

        const btnCopy = document.getElementById('copy-btn');
        if (btnCopy) {
            btnCopy.addEventListener('click', () => {
                const ta = document.getElementById('copy-textarea');
                if (ta) {
                    ta.select();
                    document.execCommand('copy');
                    const originalText = btnCopy.textContent;
                    btnCopy.textContent = 'コピーしました！';
                    setTimeout(() => { btnCopy.textContent = originalText; }, 2000);
                }
            });
        }
    }

    init() {
        this.updateStaticTexts();
        this.renderCalendar();
        this.renderEventList();
    }

    updateStaticTexts() {
        this.elTitle.textContent = this.dm.t('title');
    }

    moveMonth(delta) {
        this.selectedDate.setMonth(this.selectedDate.getMonth() + delta);
        this.renderCalendar();
    }

    // Render main calendar view
    renderCalendar() {
        const year = this.selectedDate.getFullYear();
        const month = this.selectedDate.getMonth(); // 0-indexed

        // Header Label: Main view year/month - Localized
        this.elCurrentMonth.textContent = this._formatMonth(year, month);

        this.elCalendarContainer.innerHTML = '';

        // Render 2 months. 
        this._renderMonthBlock(new Date(year, month, 1), false);
        this._renderMonthBlock(new Date(year, month + 1, 1), true); // isSecondMonth = true
    }

    _formatMonth(year, month) {
        if (this.dm.lang === 'en') {
            const monthNames = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"];
            return `${monthNames[month]} ${year}`;
        } else {
            return `${year}年 ${month + 1}月`;
        }
    }

    _renderMonthBlock(dateObj, isSecondMonth) {
        const year = dateObj.getFullYear();
        const month = dateObj.getMonth();
        const today = this.tm.getGameDate();

        // Wrapper
        const block = document.createElement('div');
        block.className = 'calendar-month-block';
        if (isSecondMonth) {
            block.classList.add('mobile-hidden');
        }

        // Month Label (Localized)
        const label = document.createElement('div');
        label.className = 'month-label';
        label.textContent = this._formatMonth(year, month);
        block.appendChild(label);

        // Weekdays Header
        const weekdaysDiv = document.createElement('div');
        weekdaysDiv.className = 'calendar-weekdays';
        ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].forEach(d => {
            const div = document.createElement('div');
            div.textContent = this.dm.t(`weekday.${d}`);
            weekdaysDiv.appendChild(div);
        });
        block.appendChild(weekdaysDiv);

        // Grid
        const grid = document.createElement('div');
        grid.className = 'calendar-grid';

        // Math
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startDate = new Date(firstDay);
        startDate.setDate(startDate.getDate() - startDate.getDay());
        const endDate = new Date(lastDay);
        endDate.setDate(endDate.getDate() + (6 - endDate.getDay()));

        let iter = new Date(startDate);
        while (iter <= endDate) {
            const d = new Date(iter);
            const cell = document.createElement('div');
            cell.className = 'calendar-day';
            cell.textContent = d.getDate();

            if (d.getMonth() !== month) cell.classList.add('other-month');
            if (d.getTime() === today.getTime()) cell.classList.add('today');
            // Selection logic: match mostly exact date.
            if (d.getTime() === this.selectedDate.getTime()) cell.classList.add('selected');

            // Click
            cell.addEventListener('click', () => {
                this.selectedDate = d;
                this.renderCalendar();
                this.renderEventList();
            });

            grid.appendChild(cell);
            iter.setDate(iter.getDate() + 1);
        }
        block.appendChild(grid);
        this.elCalendarContainer.appendChild(block);
    }

    renderEventList() {
        const y = this.selectedDate.getFullYear();
        const m = this.selectedDate.getMonth() + 1;
        const d = this.selectedDate.getDate();
        const dayOfWeek = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][this.selectedDate.getDay()];

        // Format selected date based on lang? keeping simple YYYY-MM-DD for now but could localize if needed.
        this.elSelectedDate.textContent = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} (${this.dm.t(`weekday.${dayOfWeek}`)})`;

        this.elEventList.innerHTML = '';

        const events = this.dm.getEvents();
        if (!events.length) {
            this.elEventList.textContent = "No events defined.";
            return;
        }

        events.forEach(event => {
            const calc = this.ec.calculate(event, this.selectedDate);

            const card = document.createElement('div');
            // Add specific class for grid layout styling
            card.className = `event-row ${calc.statusClass || ''}`;

            const name = this.dm.t(calc.event.nameKey);

            // Update Day Badge (Joined with name)
            let nameHtml = `<span class="event-name-text">${name}</span>`;
            if (calc.isUpdateDay) {
                nameHtml += `<span class="mini-badge update-badge">${this.dm.t('status.update_day')}</span>`;
            }
            // If exchange only, maybe show that too?
            if (calc.statusClass === 'status-exchange-only') {
                nameHtml += `<span class="mini-badge exchange-badge">${this.dm.t('status.exchange_only')}</span>`;
            }

            // Info Column
            let infoHtml = `<div class="info-primary">${calc.detailLabel}</div>`;
            if (calc.extraLabel) {
                infoHtml += `<div class="info-secondary">${calc.extraLabel}</div>`;
            }

            card.innerHTML = `
              <div class="event-col-name">${nameHtml}</div>
              <div class="event-col-info">${infoHtml}</div>
            `;

            this.elEventList.appendChild(card);
        });

        // Apply text fitting for event names
        this.fitTextEvents();
        
        this.generateCopyText();
    }

    generateCopyText() {
        const events = this.dm.getEvents();
        const alwaysShow = ['mine_expedition', 'limited_event', 'regular_challenge'];
        const listText = [];
        const otherText = [];
        
        events.forEach(event => {
            const calc = this.ec.calculate(event, this.selectedDate);
            if (!calc.isActive && calc.statusClass !== 'status-preparation') return;

            const name = this.dm.t(calc.event.nameKey);
            let val = calc.detailLabel || '';
            let extra = calc.extraLabel || '';
            let combined = val;
            
            if (extra) {
                if (extra.includes('締切') || extra.includes('最終日') || extra.includes('更新日') || extra.includes('開始')) {
                    combined += `(${extra})`;
                } else {
                    combined += combined ? ` / ${extra}` : extra;
                }
            }
            if (calc.statusClass === 'status-preparation') {
                combined = `${this.dm.t('status.preparation')}(${combined})`;
            }

            let show = false;
            if (alwaysShow.includes(event.id)) {
                show = true;
            } else {
                let textToCheck = combined + (calc.isUpdateDay ? '更新日' : '');
                if (/(残り[123]日|終了間近|最終日|更新日|開始)/.test(textToCheck)) {
                    show = true;
                }
                // Special case fallback if Echo needs to be shown for testing example purposes, but we stick strictly to regex.
            }
            
            if (show) {
                if (alwaysShow.includes(event.id)) {
                    listText.push(`●${name}：${combined}`);
                } else {
                    otherText.push(`${name}：${combined}`);
                }
            }
        });
        
        let finalText = listText.join('\n');
        if (otherText.length > 0) {
            finalText += '\n\n●その他更新状況\n' + otherText.join('\n');
        }
        
        const ta = document.getElementById('copy-textarea');
        if (ta) ta.value = finalText;
    }

    fitTextEvents() {
        requestAnimationFrame(() => {
            const nameTexts = document.querySelectorAll('.event-name-text');
            nameTexts.forEach(el => {
                let size = 0.95; // start rem
                el.style.fontSize = `${size}rem`;

                // Parent width constraint
                const parent = el.closest('.event-col-name');
                if (!parent) return;

                // Helper to check overflow
                const isOverflowing = () => el.scrollWidth > parent.clientWidth;

                // Safety limiter: don't go too small
                while (isOverflowing() && size > 0.6) {
                    size -= 0.05;
                    el.style.fontSize = `${size}rem`;
                }
            });
        });
    }

    openConfig() {
        this.selLang.value = this.dm.lang;
        this.iptJson.value = JSON.stringify(this.dm.config, null, 2);
        this.modal.classList.remove('hidden');
    }

    closeConfig() {
        this.modal.classList.add('hidden');
    }

    saveConfig() {
        try {
            const newConfig = JSON.parse(this.iptJson.value);
            this.dm.config = newConfig;
            this.dm.lang = this.selLang.value;
            this.dm.saveToStorage();

            this.updateStaticTexts();
            this.renderEventList();
            this.closeConfig();
            alert('Saved!');
        } catch (e) {
            alert('JSON Parse Error: \n' + e.message);
        }
    }
}

// --- Main Bootstrap ---
(async function () {
    try {
        const tm = new TimeManager(8); // UTC+8
        const dm = new DataManager();
        await dm.load();
        const ec = new EventCalculator(tm, dm);
        const ui = new UIManager(dm, tm, ec);

        ui.init();
    } catch (e) {
        console.error(e);
        alert('Initialization Failed: ' + e.message);
    }
})();
