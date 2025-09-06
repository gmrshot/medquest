import React, { createContext, useContext } from "react";

const TabsCtx = createContext({ value: "topics", setValue: () => {} });

export function Tabs({ value, onValueChange, children }) {
  return (
    <TabsCtx.Provider value={{ value, setValue: onValueChange }}>
      <div data-tabs data-value={value}>{children}</div>
    </TabsCtx.Provider>
  );
}

export function TabsList({ children }) {
  return (
    <div className="mt-2 inline-flex rounded-xl border bg-white p-1 dark:bg-slate-800 dark:border-slate-700">
      {children}
    </div>
  );
}

export function TabsTrigger({ value, children }) {
  const { value: cur, setValue } = useContext(TabsCtx);
  const active = cur === value;
  return (
    <button
      onClick={() => setValue(value)}
      className={`px-3 py-1.5 text-sm rounded-lg transition
        ${active ? "bg-indigo-600 text-white" : "hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"}`}
      data-active={active}
      data-value={value}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, children, className="" }) {
  const { value: cur } = useContext(TabsCtx);
  if (cur !== value) return null;
  return <div className={className}>{children}</div>;
}
