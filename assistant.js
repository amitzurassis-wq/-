/**
 * Assistant Controller
 * Handles natural language interactions
 */

class Assistant {
    constructor() {
        this.messages = document.getElementById('chat-messages');
        this.input = document.getElementById('chat-input');
        this.form = document.getElementById('chat-form');

        // Check if elements exist (safety)
        if (this.messages && this.input && this.form) {
            this.setupListeners();
        }
    }

    setupListeners() {
        this.form.addEventListener('submit', (e) => {
            e.preventDefault();
            const text = this.input.value.trim();
            if (!text) return;

            this.addMessage(text, 'user');
            this.input.value = '';

            // Artificial delay for realism
            setTimeout(() => {
                this.processCommand(text);
            }, 500);
        });
    }

    addMessage(text, type = 'system') {
        const div = document.createElement('div');
        div.className = `msg ${type}`;
        div.innerHTML = text;
        this.messages.appendChild(div);
        this.messages.scrollTop = this.messages.scrollHeight;
    }

    processCommand(text) {
        const lower = text.toLowerCase();

        // 1. Add Shift Command
        // Patterns: "add shift 20.11 8-16", "משמרת מחר 8 עד 16", "20.11 08:00-16:00"
        if (lower.includes('add') || lower.includes('משמרת') || lower.includes('תוסיף') || /^\d{1,2}\.\d{1,2}/.test(lower)) {
            this.handleAddShift(text);
            return;
        }

        // 2. Summary
        if (lower.includes('summary') || lower.includes('סיכום') || lower.includes('כמה')) {
            this.handleSummary();
            return;
        }

        // 3. Clear
        if (lower.includes('clear') || lower.includes('נקה')) {
            this.messages.innerHTML = '';
            this.addMessage('נוקה. איך אפשר לעזור?');
            return;
        }

        // Default
        this.addMessage('לא הבנתי את הבקשה. נסה: "תוסיף משמרת ב-20.11 מ-8 עד 16"');
    }

    handleAddShift(text) {
        // Advanced NLU
        const lower = text.toLowerCase();
        let dateStr = '';
        let startStr = '';
        let endStr = '';

        const extract = (prefix) => {
            const regex = new RegExp(`${prefix}\\s*[:=]?\\s*(\\S+)`, 'i');
            const match = text.match(regex);
            return match ? match[1] : null;
        };

        // 1. Try Named Parameters
        dateStr = extract('date') || extract('תאריך') || extract('יום');
        startStr = extract('start') || extract('begin') || extract('התחלה') || extract('from') || extract('m') || extract('מ');
        endStr = extract('end') || extract('finish') || extract('sium') || extract('סיום') || extract('to') || extract('ad') || extract('עד');

        // 2. Handle "Tomorrow"/"Today" keywords in date
        if (!dateStr) {
            if (lower.includes('tomorrow') || lower.includes('מחר')) {
                const d = new Date();
                d.setDate(d.getDate() + 1);
                dateStr = `${d.getDate()}.${d.getMonth() + 1}`;
            } else if (lower.includes('today') || lower.includes('היום')) {
                const d = new Date();
                dateStr = `${d.getDate()}.${d.getMonth() + 1}`;
            }
        }

        // 3. Fallback: Regex for "DD.MM" + "HH:mm-HH:mm" if named failed
        if (!dateStr || !startStr || !endStr) {
            let clean = text.replace(/מ-|from\s/g, '').replace(/עד-|to\s/g, '-');

            if (!dateStr) {
                const dateMatch = clean.match(/(\d{1,2}\.\d{1,2})/);
                if (dateMatch) dateStr = dateMatch[1];
            }

            const rangeMatch = clean.match(/(\d{1,2}(:\d{2})?)\s*-\s*(\d{1,2}(:\d{2})?)/);
            if (rangeMatch) {
                if (!startStr) startStr = rangeMatch[1];
                if (!endStr) endStr = rangeMatch[3];
            }
        }

        // 4. Validate and Add
        if (dateStr && startStr && endStr) {
            const fullDate = window.LogicEngine.parseDateString(dateStr);
            const normTime = (t) => {
                if (!t.includes(':')) return `${t.padStart(2, '0')}:00`;
                return t.padStart(5, '0');
            };

            const shift = {
                id: Date.now(),
                date: fullDate,
                start: normTime(startStr),
                end: normTime(endStr)
            };

            window.store.shifts.push(shift);
            saveData();
            this.addMessage(`👍 הוספתי משמרת ב-${fullDate}: ${shift.start} - ${shift.end}`);
        } else {
            this.addMessage('לא הצלחתי להבין את כל הפרטים. נסה: "20.11 08:00-16:00"');
        }
    }

    handleSummary() {
        const report = window.LogicEngine.generateReport(window.store.shifts, document.getElementById('month-select').value);
        let total = 0;
        report.forEach(s => total += s.duration);
        this.addMessage(`סה"כ שעות: ${total.toFixed(2)}`);
    }
}

// Init Chat when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    try {
        window.assistant = new Assistant();
    } catch (e) {
        console.error('Assistant failed to init:', e);
    }
});

// Toggle UI (Global)
window.toggleChat = function () {
    const w = document.getElementById('chat-widget');
    if (!w) return;
    w.classList.toggle('collapsed');
    const icon = document.getElementById('chat-toggle-icon');
    if (icon) icon.innerText = w.classList.contains('collapsed') ? '▲' : '▼';
};
