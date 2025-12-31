/**
 * App Controller
 */

// DOM Elements
const tableBody = document.getElementById('table-body');
const btnAddShift = document.getElementById('btn-add-shift');
const btnPrint = document.getElementById('btn-print');
const shiftModal = document.getElementById('shift-modal');
const shiftForm = document.getElementById('shift-form');

// Global Store
window.store = {
    shifts: []
};

// Init
function init() {
    loadData();
    renderTable();
    setupEventListeners();
}

function loadData() {
    try {
        const saved = localStorage.getItem('payroll_shifts');
        if (saved) {
            window.store.shifts = JSON.parse(saved) || [];
        }
    } catch (e) {
        console.error('Failed to load data', e);
        window.store.shifts = [];
    }

    // Ensure store is valid
    if (!Array.isArray(window.store.shifts)) {
        window.store.shifts = [];
    }
}

function saveData() {
    try {
        localStorage.setItem('payroll_shifts', JSON.stringify(window.store.shifts));
        renderTable();
    } catch (e) {
        console.error('Failed to save data', e);
        alert('שגיאה בשמירת הנתונים!');
    }
}

function renderTable() {
    const tableBody = document.getElementById('table-body');
    if (!tableBody) return;

    tableBody.innerHTML = '';

    // Process full logic (deductions etc)
    const monthSelect = document.getElementById('month-select');
    const selectedMonth = monthSelect ? monthSelect.value : '2025-11';

    let reportData = [];
    try {
        reportData = window.LogicEngine.generateReport(window.store.shifts, selectedMonth);
    } catch (e) {
        console.error('LogicEngine error:', e);
        tableBody.innerHTML = '<tr><td colspan="12" style="color:red; text-align:center;">שגיאה בחישוב הנתונים. נסה לרענן.</td></tr>';
        return;
    }

    let totalHours = 0;

    // Update Print Header
    const [y, m] = selectedMonth.split('-');
    const prevM = parseInt(m) - 1 || 12;
    document.getElementById('print-month').innerText = `${m}/${y} (תקופת שכר: 20/${prevM} - 19/${m})`;

    reportData.forEach(shift => {
        const row = document.createElement('tr');
        const b = shift.breakdown;

        totalHours += parseFloat(shift.duration);

        // Date Handling
        const d = new Date(shift.date);
        const dayName = d.toLocaleDateString('he-IL', { weekday: 'long' });

        // Helper to check override
        const getVal = (field, fallback) => {
            if (shift.overrides && shift.overrides[field] !== undefined) {
                return { val: shift.overrides[field], isOverridden: true };
            }
            return { val: fallback, isOverridden: false };
        };

        const rQuota = getVal('quotaDisplay', b.quotaDisplay || '0');
        const rReg = getVal('regular', b.regular.toFixed(2));
        const r125 = getVal('extra125', b.extra125.toFixed(2));
        const r150 = getVal('extra150', b.extra150.toFixed(2));
        const rDed = getVal('deduction', b.deduction || '');

        row.innerHTML = `
            <td>
                 <input type="date" class="input-inline" value="${shift.date}" onchange="updateShift(${shift.id}, 'date', this.value)">
            </td>
            <td>${dayName}</td>
            <td class="font-bold">
                <div class="time-inputs">
                    <input type="time" class="input-inline time" value="${shift.start}" onchange="updateShift(${shift.id}, 'start', this.value)">
                    -
                    <input type="time" class="input-inline time" value="${shift.end}" onchange="updateShift(${shift.id}, 'end', this.value)">
                </div>
                <small>(${shift.duration.toFixed(2)} ש')</small>
            </td>
            
            <!-- Quota -->
            <td class="numeric-cell">
                <input type="text" class="input-inline numeric ${rQuota.isOverridden ? 'overridden' : ''}" 
                       value="${rQuota.val}" 
                       onchange="updateOverride(${shift.id}, 'quotaDisplay', this.value)">
            </td>
            
            <!-- Regular -->
            <td class="numeric-cell">
                <input type="number" step="0.01" class="input-inline numeric ${rReg.isOverridden ? 'overridden' : ''}" 
                       value="${rReg.val}" 
                       onchange="updateOverride(${shift.id}, 'regular', this.value)">
            </td>

            <!-- 125% -->
            <td class="numeric-cell">
                <input type="number" step="0.01" class="input-inline numeric ${r125.isOverridden ? 'overridden' : ''}" 
                       value="${r125.val}" 
                       onchange="updateOverride(${shift.id}, 'extra125', this.value)">
            </td>

            <!-- 150% -->
            <td class="numeric-cell">
                <input type="number" step="0.01" class="input-inline numeric ${r150.isOverridden ? 'overridden' : ''}" 
                       value="${r150.val}" 
                       onchange="updateOverride(${shift.id}, 'extra150', this.value)">
            </td>

            <td class="numeric-cell">-</td> 
            
            <!-- Deduction -->
            <td class="numeric-cell">
                <input type="text" class="input-inline numeric ${rDed.isOverridden ? 'overridden' : ''} ${(!rDed.isOverridden && b.deduction) ? 'status-error' : ''}" 
                       value="${rDed.val}" 
                       onchange="updateOverride(${shift.id}, 'deduction', this.value)">
                ${b.notes ? `<br><small style="color:var(--text-muted)">${b.notes}</small>` : ''}
            </td>

             <td class="text-cell">
                <input type="text" 
                       class="input-note no-print" 
                       placeholder="הוסף הערה..." 
                       value="${shift.notes || ''}" 
                       onchange="updateNote(${shift.id}, this.value)"
                       style="width: 100%; border: none; background: transparent; font-family: inherit; font-size: 0.9em;">
                <span class="print-only">${shift.notes || ''}</span>
            </td>
            <td class="no-print">
                <button class="btn text danger type-small" onclick="deleteShift(${shift.id})">❌</button>
            </td>
        `;

        // Highlight weekends/Fridays
        if (dayName.includes('שישי') || dayName.includes('שבת')) {
            row.classList.add('weekend');
        }

        tableBody.appendChild(row);
    });

    // Add Totals Row
    const totals = reportData.reduce((acc, s) => {
        // Use overridden values if present
        const o = s.overrides || {};
        const b = s.breakdown;

        acc.regular += (o.regular !== undefined) ? o.regular : b.regular;
        acc.extra125 += (o.extra125 !== undefined) ? o.extra125 : b.extra125;
        acc.extra150 += (o.extra150 !== undefined) ? o.extra150 : b.extra150;

        // Deduction might be string in display, but we sum numbers if possible
        const ded = (o.deduction !== undefined) ? o.deduction : (b.deduction || 0);
        acc.deduction += parseFloat(ded);

        return acc;
    }, { regular: 0, extra125: 0, extra150: 0, deduction: 0 });

    const totalRow = document.createElement('tr');
    totalRow.style.backgroundColor = '#e2e8f0';
    totalRow.style.fontWeight = 'bold';
    totalRow.innerHTML = `
        <td colspan="2">סה"כ</td>
        <td>${totalHours.toFixed(2)}</td>
        <td>-</td>
        <td class="numeric-cell">${totals.regular.toFixed(2)}</td>
        <td class="numeric-cell">${totals.extra125.toFixed(2)}</td>
        <td class="numeric-cell">${totals.extra150.toFixed(2)}</td>
        <td>-</td>
        <td class="numeric-cell ${totals.deduction > 0 ? 'status-error' : ''}">${totals.deduction.toFixed(2)}</td>
        <td></td>
        <td class="no-print"></td>
    `;
    tableBody.appendChild(totalRow);

    document.getElementById('total-hours-disp').innerText = totalHours.toFixed(2);
}

function setupEventListeners() {
    btnAddShift.addEventListener('click', () => {
        document.getElementById('shift-form').removeAttribute('data-edit-id'); // Clear edit mode
        shiftForm.reset();
        shiftModal.showModal();
        // Default to today
        document.getElementById('modal-date').valueAsDate = new Date();
    });

    shiftForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const date = document.getElementById('modal-date').value;
        const start = document.getElementById('modal-start').value;
        const end = document.getElementById('modal-end').value;

        const editId = shiftForm.getAttribute('data-edit-id');

        if (editId) {
            // Update existing
            const index = window.store.shifts.findIndex(s => s.id == editId);
            if (index !== -1) {
                window.store.shifts[index] = {
                    ...window.store.shifts[index],
                    date,
                    start,
                    end
                };
            }
        } else {
            // Create New
            const newShift = {
                id: Date.now(),
                date,
                start,
                end
            };
            window.store.shifts.push(newShift);
        }

        saveData();
        shiftForm.reset();
        shiftForm.removeAttribute('data-edit-id');
        shiftModal.close();
    });

    const btnImport = document.getElementById('btn-import');
    const importModal = document.getElementById('import-modal');
    const importForm = document.getElementById('import-form');

    btnImport.addEventListener('click', () => {
        importModal.showModal();
    });

    importForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = document.getElementById('import-text').value;
        const parsed = window.LogicEngine.parseBulkText(text);

        if (parsed.length > 0) {
            // Filter Duplicates
            // Criteria: Same Date, Same Start, Same End
            const newShifts = [];
            let duplicates = 0;

            parsed.forEach(p => {
                const exists = window.store.shifts.some(s =>
                    s.date === p.date && s.start === p.start && s.end === p.end
                );

                if (!exists) {
                    newShifts.push(p);
                } else {
                    duplicates++;
                }
            });

            if (newShifts.length > 0) {
                window.store.shifts.push(...newShifts);

                // Auto-switch month logic (keep existing logic)
                const firstDate = new Date(newShifts[0].date);
                let targetYear = firstDate.getFullYear();
                let targetMonth = firstDate.getMonth() + 1; // 1-12

                // If late in the month (20+), assume payroll period of next month
                if (firstDate.getDate() >= 20) {
                    targetMonth += 1;
                    if (targetMonth > 12) {
                        targetMonth = 1;
                        targetYear += 1;
                    }
                }

                const monthStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
                document.getElementById('month-select').value = monthStr;
                saveData();

                let msg = `יובאו בהצלחה ${newShifts.length} משמרות!`;
                if (duplicates > 0) {
                    msg += `\n(סיננתי ${duplicates} משמרות כפולות שהיו כבר במערכת)`;
                }
                alert(msg);

                importForm.reset();
                importModal.close();
            } else {
                if (duplicates > 0) {
                    alert(`לא הוספתי כלום. כל ${duplicates} המשמרות כבר קיימות במערכת.`);
                } else {
                    alert('לא נמצאו נתונים תקינים בטקסט.');
                }
            }
        } else {
            alert('לא נמצאו משמרות תקינות. נסה לבדוק את הפורמט (לדוגמה: 20.11- 08:00-16:00)');
        }
    });

    btnPrint.addEventListener('click', () => {
        window.print();
    });

    document.getElementById('month-select').addEventListener('change', () => {
        renderTable();
    });
}

// Global Actions
window.updateShift = function (id, field, value) {
    const shift = window.store.shifts.find(s => s.id === id);
    if (shift) {
        shift[field] = value;
        saveData();
    }
};

window.updateOverride = function (id, field, value) {
    const shift = window.store.shifts.find(s => s.id === id);
    if (shift) {
        if (!shift.overrides) shift.overrides = {};

        // If value is empty, remove override to revert to calculated
        if (value === '') {
            delete shift.overrides[field];
        } else {
            // Handle number conversion for numeric fields
            if (['regular', 'extra125', 'extra150'].includes(field)) {
                shift.overrides[field] = parseFloat(value);
            } else {
                shift.overrides[field] = value;
            }
        }
        saveData();
    }
};

window.updateNote = function (id, value) {
    const shift = window.store.shifts.find(s => s.id === id);
    if (shift) {
        shift.notes = value;
        localStorage.setItem('payroll_shifts', JSON.stringify(window.store.shifts));
    }
};

window.deleteShift = function (id) {
    if (confirm('למחוק משמרת זו?')) {
        window.store.shifts = window.store.shifts.filter(s => s.id !== id);
        saveData();
    }
};

window.editShift = function (id) {
    const shift = window.store.shifts.find(s => s.id === id);
    if (!shift) return;

    document.getElementById('modal-date').value = shift.date;
    document.getElementById('modal-start').value = shift.start;
    document.getElementById('modal-end').value = shift.end;

    // Mark form as editing this ID
    shiftForm.setAttribute('data-edit-id', id);
    shiftModal.showModal();
};

// Start
document.addEventListener('DOMContentLoaded', () => {
    init();
});
