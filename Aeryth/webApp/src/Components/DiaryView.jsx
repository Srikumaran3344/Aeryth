// src/components/DiaryView.jsx
import React, { useEffect, useState } from "react";
import EditableEntry from "./shared/EditableEntry";
import { iso, fmtShort } from "../utils/helpers";
import { callGeminiDiary, localGrammarCorrect, availableModel } from "../utils/ai";

export default function DiaryView({ diary, addDiaryEntry, deleteDiaryEntry, updateDiaryEntry, generateMonthlySummaryIfMissing }) {
  const today = new Date();
  const todayMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const todayKey = iso(today);

  const [entryText, setEntryText] = useState("");
  const [showPast, setShowPast] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [grammarPreview, setGrammarPreview] = useState(null);
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);
  const [diarySearchResults, setDiarySearchResults] = useState([]);
  const [highlightTerm, setHighlightTerm] = useState("");
  const [isAILoadingLocal, setIsAILoadingLocal] = useState(false);

  const thisMonthObj = diary[todayMonthKey] || {};
  const todaysEntries = (thisMonthObj && thisMonthObj[todayKey]) || [];

  const openNewEntry = () => {
    setShowPast(false);
    setSelectedDate(null);
    setEntryText("");
    setGrammarPreview(null);
    setIsPreviewVisible(false);
    setHighlightTerm("");
  };

  const handleSave = () => {
    if (!entryText.trim()) return;
    addDiaryEntry(entryText.trim());
    setEntryText("");
    setGrammarPreview(null);
    setIsPreviewVisible(false);
  };

  const handleGrammarCheck = async () => {
    if (!entryText.trim()) return alert("Write something first");
    setIsAILoadingLocal(true);
    try {
      let corrected;
      if (availableModel && availableModel()) {
        corrected = await callGeminiDiary(entryText);
      } else {
        corrected = localGrammarCorrect(entryText);
      }
      setGrammarPreview({ correctedText: corrected });
      setIsPreviewVisible(true);
    } catch (err) {
      console.error("Grammar check failed", err);
      const fallback = localGrammarCorrect(entryText);
      setGrammarPreview({ correctedText: fallback });
      setIsPreviewVisible(true);
    } finally {
      setIsAILoadingLocal(false);
    }
  };

  const acceptGrammarChanges = () => {
    if (grammarPreview?.correctedText != null) {
      setEntryText(grammarPreview.correctedText);
    }
    setIsPreviewVisible(false);
    setGrammarPreview(null);
  };

  const cancelGrammarPreview = () => {
    setIsPreviewVisible(false);
    setGrammarPreview(null);
  };

  const allDateKeys = [];
  Object.keys(diary).forEach(mk => {
    Object.keys(diary[mk]).forEach(dk => {
      if (dk === "monthlySummary") return;
      allDateKeys.push({ monthKey: mk, dayKey: dk });
    });
  });
  allDateKeys.sort((a, b) => b.dayKey.localeCompare(a.dayKey));

  const monthsMap = {};
  allDateKeys.forEach(({ monthKey, dayKey }) => {
    monthsMap[monthKey] = monthsMap[monthKey] || { days: [] };
    monthsMap[monthKey].days.push(dayKey);
  });

  useEffect(() => {
    const now = new Date();
    Object.keys(monthsMap).forEach(mk => {
      const [y, m] = mk.split("-").map(Number);
      if (y < now.getFullYear() || (y === now.getFullYear() && m < now.getMonth() + 1)) {
        generateMonthlySummaryIfMissing(mk);
      }
    });
  }, [diary]); // eslint-disable-line

  const openPastDate = (monthKey, dayKey) => {
    setSelectedDate({ monthKey, dayKey });
    setShowPast(true);
    setHighlightTerm(searchTerm.trim());
  };

  const handleBack = () => {
    if (selectedDate) {
      setSelectedDate(null);
      setHighlightTerm("");
    } else {
      setShowPast(false);
      setSearchTerm("");
      setHighlightTerm("");
    }
  };

  const runDiarySearch = (term) => {
    const t = term.trim().toLowerCase();
    setHighlightTerm(t);
    if (!t) {
      setDiarySearchResults([]);
      return;
    }

    const results = [];
    Object.keys(diary).forEach(mk => {
      const monthDisplay = new Date(`${mk}-01`).toLocaleString(undefined, { month: "long", year: "numeric" }).toLowerCase();
      Object.keys(diary[mk]).forEach(dk => {
        if (dk === "monthlySummary") return;
        const entries = diary[mk][dk] || [];
        if (dk.includes(t) || monthDisplay.includes(t)) {
          results.push({ monthKey: mk, dayKey: dk, entries });
          return;
        }
        const matching = entries.filter(e => {
          const timeStr = new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).toLowerCase();
          return (e.text || "").toLowerCase().includes(t) || timeStr.includes(t);
        });
        if (matching.length) results.push({ monthKey: mk, dayKey: dk, entries: matching });
      });
    });
    setDiarySearchResults(results);
  };

  useEffect(() => {
    const handler = setTimeout(() => runDiarySearch(searchTerm), 250);
    return () => clearTimeout(handler);
  }, [searchTerm, diary]);

  const canEditDay = (dayKey) => dayKey === todayKey;
  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const renderEntryTextWithHighlight = (text, term) => {
    if (!term) return text;
    const re = new RegExp(`(${escapeRegExp(term)})`, "ig");
    const parts = text.split(re);
    return parts.map((p, i) =>
      re.test(p)
        ? <span key={i} className="bg-purple-200 rounded px-1">{p}</span>
        : <span key={i}>{p}</span>
    );
  };

  const handleEditEntry = (monthKey, dayKey, entryId, newText) => {
    if (!canEditDay(dayKey)) return;
    updateDiaryEntry(monthKey, dayKey, entryId, newText);
  };

  return (
    <div className="flex-1 h-full overflow-auto">
      <div className="max-w-7xl flex">
        <div className="w-23/100 bg-white/80 py-4 px-2 border-r h-[100vh] overflow-auto">
          <div className="flex items-center justify-between mb-3">
            <div><h3 className="font-bold text-violet-700">{fmtShort(today)}</h3></div>
          </div>

          <div className="mb-3">
            <button onClick={openNewEntry} className="w-full py-2 rounded bg-violet-500 text-white mb-2">New entry</button>
            <div className="flex gap-1">
              <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search" className="flex-[3] min-w-0 p-2 border rounded" />
              <button onClick={() => { setShowPast(s => !s); setSelectedDate(null); }} className="flex-[1] min-w-0 px-3 py-2 rounded bg-gray-100">{showPast ? "Back" : "Past Entries"}</button>
            </div>
          </div>

          {!showPast && (
            <div className="space-y-2">
              {todaysEntries.map(e => (
                <div key={e.id} className="p-3 bg-white rounded shadow group relative cursor-pointer" onClick={() => { setSelectedDate({ monthKey: todayMonthKey, dayKey: todayKey }); }}>
                  <div className="text-sm">{renderEntryTextWithHighlight(e.text, highlightTerm)}</div>
                  <div className="text-xs text-gray-400 mt-1">{new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                  <div className="absolute right-3 bottom-3 opacity-0 group-hover:opacity-100">
                    <button onClick={(ev) => { ev.stopPropagation(); if (confirm("Delete entry?")) deleteDiaryEntry(todayMonthKey, todayKey, e.id); }} className="text-red-500">Delete</button>
                  </div>
                </div>
              ))}
              {!todaysEntries.length && <div className="text-sm text-gray-500">No entries for today yet.</div>}
            </div>
          )}

          {showPast && (
            <div className="space-y-3">
              {searchTerm ? (
                diarySearchResults.length ? diarySearchResults.map(r => (
                  <div key={`${r.monthKey}-${r.dayKey}`} className="p-3 bg-white rounded shadow flex justify-between items-center">
                    <div>
                      <div className="font-medium">{new Date(r.dayKey).toLocaleDateString()}</div>
                      <div className="text-xs text-gray-500">{r.monthKey}</div>
                    </div>
                    <button onClick={() => openPastDate(r.monthKey, r.dayKey)} className="px-3 py-2 rounded bg-violet-500 text-white">Open</button>
                  </div>
                )) : <div className="text-sm text-gray-500">No results</div>
              ) : (
                Object.keys(monthsMap).length ? Object.keys(monthsMap).map(mk => (
                  <div key={mk} className="bg-white p-3 rounded shadow">
                    <div className="flex justify-between items-center mb-2">
                      <div>
                        <div className="font-semibold">{new Date(`${mk}-01`).toLocaleString(undefined, { month: "long", year: "numeric" })}</div>
                        <div className="text-xs text-gray-500">{mk}</div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      {(monthsMap[mk].days || []).map(dayKey => (
                        <div key={dayKey} className="flex justify-between items-center p-2 border rounded hover:bg-gray-50">
                          <div>
                            <div className="font-medium">{new Date(dayKey).toLocaleDateString()}</div>
                            <div className="text-xs text-gray-500">{(diary[mk][dayKey] || []).length} entries</div>
                          </div>
                          <button onClick={() => openPastDate(mk, dayKey)} className="px-3 py-1 rounded bg-violet-500 text-white">Open</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )) : <div className="text-sm text-gray-500">No past entries yet.</div>
              )}
            </div>
          )}
        </div>

    <div className="flex-1 p-6 h-[100vh] overflow-auto">
      {!selectedDate && (
        <>
          <h2 className="text-2xl font-bold text-violet-700 mb-1">{fmtShort(today)}</h2>
          <p className="text-sm text-gray-500 mb-4">What's on your mind?</p>
          <textarea
            value={entryText}
            onChange={e => setEntryText(e.target.value)}
            className="w-full h-64 p-4 border rounded-lg resize-none"
          />

          {/* Grammar correction preview */}
          {isPreviewVisible && grammarPreview && (
            <div className="mt-4 bg-white border rounded p-4 shadow">
              <div className="font-semibold mb-2">Grammar correction preview</div>
              <div
                className="whitespace-pre-wrap text-sm p-2 border rounded bg-gray-50"
                style={{ minHeight: 80 }}
                dangerouslySetInnerHTML={{ __html: grammarPreview.correctedText }}
              >
              </div>
              <div className="flex gap-3 mt-3">
                <button
                  onClick={acceptGrammarChanges}
                  className="flex-1 py-2 rounded-lg bg-violet-500 text-white font-bold"
                >
                  Accept Changes
                </button>
                <button
                  onClick={() => {
                    cancelGrammarPreview();
                    setIsPreviewVisible(false);
                  }}
                  className="flex-1 py-2 rounded-lg border"
                >
                  Back
                </button>
              </div>
            </div>
          )}

          {/* Show main buttons only when grammar window not visible */}
          {!(isPreviewVisible && grammarPreview) && (
            <div className="flex gap-3 mt-4">
              <button
                onClick={!isAILoadingLocal ? handleGrammarCheck : undefined}
                disabled={isAILoadingLocal}
                className={`flex-1 py-2 rounded-lg font-semibold ${
                  isAILoadingLocal
                    ? "bg-blue-100 text-blue-400 cursor-not-allowed"
                    : "bg-blue-100 text-blue-800"
                }`}
              >
                {isAILoadingLocal ? "..." : "Correct Grammar"}
              </button>

              <button
                onClick={!isAILoadingLocal ? handleSave : undefined}
                disabled={isAILoadingLocal}
                className={`flex-1 py-2 rounded-lg font-bold ${
                  isAILoadingLocal
                    ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                    : "bg-violet-500 text-white"
                }`}
              >
                Save Entry
              </button>
            </div>
          )}
        </>
      )}

      {selectedDate && (
        <>
          <div className="flex items-center gap-3 mb-3">
            <button onClick={handleBack} className="px-3 py-2 rounded bg-gray-100">Back</button>
            <h3 className="text-lg font-semibold">
              {new Date(selectedDate.dayKey).toLocaleDateString()}
            </h3>
          </div>

          <div className="bg-white p-4 rounded shadow mb-3">
            <div className="font-bold">Summary (auto)</div>
            <div className="text-sm text-gray-600 mt-2">
              {diary[selectedDate.monthKey]?.monthlySummary || "[Monthly/daily summary will appear here]"}
            </div>
          </div>

          <div className="space-y-2">
            {(diary[selectedDate.monthKey]?.[selectedDate.dayKey] || []).map(e => (
              <div key={e.id} className="bg-white p-3 rounded shadow">
                <div className="text-sm">
                  {canEditDay(selectedDate.dayKey) ? (
                    <EditableEntry
                      initialText={e.text}
                      onSave={(newText) =>
                        handleEditEntry(selectedDate.monthKey, selectedDate.dayKey, e.id, newText)
                      }
                    />
                  ) : (
                    <div>{renderEntryTextWithHighlight(e.text, highlightTerm)}</div>
                  )}
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  {new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>


      </div>
    </div>
  );
}
