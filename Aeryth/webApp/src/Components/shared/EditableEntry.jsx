// src/components/shared/EditableEntry.jsx
import React, { useEffect, useState } from "react";

export default function EditableEntry({ initialText, onSave }) {
  const [text, setText] = useState(initialText || "");
  useEffect(() => setText(initialText || ""), [initialText]);

  const save = () => {
    if (!text.trim()) return;
    onSave(text.trim());
  };

  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full p-2 border rounded resize-none"
        rows={3}
      />
      <div className="flex gap-2 mt-2">
        <button onClick={save} className="px-3 py-1 rounded bg-violet-500 text-white">Save</button>
      </div>
    </div>
  );
}
