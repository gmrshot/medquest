export function Progress({ value=0 }) {
  return (
    <div className="h-2 w-full rounded-full bg-slate-200">
      <div className="h-2 rounded-full bg-indigo-500" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
export default Progress;
