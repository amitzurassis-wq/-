/**
 * Logic Engine for Payroll App
 * Handles: Shift processing, Continuity check, Quotas (30h rule), Overtime.
 */

// Constants
const QUOTAS = {
    SHIFT_TARGET: 8.5,
    WAKEUP_TARGET: 1.5,
    WEEKLY_TARGET: 30, // The rule mentions "Fixed quota (30h)"
    TARGET_SHIFTS_COUNT: 3,
    TARGET_WAKEUP_COUNT: 3
};

// Data Store (In-Memory for now, can sync to LocalStorage)
const store = {
    shifts: [], // Array of shift objects
    preferences: {}
};

/**
 * Parses time string "HH:mm" to decimal hours (e.g., "08:30" -> 8.5)
 */
function timeToDecimal(timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return h + (m / 60);
}

/**
 * Formats decimal hours back to "HH:mm"
 */
function decimalToTime(decimal) {
    const h = Math.floor(decimal);
    const m = Math.round((decimal - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Calculates duration between start and end times
 */
function calculateDuration(startStr, endStr) {
    let start = timeToDecimal(startStr);
    let end = timeToDecimal(endStr);

    if (end < start) {
        end += 24; // Handle night shift crossing midnight
    }
    return Math.max(0, end - start);
}

class LogicEngine {

    /**
     * Helper: Get start/end dates for a payroll month (e.g. "2025-11")
     * Period: 20th of Prev Month to 19th of Current Month
     */
    static getPayrollPeriod(monthStr) {
        const [year, month] = monthStr.split('-').map(Number);

        // Start: 20th of Prev Month
        // JS Month is 0-indexed for Date constructor
        const start = new Date(year, month - 1 - 1, 20);

        // End: 19th of Current Month
        const end = new Date(year, month - 1, 19);

        return { start, end };
    }

    /**
     * Main Entry point
     * @param {Array} shifts 
     * @param {String} selectedMonth "YYYY-MM"
     */
    static generateReport(shifts, selectedMonth) {
        const period = this.getPayrollPeriod(selectedMonth || '2025-11');

        // Filter shifts within period
        const periodShifts = shifts.filter(s => {
            const d = new Date(s.date);
            return d >= period.start && d <= period.end;
        });

        // 1. Group by Date
        const shiftsByDay = this.groupShiftsByDate(periodShifts);

        // 2. Process Daily Logic
        const dailyProcessed = [];
        Object.keys(shiftsByDay).sort().forEach(date => {
            const dayShifts = shiftsByDay[date];
            dayShifts.sort((a, b) => timeToDecimal(a.start) - timeToDecimal(b.start));
            dailyProcessed.push(...this.processDay(date, dayShifts));
        });

        // 3. Process Weekly Logic
        const weeks = this.groupDaysByWeek(dailyProcessed);
        const fullyProcessed = this.processWeeklyQuotas(weeks, period);

        return fullyProcessed;
    }

    static groupShiftsByDate(shifts) {
        return shifts.reduce((acc, shift) => {
            if (!acc[shift.date]) acc[shift.date] = [];
            acc[shift.date].push(shift);
            return acc;
        }, {});
    }

    /**
     * Parsing Helper for "DD.MM" format to "YYYY-MM-DD"
     * Assumes current payroll year (2025) or infers from month context
     */
    static parseDateString(datePart) {
        // Input: "20.11" -> "2025-11-20"
        const [day, month] = datePart.split('.').map(s => s.trim().padStart(2, '0'));
        // Use a fixed year for now or dynamic? Prompt context says 2025 calendar.
        const year = "2025";
        return `${year}-${month}-${day}`;
    }

    /**
     * Processes a single day's shifts.
     * Rules:
     * 1. Gap <= 1.5h (1.5) -> CONTINUOUS (Accumulates for overtime).
     * 2. Wake-up = strict 06:30-08:00 time slice.
     * 3. Shift Quota = 8.0h base + 0.5h 125%.
     */
    static processDay(dateStr, sortedShifts) {
        let dailyAccumulator = 0; // Hours worked in current continuous block
        let lastEndTime = -1;

        // Output array for this day
        const processedDayShifts = [];

        // Definition of Wake-up Time Range
        const WAKEUP_START = 6.5; // 06:30
        const WAKEUP_END = 8.0;   // 08:00

        sortedShifts.forEach(shift => {
            const startDec = timeToDecimal(shift.start);
            const endDec = timeToDecimal(shift.end);
            let duration = endDec - startDec;
            if (duration < 0) duration += 24;

            // Continuity Check
            // "Up to gap of 1.5h" -> If gap <= 1.5, merge accumulator.
            let isContinuous = false;

            if (lastEndTime !== -1) {
                const gap = startDec - lastEndTime;
                // Note: strict check, assuming chronological sort.
                if (gap <= 1.5 + 0.001 && gap >= 0) { // +epsilon
                    isContinuous = true;
                } else {
                    dailyAccumulator = 0; // Reset
                }
            }

            // Calculate Overtime Tiers based on Accumulator
            const prevAcc = dailyAccumulator;
            const newAcc = dailyAccumulator + duration;

            // Payment Tiers:
            // 0 - 8.0: 100%
            // 8.0 - 10.0: 125% (2 hours band)
            // 10.0+: 150%

            function getOverlap(start, end, tierStart, tierEnd) {
                const s = Math.max(start, tierStart);
                const e = Math.min(end, tierEnd);
                return Math.max(0, e - s);
            }

            const regHours = getOverlap(prevAcc, newAcc, 0, 8.0);
            const p125 = getOverlap(prevAcc, newAcc, 8.0, 10.0);
            const p150 = getOverlap(prevAcc, newAcc, 10.0, 999);

            // Wake-up Extraction Logic (Visual / Quota Only - does not change Payment Tiers?)
            // "Wake-up is an hour and a half between 6:30 - 8:00"
            // We check intersection of THIS shift with 06:30-08:00
            const wakeupOverlap = getOverlap(startDec, endDec, WAKEUP_START, WAKEUP_END);

            // Quota Buckets for this specific shift slice
            // Note: These will be aggregated weekly, but we tag them here.
            let qWakeup = 0;
            let qShift = 0;

            // Strategy:
            // 1. If it overlaps 06:30-08:00, that portion is Wakeup Quota.
            if (wakeupOverlap > 0) {
                qWakeup = wakeupOverlap;
            }

            // 2. Remainder contributes to Shift Quota?
            // "Shift" quota target is 8.5h. 
            // If I work 6:30-22:00 (15.5h):
            // 1.5h is Wakeup (priority extraction).
            // Remainder 14h. 
            // 8.5h of that should count to Shift Quota.
            // But we process shift-by-shift.
            // Let's defer strict Quota "Filling" to the Weekly processor.
            // Here we just calculated raw potential.
            // BUT, visual breakdown needs to be consistent.

            dailyAccumulator = newAcc;
            lastEndTime = endDec;

            processedDayShifts.push({
                ...shift,
                duration,
                breakdown: {
                    regular: regHours,
                    extra125: p125,
                    extra150: p150,
                    potentialWakeup: wakeupOverlap, // metadata for weekly calc
                    potentialShift: duration - wakeupOverlap, // metadata
                    // Display fields defaults
                    quotaDisplay: '',
                    deduction: 0
                }
            });
        });

        return processedDayShifts;
    }

    static groupDaysByWeek(processedShifts) {
        const weeks = {};
        processedShifts.forEach(shift => {
            const date = new Date(shift.date);
            const dayCode = date.getDay();
            const sunday = new Date(date);
            sunday.setDate(date.getDate() - dayCode);
            // Use time-zone safe string key
            const weekKey = sunday.toLocaleDateString('en-CA'); // YYYY-MM-DD

            if (!weeks[weekKey]) weeks[weekKey] = [];
            weeks[weekKey].push(shift);
        });
        return weeks;
    }

    static processWeeklyQuotas(weeks, period) {
        const allShifts = [];

        Object.keys(weeks).forEach(weekKey => {
            const weekShifts = weeks[weekKey];

            // Partial Week Check
            const sundayDate = new Date(weekKey);
            const saturdayDate = new Date(sundayDate);
            saturdayDate.setDate(sundayDate.getDate() + 6);
            const isPartial = (sundayDate < period.start) || (saturdayDate > period.end);

            // Quotas
            const TARGET_SHIFTS = 3;
            const TARGET_WAKEUPS = 3;

            let filledShifts = 0; // Each needs 8.5
            let filledWakeups = 0; // Each needs 1.5

            // Sort shifts to prioritize filling quotas?
            // Usually chronological.

            weekShifts.forEach(shift => {
                const b = shift.breakdown;

                let qW = 0;
                let qS = 0;
                let status = '';

                // 1. Wake-up Logic (Strict Time Extraction)
                // If this shift had potential Wakeup (06:30-08:00) AND we have space in quota
                // NOTE: "Extraction is automatic... both of wake-up and overtime"
                if (b.potentialWakeup > 0) {
                    // It counts as wakeup if we have space? Or always?
                    // User: "The quota consists of exactly 3 Shifts ... and 3 Wake-ups"
                    // If I work 4 days with 06:30-08:00? The 4th is Extra.

                    if (filledWakeups < TARGET_WAKEUPS) {
                        // Consume as specific Wake-up quota
                        // Is it always 1.5? If potentialWakeup < 1.5 (e.g. started 7:00), it's partial?
                        // "Wake-up is an hour and a half...". Assuming always full 1.5 if matched?
                        // Let's use the actual duration overlap.
                        qW = b.potentialWakeup;
                        filledWakeups += (qW / 1.5); // Count fractions? Or 1 unit?
                        // "Exactly 3 Wake-ups (1.5h)". implied Units.
                        // Let's assume if overlap >= 1.0 we count it as a Unit.
                    }
                }

                // 2. Shift Logic
                // We have remaining duration (potentialShift).
                // Does it fit into a Shift bucket?
                const remainingDur = shift.duration - qW;

                // If enough duration to be a shift (e.g. >= 8.0)
                if (filledShifts < TARGET_SHIFTS && remainingDur >= 8.0) {
                    qS = 8.5; // Counts full 8.5 towards quota calculation
                    filledShifts++;
                    status = 'Shift';
                }

                if (qW > 0.1) status += (status ? ' + ' : '') + 'Wakeup';

                b.quotaShift = qS;
                b.quotaWakeup = qW;
                b.quotaDisplay = (qS + qW) > 0 ? (qS + qW).toFixed(2) : 'Extra';

                if ((qS + qW) === 0) b.isExtra = true;
            });

            // Deduction (Linear)
            // Goal: 30 hours.
            // Earned = (filledShifts_Count * 8.5) + (filledWakeups_Count * 1.5) ?
            // Or sum of actual attributes?
            // "The quota consists of exactly 3 Shifts... and 3 Wake-ups" -> Total 30.
            // If I did 2 shifts (17) + 2 wakeups (3) = 20. Deficit 10.

            // We need to count exact units filled.
            const earnedQuota = (Math.min(filledShifts, 3) * 8.5) + (Math.min(filledWakeups, 3) * 1.5);
            const deficit = 30 - earnedQuota; // Simple linear

            // Apply deduction
            if (!isPartial && deficit > 0) {
                if (weekShifts.length > 0) {
                    const lastShift = weekShifts[weekShifts.length - 1];
                    lastShift.breakdown.deduction = deficit.toFixed(2);
                }
            } else if (isPartial) {
                if (weekShifts.length > 0) {
                    const lastShift = weekShifts[weekShifts.length - 1];
                    lastShift.breakdown.notes = "שבוע חלקי";
                }
            }

            allShifts.push(...weekShifts);
        });

        return allShifts;
    }

    /**
     * Parses bulk text input.
     * Supports formats:
     * "20.11- 6:30-8:00, 13:30-22:00"
     */
    static parseBulkText(text) {
        const lines = text.split('\n').filter(l => l.trim());
        const parsedShifts = [];

        lines.forEach(line => {
            // Regex to capture Date ("20.11") and then a list of times
            // Normalized: Remove text like "(השכמה רביעית)"
            const cleanerLine = line.replace(/[()א-ת]/g, '').trim();

            // Split date vs times
            // "20.11- 6:30..." -> Split by first dash?
            // Or regex: /^(\d{1,2}\.\d{1,2})[-|\s]+(.+)$/
            const match = cleanerLine.match(/^(\d{1,2}\.\d{1,2})[-|\s]+(.+)$/);

            if (match) {
                const dateStr = this.parseDateString(match[1]);
                const timePart = match[2];
                // Parse times: "6:30-8:00, 13:30-22:00"
                const times = timePart.split(',').map(t => t.trim());

                times.forEach(tRange => {
                    // "6:30-8:00"
                    const [s, e] = tRange.split('-').map(x => x.trim());
                    if (s && e) {
                        parsedShifts.push({
                            id: Date.now() + Math.random(),
                            date: dateStr,
                            start: s,
                            end: e
                        });
                    }
                });
            }
        });

        return parsedShifts;
    }
}


// Expose to window
// Expose to window
window.LogicEngine = LogicEngine;
window.store = store;
