// src/components/CalendarView.jsx
import React, { useEffect, useState } from "react";
import Calendar from "react-calendar";
import { iso, fmtShort, parseIsoToLocalDate, weekdayNameFromIso, ensureEndAfterStart } from "../utils/helpers";
import { saveAsync } from "../utils/storage";
import { scheduleRoutineNotification } from "../utils/notifications";

export default function CalendarView({
  routines, setRoutines, eventStatuses, setEventStatus, editBuffer, setEditBuffer, saveChanges, hasChanges
}) {
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [calendarViewMonth, setCalendarViewMonth] = useState(new Date());

  const today = new Date();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();

  const isPrevDisabled =
    calendarViewMonth.getFullYear() < currentYear ||
    (calendarViewMonth.getFullYear() === currentYear &&
      calendarViewMonth.getMonth() <= currentMonth - 1);

  const isNextDisabled =
    calendarViewMonth.getFullYear() > currentYear ||
    (calendarViewMonth.getFullYear() === currentYear &&
      calendarViewMonth.getMonth() >= currentMonth + 1);

  const onActiveStartDateChange = ({ activeStartDate }) =>
    setCalendarViewMonth(activeStartDate);

  // build events map for the visible range
  const calendarEvents = (() => {
    const events = {};
    const getRangeDates = (base) => {
      const arr = [];
      const start = new Date(base.getFullYear(), base.getMonth() - 1, 1);
      const end = new Date(base.getFullYear(), base.getMonth() + 2, 0);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) arr.push(new Date(d));
      return arr;
    };
    getRangeDates(calendarViewMonth).forEach(d => events[iso(d)] = []);
    routines.forEach(r => {
      if (!r.days || !r.startTime) return;
      const createdAtIso = r.createdAt ? iso(new Date(r.createdAt)) : null;
      Object.keys(events).forEach(dayIso => {
        if (createdAtIso && dayIso < createdAtIso) return;
        const weekDay = weekdayNameFromIso(dayIso); // local weekday name
        if (r.days.some(dd => dd === weekDay)) {
          events[dayIso].push({ routineId: r.id, name: r.name || "Routine", color: r.color || "violet", startTime: r.startTime, endTime: r.endTime, days: r.days });
        }
      });
    });
    Object.keys(events).forEach(k => events[k].sort((a,b) => (a.startTime||"") > (b.startTime||"") ? 1 : -1));
    return events;
  })();

  const availableDays = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

  // handle local edits (editBuffer stored in parent App)
  const handleLocalChange = (id, field, value) => {
    setEditBuffer(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: value } }));
  };

  // save changes: apply validation for endTime
  const handleSaveChanges = (id) => {
    const patch = editBuffer[id];
    if (!patch) return;
    // ensure endTime > startTime
    const start = patch.startTime ?? (routines.find(r=>r.id===id)?.startTime);
    const end = patch.endTime ?? (routines.find(r=>r.id===id)?.endTime);
    const correctedEnd = ensureEndAfterStart(start, end);
    patch.endTime = correctedEnd;
    // apply
    setRoutines(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
    // schedule notifications for upcoming days
    const r = routines.find(rr => rr.id === id);
    if (r) scheduleRoutineNotification({ ...r, ...patch }, iso(new Date()), "start", `Reminder: ${r.name}`);
    // persist routines
    saveAsync("aeryth_routines", routines.map(x => x.id === id ? { ...x, ...patch } : x));
    // clear edit buffer
    setEditBuffer(prev => { const n = { ...prev }; delete n[id]; return n; });
  };

  const isDateInPast = (dateIso) => dateIso < iso(new Date());
  const getStatus = (routineId, dateIso) => (eventStatuses[routineId] || {})[dateIso] || "upcoming";

  // Determine Upcoming summary for sidebar use (exposed via parent)
  // (Parent will compute; this component focuses on calendar UI)

  return (
    <div className="flex-1 h-full p-6 overflow-auto">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-violet-700">Calendar</h2>
        </div>

        <div className="flex gap-2 justify-center mb-4">
          <button
            onClick={() =>
              setCalendarViewMonth(new Date(calendarViewMonth.getFullYear(), calendarViewMonth.getMonth() - 1, 1))
            }
            className={`px-3 py-2 rounded font-semibold transition ${isPrevDisabled ? "bg-gray-300 text-gray-500 cursor-not-allowed" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
            disabled={isPrevDisabled}
          >
            Prev
          </button>
          <button
            onClick={() => setCalendarViewMonth(new Date())}
            className="px-3 py-2 rounded bg-violet-500 text-white font-semibold hover:bg-violet-600 transition"
          >
            Today
          </button>
          <button
            onClick={() =>
              setCalendarViewMonth(new Date(calendarViewMonth.getFullYear(), calendarViewMonth.getMonth() + 1, 1))
            }
            className={`px-3 py-2 rounded font-semibold transition ${isNextDisabled ? "bg-gray-300 text-gray-500 cursor-not-allowed" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
            disabled={isNextDisabled}
          >
            Next
          </button>
        </div>

        <div className="mx-auto w-100 h-[550px] flex justify-center">
          <Calendar
            onChange={setCalendarDate}
            value={calendarDate}
            activeStartDate={calendarViewMonth}
            onActiveStartDateChange={onActiveStartDateChange}
            className="w-full h-full border bg-white border-gray-200 rounded-lg shadow-lg"
            prevLabel={null}
            nextLabel={null}
            prev2Label={null}
            next2Label={null}
            tileContent={({ date }) => {
              const isoDay = iso(date);
              const ev = calendarEvents[isoDay] || [];
              if (!ev.length) return null;
              const shown = ev.slice(0, 2);
              const remaining = ev.length - shown.length;
              return (
                <div className="mt-1 space-y-0">
                  {shown.map((e, i) => (
                    <div key={i} className={`text-[10px] truncate rounded-sm px-1 ${e.color === "violet" ? "bg-violet-500 text-white" : e.color === "green" ? "bg-green-400 text-white" : e.color === "rose" ? "bg-rose-400 text-white" : "bg-amber-400 text-black"}`}>
                      {e.name}
                    </div>
                  ))}
                  {remaining > 0 && <div className="text-[9px] text-gray-500 font-medium">+{remaining} more</div>}
                </div>
              );
            }}
          />
        </div>

        <div className="mt-8 bg-white p-4 rounded-xl shadow">
          <h3 className="font-semibold text-lg text-gray-800">Events on {fmtShort(new Date(calendarDate))}</h3>
          <div className="mt-3 space-y-3">
            {(calendarEvents[iso(calendarDate)] || []).map((ev, idx) => {
              const local = editBuffer[ev.routineId] || {};
              const currentTime = local.startTime ?? ev.startTime ?? "";
              const endTime = local.endTime ?? ev.endTime ?? "";
              const currentDays = local.days ?? ev.days ?? [];
              const dateIso = iso(calendarDate);
              const inPast = isDateInPast(dateIso);
              const status = getStatus(ev.routineId, dateIso);

              const toggleDayLocal = (day) => {
                const newDays = currentDays.includes(day) ? currentDays.filter((d) => d !== day) : [...currentDays, day];
                handleLocalChange(ev.routineId, "days", newDays);
              };

              const hasStartedTime = (() => {
                if (dateIso !== iso(new Date())) return false;
                if (!currentTime) return false;
                const [hh, mm] = (currentTime || "00:00").split(":").map(Number);
                const now = new Date();
                return now.getHours() > hh || (now.getHours() === hh && now.getMinutes() >= mm);
              })();

              return (
                <div key={idx} className="p-3 border border-gray-100 rounded-lg shadow-sm flex flex-col gap-3">
                  <div className="flex justify-between items-center">
                    <div className="font-medium text-lg">{ev.name}</div>
                    {hasChanges(ev.routineId) && !inPast && (
                      <button onClick={() => handleSaveChanges(ev.routineId)} className="px-3 py-1 bg-violet-500 text-white text-sm font-semibold rounded hover:bg-violet-600 transition">Save</button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-4">
                    <div>
                      <label className="text-sm font-medium text-gray-600 block mb-1">Repeat on</label>
                      <div className="flex gap-1">
                        {availableDays.map((d) => (
                          <button key={d} type="button" onClick={() => toggleDayLocal(d)} disabled={inPast} className={`w-8 h-8 rounded-full text-xs font-bold transition flex items-center justify-center ${currentDays.includes(d) ? "bg-violet-500 text-white shadow" : "bg-violet-100 text-violet-500 hover:bg-violet-200"}`}>{d[0]}</button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="text-sm font-medium text-gray-600 block mb-1">Time</label>
                      <input type="time" value={currentTime} onChange={(e) => handleLocalChange(ev.routineId, "startTime", e.target.value)} disabled={inPast} className="p-1 border rounded-lg text-sm" />
                    </div>

                    <div>
                      <label className="text-sm font-medium text-gray-600 block mb-1">End Time</label>
                      <input type="time" value={endTime} onChange={(e) => handleLocalChange(ev.routineId, "endTime", e.target.value)} disabled={inPast} className="p-1 border rounded-lg text-sm" />
                    </div>

                    <div>
                      <label className="text-sm font-medium text-gray-600 block mb-1">Color</label>
                      <div className="flex gap-1">
                        {["violet","green","rose","amber"].map(c => (
                          <button key={c} onClick={() => handleLocalChange(ev.routineId, "color", c)} disabled={inPast} className={`w-5 h-5 rounded-full border-2 border-transparent hover:border-violet-700 transition ${c==="violet"?"bg-violet-500":c==="green"?"bg-green-400":c==="rose"?"bg-rose-400":"bg-amber-400"}`}/>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 justify-end">
                    {inPast ? (
                      <div className="text-sm text-gray-500">Status: <span className="font-semibold">{status}</span></div>
                    ) : (
                      <>
                        {status === "upcoming" && !hasStartedTime && <div className="text-sm text-gray-500">Status: <span className="font-semibold">upcoming</span></div>}
                        {status === "in-progress" && <div className="text-sm text-gray-500">Status: <span className="font-semibold">in-progress</span></div>}
                        {status === "completed" && <div className="text-sm text-green-600 font-semibold">Status: completed</div>}
                        {status === "skipped" && <div className="text-sm text-red-600 font-semibold">Status: skipped</div>}

                        {hasStartedTime && status !== "completed" && status !== "skipped" && (
                          <div className="flex flex-col gap-2">
                            <button onClick={() => { setEventStatus(ev.routineId, dateIso, "completed"); }} className="px-3 py-1 rounded bg-green-500 text-white">Completed</button>
                            <button onClick={() => { setEventStatus(ev.routineId, dateIso, "skipped"); }} className="px-3 py-1 rounded bg-red-100 text-red-700 border">Skipped</button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            {!(calendarEvents[iso(calendarDate)] || []).length && <div className="text-sm text-gray-500 p-2">No routines scheduled for this day.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
