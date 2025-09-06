export function Badge({ variant="default", className="", ...props }) {
  const styles = variant==="secondary"
    ? "bg-slate-100 text-slate-700"
    : variant==="destructive"
      ? "bg-rose-100 text-rose-700"
      : "bg-indigo-100 text-indigo-700";
  return <span className={`badge inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${styles} ${className}`} {...props} />;
}
export default Badge;
