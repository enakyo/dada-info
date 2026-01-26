const fs = require('fs');
const path = require('path');

// --- Configuration ---
const CONFIG_PATH = path.join(__dirname, 'config.json');
const OUTPUT_PATH = path.join(__dirname, 'daily_events.json');

// --- Logic Classes (Ported from app.js) ---

class TimeManager {
    constructor(offset = 8) {
        this.offset = offset; // Game Timezone Offset (UTC+8)
    }

    getGameDate(dateObj = new Date()) {
        const utcMs = dateObj.getTime();
        const gameMs = utcMs + (this.offset * 3600000);
        const gameDate = new Date(gameMs);
        return new Date(gameDate.getUTCFullYear(), gameDate.getUTCMonth(), gameDate.getUTCDate());
    }

    formatDateKey(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    parseDateKey(dateStr) {
        const [y, m, d] = dateStr.split('-').map(Number);
        return new Date(y, m - 1, d);
    }

    diffDays(from, to) {
        const MS_PER_DAY = 86400000;
        const utc1 = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
        const utc2 = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
        return Math.floor((utc2 - utc1) / MS_PER_DAY);
    }
}

class DataManager {
    constructor() {
        this.config = null;
        this.lang = 'ja'; // Default to Japanese for export
    }

    load() {
        try {
            const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
            this.config = JSON.parse(raw);
            // Ensure lang is set from config if available, else default
            if (this.config.settings && this.config.settings.defaultLang) {
                this.lang = this.config.settings.defaultLang;
            }
        } catch (e) {
            console.error('Failed to load config.json:', e);
            process.exit(1);
        }
    }

    t(key, params = {}) {
        // Strip HTML tags for clean JSON data if preferred, 
        // but user might want raw strings. Let's strip HTML for "text" field, keep raw for "html"?
        // For simple JSON export, let's keep it raw text, but maybe strip <span class='big-num'> tags for readability?
        // User asked for "JSON output", likely for consumption by another tool. Clean text is safer.
        const term = this.config.terms[this.lang]?.[key] || key;
        let replaced = term.replace(/{(\w+)}/g, (_, k) => params[k] !== undefined ? params[k] : `{${k}}`);

        // Remove HTML tags for clean export (optional, but likely desired)
        return replaced.replace(/<[^>]*>/g, '');
    }

    getEvents() {
        return this.config.events || [];
    }
}

class EventCalculator {
    constructor(timeManager, dataManager) {
        this.tm = timeManager;
        this.dm = dataManager;
    }

    calculate(event, targetDate) {
        const startDate = this.tm.parseDateKey(event.startDate || '2000-01-01');
        const diff = this.tm.diffDays(startDate, targetDate);

        let result = {
            id: event.id,
            name: this.dm.t(event.nameKey),
            type: event.type,
            isActive: false,
            statusLabel: '',
            detailLabel: '',
            extraLabel: '',
            isUpdateDay: false,
            // Raw values for machine consumption
            raw: {
                diffDays: diff
            }
        };

        if (diff < 0) {
            result.statusLabel = this.dm.t('status.preparation');
            result.detailLabel = this.dm.t('label.remaining', { day: Math.abs(diff) });
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
            case 'weekly_update':
                this._calcWeeklyUpdate(event, targetDate, result);
                break;
            default:
                result.isActive = true;
                result.statusLabel = 'Unknown Type';
        }

        return result;
    }

    _calcWeekly(event, targetDate, result) {
        const day = targetDate.getDay();
        const dayKey = String(day);
        const dayConfig = event.schedule[dayKey];

        if (!dayConfig) {
            result.isActive = false;
            return;
        }

        result.isActive = true;
        if (dayConfig.type === 'preparation') {
            result.statusLabel = this.dm.t('status.preparation');
        } else if (dayConfig.type === 'finished') {
            result.statusLabel = this.dm.t('status.expedition_finished');
        } else {
            result.statusLabel = this.dm.t('status.active');
        }

        if (dayConfig.phaseKey) {
            result.detailLabel = this.dm.t(dayConfig.phaseKey);
            if (dayConfig.subIndex) {
                const dayStr = this.dm.t('label.day', { day: dayConfig.subIndex });
                result.detailLabel += ` / ${dayStr}`;
            }
        }

        if (dayConfig.extraKey) {
            result.extraLabel = this.dm.t(dayConfig.extraKey);
        }
    }

    _calcCycleDays(event, diff, result) {
        const cyclePos = diff % event.cycleDays;
        const currentDay = cyclePos + 1;
        result.raw.currentDay = currentDay;

        let foundPhase = null;
        if (event.phases) {
            foundPhase = event.phases.find(p => p.days.includes(currentDay));
        }

        if (foundPhase) {
            result.isActive = true;
            if (foundPhase.type === 'exchange_only') {
                result.statusLabel = this.dm.t('status.exchange_only');
            } else {
                result.statusLabel = this.dm.t('status.active');
            }
            if (foundPhase.isUpdateDay) {
                result.isUpdateDay = true;
                result.extraLabel = this.dm.t('status.update_day');
            }
        } else {
            if (event.defaultType === 'active') {
                result.isActive = true;
                result.statusLabel = this.dm.t('status.active');
            }
        }
        result.detailLabel = this.dm.t('label.cycle_day', { day: currentDay });
    }

    _calcSeasonRounds(event, diff, result) {
        const seasonPos = diff % event.seasonDays;
        const roundIndex = Math.floor(seasonPos / event.roundDays) + 1;
        const dayInRound = (seasonPos % event.roundDays) + 1;

        result.isActive = true;
        result.statusLabel = this.dm.t('status.active');
        result.detailLabel = `${this.dm.t('label.round', { round: roundIndex })} / ${this.dm.t('label.day', { day: dayInRound })}`;

        if (seasonPos === 0) result.isUpdateDay = true;
    }

    _calcSeasonWeekGates(event, diff, result) {
        const seasonPos = diff % event.seasonDays;
        const weekIndex = Math.floor(seasonPos / 7) + 1;

        result.isActive = true;
        result.statusLabel = this.dm.t('status.active');
        result.detailLabel = this.dm.t('label.week', { week: weekIndex });

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
        result.raw.remaining = remaining;

        result.isActive = true;
        result.statusLabel = this.dm.t('status.active');
        const labelKey = event.remainingLabelKey || 'label.remaining';
        result.detailLabel = this.dm.t(labelKey, { day: remaining });

        if (cyclePos === 0) result.isUpdateDay = true;
    }

    _calcWeeklyUpdate(event, targetDate, result) {
        result.isActive = true;
        result.statusLabel = this.dm.t('status.active');

        const currentDay = targetDate.getDay();
        const targetDay = event.updateWeekday !== undefined ? event.updateWeekday : 1;

        let dayDiff = targetDay - currentDay;
        if (dayDiff <= 0) dayDiff += 7;

        if (currentDay === targetDay) {
            result.isUpdateDay = true;
            result.detailLabel = this.dm.t('status.update_day');
            result.extraLabel = this.dm.t('label.next_update', { day: 7 });
        } else {
            result.detailLabel = this.dm.t('label.next_update', { day: dayDiff });
        }
    }
}

// --- Main Execution ---

function main() {
    console.log("Generating event data...");

    const tm = new TimeManager(8);
    const dm = new DataManager();
    dm.load();
    const ec = new EventCalculator(tm, dm);

    // Target Date: Today (Game Time)
    const targetDate = tm.getGameDate(new Date());
    console.log(`Target Game Date: ${tm.formatDateKey(targetDate)}`);

    const events = dm.getEvents();
    const outputData = {
        date: tm.formatDateKey(targetDate),
        generatedAt: new Date().toISOString(),
        events: []
    };

    events.forEach(event => {
        const calc = ec.calculate(event, targetDate);
        outputData.events.push(calc);
    });

    const jsonStr = JSON.stringify(outputData, null, 2);
    fs.writeFileSync(OUTPUT_PATH, jsonStr, 'utf8');

    console.log(`Successfully wrote to ${OUTPUT_PATH}`);
}

main();
