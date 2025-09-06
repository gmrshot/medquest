export function Select({ children }) { return <div className="relative">{children}</div>; }
export function SelectTrigger({ className="", ...props }) {
  return <button className={`w-full rounded-xl border px-3 py-2 text-left ${className}`} {...props} />;
}
export function SelectContent({ className="", ...props }) {
  return <div className={`absolute z-20 mt-1 w-full rounded-xl border bg-white shadow ${className}`} {...props} />;
}
export function SelectItem({ children, ...props }) {
  return <div className="cursor-pointer px-3 py-2 hover:bg-slate-100" {...props}>{children}</div>;
}
export function SelectValue({ placeholder }) { return <span className="text-slate-500">{placeholder}</span>; }
